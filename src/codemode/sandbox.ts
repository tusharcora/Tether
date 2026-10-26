/**
 * The sandbox: an agent's script runs in QuickJS (WebAssembly), locally, never on Cloudflare. It has no filesystem,
 * network, process or timers; its only way out is `__host(path, json)`, which the connector namespaces wrap. Host calls
 * return QuickJS promises, so `await`, loops and `Promise.all` over connector calls work.
 *
 * Each run gets its own worker thread (sandboxWorker), which owns the VM: a busy loop never blocks the server, and the
 * wall limit is worker.terminate(). Connector calls come back here over the worker's message port. Memory and the call
 * cap are enforced in the worker, the result cap by the session.
 */
import { stripTypeScriptTypes } from 'node:module';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

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

/** The worker's file: a sibling built (.js) or, under the tests, from source (.ts on Node's type stripping). */
const WORKER = new URL(`./sandboxWorker${extname(fileURLToPath(import.meta.url))}`, import.meta.url);
/** The worker's own JS heap (QuickJS's memory is its WASM heap, capped by the memory limit). */
const WORKER_HEAP_MB = 96;

type FromWorker = { t: 'call'; id: number; path: string; json: string } | { t: 'done'; result?: string; error?: string; logs: string[]; calls: number };

/** Run `code` with the connector namespaces `roots` (plus `codemode`) bound to `call`. Never throws. */
export function execute(code: string, roots: string[], call: HostCall, limits: Limits = LIMITS): Promise<ExecResult> {
  return new Promise((resolve) => {
    let calls = 0;
    let finished = false;
    const worker = new Worker(WORKER, { workerData: { code: normalizeCode(code), roots: [...new Set([...roots, 'codemode'])], limits }, resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } });
    const finish = (r: ExecResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(r);
    };
    // past the wall time the thread is stopped, whatever it is doing (a CPU loop, a stuck await)
    const timer = setTimeout(() => finish({ error: `timed out after ${limits.wallMs / 1000} s`, logs: [], calls }), limits.wallMs);
    worker.on('message', (m: FromWorker) => {
      if (m.t === 'done') {
        let result: unknown;
        if (m.result !== undefined) {
          try {
            result = JSON.parse(m.result);
          } catch {
            result = m.result;
          }
        }
        return finish({ ...(m.error !== undefined ? { error: m.error } : { result }), logs: m.logs, calls: m.calls });
      }
      calls++;
      Promise.resolve()
        .then(() => call(m.path, JSON.parse(m.json) as unknown[]))
        .then(
          (value) => JSON.stringify({ value: value === undefined ? null : value }),
          (e: unknown) => JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        )
        .then((json) => !finished && worker.postMessage({ t: 'reply', id: m.id, json }));
    });
    worker.on('error', (e) => finish({ error: /heap|memory/i.test(e.message) ? 'out of memory' : `the sandbox failed: ${e.message}`, logs: [], calls }));
    worker.on('exit', () => finish({ error: 'the sandbox stopped unexpectedly', logs: [], calls }));
  });
}
