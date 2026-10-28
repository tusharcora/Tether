/**
 * The sandbox's worker thread: it owns the QuickJS VM, so a busy-looping script never blocks the server's event loop
 * (the parent ends a run past its wall time with worker.terminate()). Connector calls go to the parent over the worker's
 * message port and come back as JSON. Memory and connector-call limits are enforced here.
 *
 * Only package imports: under the tests this file runs from source on Node's own type stripping, which does not map
 * `.js` specifiers to `.ts` files.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten-core';

interface Job {
  code: string;
  roots: string[];
  limits: { wallMs: number; memoryBytes: number; maxCalls: number; maxResultBytes: number };
}
/** Parent → worker: the answer to one connector call (`{ value }` or `{ error }` as JSON). */
type Reply = { t: 'reply'; id: number; json: string };

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

async function run(job: Job): Promise<{ result?: string; error?: string; logs: string[]; calls: number }> {
  const port = parentPort!;
  const logs: string[] = [];
  let calls = 0;
  let logBytes = 0;
  let nextId = 0;
  const waiting = new Map<number, (json: string) => void>();
  port.on('message', (m: Reply) => {
    if (m.t === 'reply') {
      waiting.get(m.id)?.(m.json);
      waiting.delete(m.id);
    }
  });

  // the release build of QuickJS with a separate .wasm file (the only variant Tether ships)
  const mod = await newQuickJSWASMModuleFromVariant(import('@jitl/quickjs-wasmfile-release-sync'));
  const rt = mod.newRuntime();
  rt.setMemoryLimit(job.limits.memoryBytes);
  rt.setMaxStackSize(1024 * 1024);
  // a backstop only: the parent terminates this thread at the wall time
  rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + job.limits.wallMs + 1000));
  const ctx = rt.newContext();

  const host = ctx.newFunction('__host', (pathH, argsH) => {
    const path = ctx.getString(pathH);
    const json = ctx.getString(argsH);
    const p = ctx.newPromise();
    // returned to the guest as the function's value: resolving is the only clean-up it needs
    const settle = (body: string) => {
      const h = ctx.newString(body);
      p.resolve(h);
      h.dispose();
      rt.executePendingJobs();
    };
    if (++calls > job.limits.maxCalls) settle(JSON.stringify({ error: `connector call limit reached (${job.limits.maxCalls} per run): do more in fewer calls, or return what you have` }));
    else {
      const id = nextId++;
      waiting.set(id, settle);
      port.postMessage({ t: 'call', id, path, json });
    }
    return p.handle;
  });
  ctx.setProp(ctx.global, '__host', host);
  host.dispose();
  const log = ctx.newFunction('__log', (h) => {
    const line = ctx.getString(h);
    logBytes += line.length;
    if (logBytes <= job.limits.maxResultBytes * 4) logs.push(line);
  });
  ctx.setProp(ctx.global, '__log', log);
  log.dispose();

  const prelude = ctx.evalCode(PRELUDE(job.roots), 'prelude.js');
  if (prelude.error) prelude.error.dispose();
  else prelude.value.dispose();

  const evaluated = ctx.evalCode(`(async () => {\n${job.code}\n})().then((v) => JSON.stringify(v === undefined ? null : v) ?? 'null')`, 'run_code.js');
  if (evaluated.error) {
    const error = errorText(ctx, evaluated.error);
    evaluated.error.dispose();
    return { error, logs, calls };
  }
  const settled = ctx.resolvePromise(evaluated.value);
  evaluated.value.dispose();
  rt.executePendingJobs();
  const out = await settled;
  if (out.error) {
    const error = errorText(ctx, out.error);
    out.error.dispose();
    return { error, logs, calls };
  }
  const result = ctx.getString(out.value);
  out.value.dispose();
  return { result, logs, calls };
}

run(workerData as Job).then(
  (r) => parentPort!.postMessage({ t: 'done', ...r }),
  (e: unknown) => parentPort!.postMessage({ t: 'done', error: e instanceof Error ? e.message : String(e), logs: [], calls: 0 }),
);
