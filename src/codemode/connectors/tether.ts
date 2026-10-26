/**
 * `tether`: the run around the script. `ask` puts a question to the person (team runs; the step ends waiting, as an
 * `@ASK user:` line does), `note` writes to the run log, `handoff` hands work to a teammate where the step allows it,
 * `vault.*` reads and writes the knowledge graph, `runs.*` looks at other runs.
 */
import type { Store } from '../../store.js';
import type { Vault } from '../../vault.js';
import type { Connector, Method } from '../types.js';

export interface Ask {
  question: string;
  options?: string[];
  recommended?: string;
  why?: string;
}

export interface TetherHooks {
  ask(a: Ask): void;
  hand(h: { to: string; goal: string; expect?: string }): void;
  note(text: string): void;
}

const line = (v: unknown, max: number, what: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${what} must be a non-empty string`);
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
};
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => line(x, 120, 'an option')) : undefined);

export function tetherConnector(o: { kind: 'team' | 'workflow'; handoff: boolean; writable: boolean; store?: Store; vault?: Vault; hooks: TetherHooks }): Connector {
  const methods: Method[] = [
    {
      name: 'ask',
      summary: 'Ask the person a question (team runs). The step then ends and runs again with the answer.',
      params: [
        { name: 'question', schema: { type: 'string' } },
        { name: 'opts', schema: { type: 'object', properties: { options: { type: 'array', items: { type: 'string' } }, recommended: { type: 'string' }, why: { type: 'string' } } }, optional: true },
      ],
      returns: 'string',
      async run([question, opts]) {
        if (o.kind !== 'team') throw new Error('nobody to ask in a workflow run: decide on your best assumption and say so in your answer');
        const x = (opts ?? {}) as { options?: unknown; recommended?: unknown; why?: unknown };
        const options = strings(x.options);
        o.hooks.ask({ question: line(question, 300, 'the question'), ...(options?.length ? { options } : {}), ...(typeof x.recommended === 'string' ? { recommended: line(x.recommended, 120, 'recommended') } : {}), ...(typeof x.why === 'string' && x.why.trim() ? { why: line(x.why, 300, 'why') } : {}) });
        return 'Asked the person. Finish your answer now (say what you are waiting for); this step runs again with their answer.';
      },
    },
    {
      name: 'note',
      summary: 'Write a line to the run log (what you found, what you decided).',
      params: [{ name: 'text', schema: { type: 'string' } }],
      returns: 'string',
      async run([text]) {
        o.hooks.note(line(text, 2000, 'the note'));
        return 'noted';
      },
    },
    {
      name: 'handoff',
      summary: o.handoff ? 'Hand a piece of work to a teammate bot; its result comes back after this answer.' : 'Not available: this step may not hand off work.',
      params: [{ name: 'h', schema: { type: 'object', properties: { to: { type: 'string', description: 'A bot id' }, goal: { type: 'string' }, expect: { type: 'string' } }, required: ['to', 'goal'] } }],
      returns: 'string',
      async run([h]) {
        if (!o.handoff) throw new Error('this step may not hand off work');
        const x = (h ?? {}) as { to?: unknown; goal?: unknown; expect?: unknown };
        const to = line(x.to, 40, '"to"');
        if (!/^[a-z][a-z0-9_-]*$/i.test(to)) throw new Error('"to" must be a bot id');
        o.hooks.hand({ to, goal: line(x.goal, 500, '"goal"'), ...(typeof x.expect === 'string' && x.expect.trim() ? { expect: line(x.expect, 300, '"expect"') } : {}) });
        return `handed to ${to}: finish your answer, and its result comes back to you`;
      },
    },
  ];
  const vault = o.vault;
  if (vault)
    methods.push(
      {
        name: 'vault.search',
        summary: 'Search the knowledge graph (Obsidian vault) for notes.',
        params: [
          { name: 'query', schema: { type: 'string' } },
          { name: 'limit', schema: { type: 'integer' }, optional: true },
        ],
        returns: '{ path: string; title: string; score: number }[]',
        async run([query, limit]) {
          const hits = await vault.search(line(query, 300, 'the query'), Math.min(20, Math.max(1, typeof limit === 'number' ? limit : 6)));
          return hits.map((h) => ({ path: h.note.path, title: h.note.title, score: Math.round(h.score * 100) / 100 }));
        },
      },
      {
        name: 'vault.read',
        summary: 'Read a vault note by its path.',
        params: [{ name: 'path', schema: { type: 'string' } }],
        returns: '{ path: string; title: string; body: string } | null',
        async run([path]) {
          const n = await vault.read(line(path, 300, 'the path'));
          return n ? { path: n.path, title: n.title, body: n.body.slice(0, 32_000) } : null;
        },
      },
      {
        name: 'vault.write',
        summary: 'Create a vault note (never overwrites one). Writable steps only.',
        params: [
          { name: 'path', schema: { type: 'string', description: 'e.g. "Notes/limits.md"' } },
          { name: 'body', schema: { type: 'string' } },
        ],
        returns: 'string',
        write: true,
        async run([path, body]) {
          if (typeof body !== 'string' || body.length > 64_000) throw new Error('the body must be text up to 64 000 characters');
          const ok = await vault.writeNote(line(path, 200, 'the path'), body, { overwrite: false });
          return ok ? 'written' : 'a note with that path already exists: pick another path';
        },
      },
    );
  const store = o.store;
  if (store)
    methods.push(
      {
        name: 'runs.list',
        summary: 'Recent runs (newest first): id, task, status, workflow.',
        params: [{ name: 'limit', schema: { type: 'integer' }, optional: true }],
        returns: '{ id: string; task: string; status: string; pipeline: string; startedAt: number }[]',
        async run([limit]) {
          const n = Math.min(50, Math.max(1, typeof limit === 'number' ? limit : 10));
          return store
            .list()
            .filter((r) => !r.probe)
            .sort((a, b) => b.startedAt - a.startedAt)
            .slice(0, n)
            .map((r) => ({ id: r.id, task: r.task.split('\n')[0]!.slice(0, 200), status: r.status, pipeline: r.pipeline, startedAt: r.startedAt }));
        },
      },
      {
        name: 'runs.get',
        summary: 'One run: its task, status, steps with their status, and spend.',
        params: [{ name: 'id', schema: { type: 'string' } }],
        returns: '{ id: string; task: string; status: string; steps: Record<string, string>; costUsd: number } | null',
        async run([id]) {
          const s = store.state(line(id, 64, 'the run id'));
          return s ? { id: s.id, task: s.task.slice(0, 2000), status: s.status, steps: Object.fromEntries(Object.entries(s.nodes).map(([k, v]) => [k, v.status])), costUsd: s.costUsd } : null;
        },
      },
    );
  return { name: 'tether', summary: `this run: ask the person${o.kind === 'team' ? '' : ' (team runs only)'}, note, handoff, vault.search/read/write, runs.list/get`, methods: async () => methods };
}
