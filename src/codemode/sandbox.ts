/**
 * The sandbox: an agent's script runs in QuickJS (WebAssembly), locally, never on Cloudflare. It has no filesystem,
 * network, process or timers; its only way out is `__host(path, json)`, which the connector namespaces wrap. Host calls
 * return QuickJS promises, so `await`, loops and `Promise.all` over connector calls work.
 *
 * Limits: wall time (a CPU loop is interrupted, a stuck await is abandoned), memory, and connector calls per run. Each
 * run gets a fresh WASM module, so an abandoned run is simply dropped, never half-disposed.
 */
import { stripTypeScriptTypes } from 'node:module';
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten-core';

export interface Limits {
  wallMs: number;
  memoryBytes: number;
  maxCalls: number;
  maxResultBytes: number;
}

/** Spec §4.1: 10 s wall, 64 MB, 200 connector calls, a 16 KB result. */
export const LIMITS: Limits = { wallMs: 10_000, memoryBytes: 64 * 1024 * 1024, maxCalls: 200, maxResultBytes: 16 * 1024 };

export interface ExecResult {
  /** The script's return value (JSON-safe), when it finished. */
  result?: unknown;
  error?: string;
  logs: string[];
  /** Host calls made (connector calls and codemode.search/describe). */
  calls: number;
}

export type HostCall = (path: string, args: unknown[]) => Promise<unknown>;

/** Node marks its type stripper experimental and says so on stderr once; that line is noise in the server's log. */
function quietly<T>(fn: () => T): T {
  const emit = process.emitWarning;
  process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
    if (!String(typeof w === 'string' ? w : w.message).includes('stripTypeScriptTypes')) (emit as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  try {
    return fn();
  } finally {
    process.emitWarning = emit;
  }
}

/** A function expression is called, anything else is an async body; types are stripped (Node's own stripper, never checked). */
export function normalizeCode(code: string): string {
  const js = code.trim().replace(/^```(?:\w+)?\n([\s\S]*?)\n?```$/, '$1').trim();
  const fn = /^(async\s+)?(\(([^()]|\([^()]*\))*\)|[A-Za-z_$][\w$]*)\s*(:[^=]+)?=>/.test(js) || /^(async\s+)?function\b/.test(js);
  const body = fn ? `return await (${js.replace(/;\s*$/, '')})();` : js;
  // stripped inside a function so a top-level `return` parses; strip mode keeps every offset, so the wrapper slices off
  const head = '(async () => {\n';
  const tail = '\n})';
  try {
    return quietly(() => stripTypeScriptTypes(head + body + tail, { mode: 'strip' })).slice(head.length, -tail.length);
  } catch {
    return body; // not valid TypeScript either: QuickJS reports the syntax error
  }
}

const PRELUDE = (roots: string[]) => `
const __call = async (path, args) => {
  const r = JSON.parse(await __host(path, JSON.stringify(args)));
  if (r.error !== undefined) throw new Error(r.error);
  return r.value;
};
const __ns = (path) => new Proxy(function () {}, {
  get(_t, k) { return typeof k !== 'string' || k === 'then' ? undefined : __ns(path + '.' + k); },
  apply(_t, _self, args) { return __call(path, args); },
});
${roots.map((r) => `globalThis.${r} = __ns(${JSON.stringify(r)});`).join('\n')}
const __fmt = (v) => { if (typeof v === 'string') return v; try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } };
globalThis.console = { log: (...a) => __log(a.map(__fmt).join(' ')) };
console.error = console.warn = console.info = console.debug = console.log;
`;

const errorText = (ctx: QuickJSContext, h: QuickJSHandle): string => {
  const e = ctx.dump(h) as { name?: string; message?: string; stack?: string } | string;
  if (typeof e !== 'object' || e === null) return String(e);
  const stack = (e.stack ?? '').split('\n').filter((l) => l.trim()).slice(0, 4).join('\n');
  return `${e.name ?? 'Error'}: ${e.message ?? ''}${stack ? `\n${stack}` : ''}`;
};

/** Run `code` with the connector namespaces `roots` (plus `codemode`) bound to `call`. Never throws. */
export async function execute(code: string, roots: string[], call: HostCall, limits: Limits = LIMITS): Promise<ExecResult> {
  const logs: string[] = [];
  let calls = 0;
  let logBytes = 0;
  let alive = true;
  // the release build of QuickJS with a separate .wasm file (the only variant Tether ships)
  const mod = await newQuickJSWASMModuleFromVariant(import('@jitl/quickjs-wasmfile-release-sync'));
  const rt = mod.newRuntime();
  rt.setMemoryLimit(limits.memoryBytes);
  rt.setMaxStackSize(1024 * 1024);
  rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.wallMs));
  const ctx = rt.newContext();
  const pump = () => alive && rt.executePendingJobs();

  const host = ctx.newFunction('__host', (pathH, argsH) => {
    const path = ctx.getString(pathH);
    const json = ctx.getString(argsH);
    const p = ctx.newPromise();
    const settle = (body: unknown) => {
      if (!alive) return;
      const h = ctx.newString(JSON.stringify(body));
      // returned to the guest as the function's value: resolving is the only clean-up it needs
      p.resolve(h);
      h.dispose();
      pump();
    };
    if (++calls > limits.maxCalls) settle({ error: `connector call limit reached (${limits.maxCalls} per run): do more in fewer calls, or return what you have` });
    else
      Promise.resolve()
        .then(() => call(path, JSON.parse(json) as unknown[]))
        .then(
          (value) => settle({ value: value === undefined ? null : value }),
          (e: unknown) => settle({ error: e instanceof Error ? e.message : String(e) }),
        );
    return p.handle;
  });
  ctx.setProp(ctx.global, '__host', host);
  host.dispose();
  const log = ctx.newFunction('__log', (h) => {
    const line = ctx.getString(h);
    logBytes += line.length;
    if (logBytes <= limits.maxResultBytes * 4) logs.push(line);
  });
  ctx.setProp(ctx.global, '__log', log);
  log.dispose();

  const rootsAll = [...new Set([...roots, 'codemode'])];
  const prelude = ctx.evalCode(PRELUDE(rootsAll), 'prelude.js');
  if (prelude.error) prelude.error.dispose();
  else prelude.value.dispose();

  const done = (r: ExecResult): ExecResult => {
    alive = false;
    try {
      ctx.dispose();
      rt.dispose();
    } catch {
      /* a run cut short can hold handles: the module is dropped with it */
    }
    return r;
  };
  const evaluated = ctx.evalCode(`(async () => {\n${normalizeCode(code)}\n})().then((v) => JSON.stringify(v === undefined ? null : v) ?? 'null')`, 'run_code.js');
  if (evaluated.error) {
    const error = errorText(ctx, evaluated.error);
    evaluated.error.dispose();
    return done({ error, logs, calls });
  }
  const settled = ctx.resolvePromise(evaluated.value);
  evaluated.value.dispose();
  pump();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((r) => (timer = setTimeout(() => r('timeout'), limits.wallMs)));
  const out = await Promise.race([settled, timeout]);
  clearTimeout(timer);
  if (out === 'timeout') {
    alive = false; // abandoned with its pending host calls: the module is dropped, not disposed
    return { error: `timed out after ${limits.wallMs / 1000} s`, logs, calls };
  }
  if (out.error) {
    const error = errorText(ctx, out.error);
    out.error.dispose();
    return done({ error, logs, calls });
  }
  const text = ctx.getString(out.value);
  out.value.dispose();
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    result = text;
  }
  return done({ result, logs, calls });
}
