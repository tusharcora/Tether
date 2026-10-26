import { vi } from 'vitest';
import { api, type RunRow, type RunView } from '../api';
import type { AppCommand, TetherBridge } from '../bridge';

type Handler = unknown | ((body: unknown, path: string) => unknown);

/**
 * Answer `api(method, path, body)` from a table keyed "METHOD /path" (exact, then without the query string).
 * A handler may be a value, an Error (thrown) or a function of the body. Unknown routes throw.
 * The calling test file must `vi.mock('../api', …)` (or './api') with `api: vi.fn()`.
 */
export function routeApi(routes: Record<string, Handler>) {
  vi.mocked(api).mockImplementation(async (method: string, path: string, body?: unknown) => {
    const exact = `${method} ${path}`;
    const bare = `${method} ${path.split('?')[0]}`;
    const h = exact in routes ? routes[exact] : bare in routes ? routes[bare] : undefined;
    if (h === undefined) throw new Error(`no route for ${exact}`);
    const v = typeof h === 'function' ? (h as (b: unknown, p: string) => unknown)(body, path) : h;
    if (v instanceof Error) throw v;
    if (v instanceof Promise) return v as never;
    return structuredClone(v) as never;
  });
}

export const calls = (method: string, path: string) => vi.mocked(api).mock.calls.filter((c) => c[0] === method && c[1] === path);

export function makeRun(o: Partial<RunView> = {}): RunView {
  return {
    id: 'r1', status: 'running', live: true, task: 'Add rate limiting', repo: '/repo', workdir: '/wt', baseSha: 'abc', branch: 'aorch/r1',
    autoApprove: false, kind: 'workflow', mode: 'live', planning: false, round: 0, pending: [], answers: [], setupDone: true, setupArtifacts: [],
    spawned: 0, costUsd: 0.12, startedAt: Date.now() - 60_000, notes: [], actions: [],
    pipeline: {
      name: 'plan-code-review', version: 1, mode: 'pipeline', settings: { parallel: 4, nodeTimeoutMs: 1_800_000, pipeMode: 'ancestors' },
      nodes: [
        { id: 'plan', kind: 'agent', role: 'planner', x: 0, y: 0, readOnly: true },
        { id: 'code', kind: 'agent', role: 'coder', x: 260, y: 0 },
        { id: 'gate', kind: 'gate', command: 'npm test', x: 520, y: 0, fixNode: 'code' },
      ],
      edges: [{ from: 'plan', to: 'code' }, { from: 'code', to: 'gate' }],
    },
    nodes: {
      plan: { status: 'done', attempts: 1, costUsd: 0.05, loops: 0, output: 'the plan' },
      code: { status: 'running', attempts: 1, costUsd: 0.07, loops: 0, live: 'editing…' },
      gate: { status: 'queued', attempts: 0, costUsd: 0, loops: 0 },
    },
    ...o,
  } as RunView;
}

export function makeRow(o: Partial<RunRow> = {}): RunRow {
  return { id: 'r1', pipeline: 'plan-code-review', task: 'Add rate limiting', repo: '/repo', status: 'running', startedAt: Date.now() - 60_000, costUsd: 0.12, live: true, nodes: {}, kind: 'workflow', mode: 'live', pending: 0, planReady: false, branch: 'aorch/r1', lastTs: Date.now(), steps: [], bots: [], ...o };
}

/** Stand-in for EventSource: tests push `state` / `event` messages with emit(). */
export class FakeEventSource {
  static all: FakeEventSource[] = [];
  closed = false;
  private listeners: Record<string, ((m: MessageEvent) => void)[]> = {};
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, f: (m: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(f);
  }
  emit(type: string, data: unknown) {
    for (const f of this.listeners[type] ?? []) f(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
  close() {
    this.closed = true;
  }
}

/** A stand-in for Tether.app's `window.tether` (unstubbed after each test); `emit` plays the app's side. */
export function fakeBridge() {
  const on = { open: [] as ((p: string) => void)[], route: [] as ((h: string) => void)[], command: [] as ((c: AppCommand) => void)[] };
  const sub =
    <T,>(list: ((v: T) => void)[]) =>
    (cb: (v: T) => void) => (list.push(cb), () => void list.splice(list.indexOf(cb), 1));
  const b = {
    platform: 'darwin',
    openFolder: vi.fn(async (): Promise<string | undefined> => undefined),
    pathForFile: vi.fn((f: File) => `/drop/${f.name}`),
    revealInFinder: vi.fn(),
    setBadge: vi.fn(),
    notify: vi.fn(),
    onOpen: sub(on.open),
    onRoute: sub(on.route),
    onCommand: sub(on.command),
    ready: vi.fn(),
  } satisfies TetherBridge;
  vi.stubGlobal('tether', b);
  const emit = { open: (p: string) => on.open.forEach((cb) => cb(p)), route: (h: string) => on.route.forEach((cb) => cb(h)), command: (c: AppCommand) => on.command.forEach((cb) => cb(c)) };
  return { b, emit, listeners: on };
}

/** What a drop of these items carries: folders (`dir: true`) or files. */
export const dropOf = (...items: { name: string; dir?: boolean }[]) => ({
  types: ['Files'],
  items: items.map((i) => ({ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: !!i.dir }), getAsFile: () => new File([], i.name) })),
});
