import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { Engine } from '../src/engine.js';
import { Store } from '../src/store.js';
import { makeRepo, tmp } from './helpers.js';

const root = new URL('..', import.meta.url).pathname;
const tsx = join(root, 'node_modules/.bin/tsx');

/** A fresh home whose Tether points at an agent that is not installed, so a real model is never called. */
function home() {
  const h = tmp('cli-home-');
  mkdirSync(h, { recursive: true });
  writeFileSync(join(h, 'bots.json'), JSON.stringify({ orchestrator: { agent: 'mock' } }));
  return h;
}
function aorch(h: string, ...args: string[]) {
  const r = spawnSync(tsx, [join(root, 'src/cli.ts'), ...args, '--home', h], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', AORCH_NO_ANIMATION: '1' }, timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const card = (id: string, extra: object = {}) => ({ id, ask: `ask ${id}`, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], recommended: 'b', ...extra });
/** A run seeded in the home's database with the mock adapter, then driven by the CLI in another process. */
async function seed(h: string, mock: object, o: object = {}) {
  const store = Store.open(join(h, 'runs.db'));
  const engine = new Engine(store, { home: h, registry: new AdapterRegistry().register(new MockAdapter()), bindings: () => ({ orchestrator: { agent: 'mock' } }) });
  const id = await engine.startTeam({ task: 'build x', repo: makeRepo(), workspace: false, roster: ['coder'], mock: mock as never, ...o });
  return { id, store };
}
const plan = { goal: 'ship it', success: ['tests pass'], assignments: [{ bot: 'coder', goal: 'write' }] };

describe('aorch team commands', () => {
  it('team without a terminal prints the cards and exits 2; --json prints only JSON', () => {
    const h = home();
    const repo = makeRepo();
    const r = aorch(h, 'team', 'do x', '--repo', repo, '--roster', 'coder');
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/question/);
    expect(r.out).toMatch(/aorch answer \S+ \S+ <option>/);
    const j = aorch(h, 'team', 'do x', '--repo', repo, '--roster', 'coder', '--json');
    expect(j.code).toBe(2);
    const parsed = JSON.parse(j.out);
    expect(parsed.status).toBe('waiting');
    expect(parsed.pending.length).toBeGreaterThan(0);
  });

  it('team rejects bad flags', () => {
    const h = home();
    expect(aorch(h, 'team', 'x', '--mode', 'wild').err).toMatch(/live or autonomous/);
    expect(aorch(h, 'team', 'x', '--budget', '0').code).toBe(1);
  });

  it('answer records a planning answer; unknown and repeated questions fail; show lists the dialogue', async () => {
    const h = home();
    const { id } = await seed(h, { questions: [[card('q1')]], plan });
    expect(aorch(h, 'answer', id, 'zz', 'a').err).toMatch(/unknown question: zz/);
    expect(aorch(h, 'answer', id, 'q1', '9').err).toMatch(/choose 1-2/);
    const ok = aorch(h, 'answer', id, 'q1', '1', '--json');
    expect(ok.code ?? 0).toBe(0);
    expect(JSON.parse(ok.out)).toMatchObject({ id, answered: 'q1' });
    expect(aorch(h, 'answer', id, 'q1', 'a').err).toMatch(/already answered/);
    const show = aorch(h, 'show', id);
    expect(show.out).toMatch(/team dialogue/);
    expect(show.out).toMatch(/ask q1/);
    expect(show.out).toMatch(/→ A/);
  });

  it('plan --reject stops a run with a finished plan; mode switches and refuses a bad value', async () => {
    const h = home();
    const { id, store } = await seed(h, { questions: [], plan }, { yes: true });
    expect(store.state(id)!.plan).toBeDefined();
    const m = aorch(h, 'mode', id, 'autonomous', '--json');
    expect(JSON.parse(m.out)).toEqual({ id, mode: 'autonomous' });
    expect(aorch(h, 'mode', id, 'wild').err).toMatch(/invalid mode/);
    const r = aorch(h, 'plan', id, '--reject', '--json');
    expect(JSON.parse(r.out)).toEqual({ id, status: 'stopped' });
    expect(Store.open(join(h, 'runs.db')).state(id)!.status).toBe('stopped');
  });
});
