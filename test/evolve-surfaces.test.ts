import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry, MockAdapter } from '../src/adapters/index.js';
import { BUILTIN_BOTS } from '../src/crew.js';
import { Engine } from '../src/engine.js';
import { getProposal, listProposals, proposeFor, renderProposal, saveProbe, type Proposal } from '../src/evolve.js';
import { adopt, decline, EvolveOpError, evolveData, evolveSummary, keptOf, labelOf, pickFrom, proposalView, revert } from '../src/evolveops.js';
import { evolveKey, evolveLines, type EvolveState } from '../src/evolveview.js';
import { currentHarness, getVersion, listVersions, saveVersion } from '../src/harness.js';
import { loadLessons, saveLessons, type Lesson } from '../src/lessons.js';
import { chat } from '../src/maestro.js';
import { startServer } from '../src/server.js';
import { Store } from '../src/store.js';
import { Tui } from '../src/tui.js';
import { strip, vlen } from '../src/ui.js';
import { Vault } from '../src/vault.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

const coder = BUILTIN_BOTS.find((b) => b.id === 'coder')!;
const lsn = (k: string, over: Partial<Lesson> = {}): Lesson => ({
  id: `coder-${k}`,
  bot: 'coder',
  text: `Lesson ${k}: sent back for missing tests`,
  polarity: 'avoid',
  topic: `topic${k}`,
  provenance: 'metrics',
  evidence: [0, 1, 2].map((i) => ({ run: `r${k}${i}`, node: 'code', signal: 'redos:2', source: 'metrics' as const })),
  runs: 3,
  status: 'confident',
  updatedAt: new Date().toISOString(),
  ...over,
});
const LESSONS = [lsn('aaaa1111'), lsn('bbbb2222')];
const edits = [
  { field: 'guidance', op: 'add', after: 'Write the tests first', lessons: ['coder-aaaa1111'] },
  { field: 'guidance', op: 'add', after: 'Run the linter before finishing', lessons: ['coder-bbbb2222'] },
  { field: 'guidance', op: 'add', after: 'Keep each commit small', lessons: ['coder-aaaa1111'] },
];

function world() {
  const home = tmp('evs-home-');
  const mock = new MockAdapter();
  const registry = new AdapterRegistry().register(mock);
  saveLessons(home, 'coder', LESSONS);
  return { home, mock, registry };
}
async function proposal(w: { home: string; registry: AdapterRegistry }, es: object[] = edits): Promise<Proposal> {
  const r = await proposeFor({ home: w.home, bot: coder, registry: w.registry, agent: 'mock', mock: { proposal: { edits: es } } });
  if (!r.proposal) throw new Error(`no proposal: ${r.reason}`);
  return r.proposal;
}

// ---------------------------------------------------------------- ops

describe('pickFrom: 1-based picks for the CLI and API', () => {
  const p = { edits: [{}, {}, {}] } as unknown as Proposal;
  it('a string list is 1-based and becomes 0-based', () => {
    expect(pickFrom(p, '1,3')).toEqual([0, 2]);
    expect(pickFrom(p, undefined)).toBeUndefined();
  });
  it('an array of 1-based numbers works the same way', () => {
    expect(pickFrom(p, [3, 1])).toEqual([0, 2]);
  });
  it('bad picks are invalid', () => {
    for (const bad of ['0', '4', '1,1', 'x', '', '-1', '1.5', [0], [4], [1, 1], ['1'], [1.5], [], {}, 7, null]) {
      expect(() => pickFrom(p, bad as never), JSON.stringify(bad)).toThrow(EvolveOpError);
      try {
        pickFrom(p, bad as never);
      } catch (e) {
        expect((e as EvolveOpError).code).toBe('invalid');
      }
    }
  });
  it('"kept" needs probe results and picks what the probe kept', () => {
    expect(() => pickFrom(p, 'kept')).toThrow(/probe/);
    const s = (over: object = {}) => ({ gatesPassed: true, redos: 0, costUsd: 0.1, durationMs: 1, ...over });
    const probed = {
      ...p,
      edits: edits as never,
      probe: {
        at: 'x',
        budgetUsd: 1,
        spentUsd: 0.3,
        results: [
          { task: 't', run: 'r', edit: 0, baseline: s({ redos: 2 }), candidate: s(), verdict: 'better', costUsd: 0.1 },
          { task: 't', run: 'r', edit: 1, baseline: s(), candidate: s({ redos: 2 }), verdict: 'worse', costUsd: 0.1 },
        ],
      },
    } as unknown as Proposal;
    expect(keptOf(probed)).toMatchObject({ kept: [0, 2], dropped: [1], unprobed: [2] });
    expect(pickFrom(probed, 'kept')).toEqual([0, 2]);
  });
});

describe('labels and views', () => {
  it('a superseded proposal is labelled apart from a rejection', () => {
    const base = { id: 'coder-0123456789abcdef', bot: 'coder', base: 1, edits: [], createdAt: 'x' };
    expect(labelOf({ ...base, status: 'rejected', note: 'superseded: harness is now v3' } as Proposal)).toBe('superseded');
    expect(labelOf({ ...base, status: 'rejected' } as Proposal)).toBe('rejected');
    expect(labelOf({ ...base, status: 'open' } as Proposal)).toBe('open');
  });
  it('the proposal view is data: 1-based edit numbers, cited lessons, no paths', async () => {
    const w = world();
    const p = await proposal(w);
    const v = proposalView(w.home, p, loadLessons(w.home, 'coder'));
    expect(v).toMatchObject({ id: p.id, bot: 'coder', status: 'open', label: 'open', stale: false });
    expect(v.edits.map((e) => e.n)).toEqual([1, 2, 3]);
    expect(v.edits[0]!.lessons[0]).toMatchObject({ id: 'coder-aaaa1111', runs: 3, polarity: 'avoid' });
    expect(JSON.stringify(v)).not.toContain(w.home);
  });
  it('renderProposal names the real commands', async () => {
    const w = world();
    const p = await proposal(w);
    const t = renderProposal(p, coder, loadLessons(w.home, 'coder')).join('\n');
    expect(t).not.toMatch(/coming/);
    expect(t).toContain(`aorch evolve --accept ${p.id}`);
    expect(t).toContain(`aorch evolve --reject ${p.id}`);
  });
});

describe('adopt, decline, revert', () => {
  it('adopt applies the picked edits, closes the proposal and notes it in the vault', async () => {
    const w = world();
    const vault = new Vault(tmp('evs-vault-'));
    const p = await proposal(w);
    const r = await adopt(w.home, p.id, '1,3', vault);
    expect(r.harness.guidance).toEqual(['Write the tests first', 'Keep each commit small']);
    expect(getProposal(w.home, p.id)).toMatchObject({ status: 'accepted', picked: [0, 2], version: r.harness.version });
    const files = readdirSync(join(vault.root, 'lessons', 'coder'));
    const note = files.find((f) => f.startsWith('harness-v'))!;
    expect(note).toBe(`harness-v${r.harness.version}.md`);
    const body = readFileSync(join(vault.root, 'lessons', 'coder', note), 'utf8');
    expect(body).toMatch(/type: harness-adopted/);
    expect(body).toContain(p.id);
    expect(body).toContain('Write the tests first');
  });
  it('a broken vault never fails the accept', async () => {
    const w = world();
    const p = await proposal(w);
    const bad = { writeNote: async () => { throw new Error('disk full'); } } as unknown as Vault;
    const r = await adopt(w.home, p.id, undefined, bad);
    expect(r.harness.guidance).toHaveLength(3);
    expect(getProposal(w.home, p.id).status).toBe('accepted');
  });
  it('codes: stale base and decided proposals are conflicts; bad ids invalid; unknown proposals not found', async () => {
    const w = world();
    const p = await proposal(w);
    const cur = currentHarness(w.home, coder);
    saveVersion(w.home, coder, { persona: cur.persona, guidance: ['moved on'], skills: cur.skills }, cur.version);
    await expect(adopt(w.home, p.id)).rejects.toMatchObject({ code: 'conflict' });
    const q = await proposal(w);
    decline(w.home, q.id);
    await expect(adopt(w.home, q.id)).rejects.toMatchObject({ code: 'conflict' });
    expect(() => decline(w.home, q.id)).toThrow(expect.objectContaining({ code: 'conflict' }));
    await expect(adopt(w.home, '../etc')).rejects.toMatchObject({ code: 'invalid' });
    await expect(adopt(w.home, 'coder-0000000000000000')).rejects.toMatchObject({ code: 'not_found' });
    await expect(adopt(w.home, 'nobody-0000000000000000')).rejects.toMatchObject({ code: 'not_found' });
  });
  it('revert: current or missing version is invalid; a real one makes a new version', () => {
    const w = world();
    const v1 = currentHarness(w.home, coder);
    saveVersion(w.home, coder, { persona: v1.persona, guidance: ['x'], skills: v1.skills }, 1);
    expect(() => revert(w.home, 'coder', 2)).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(() => revert(w.home, 'coder', 9)).toThrow(expect.objectContaining({ code: 'invalid' }));
    for (const bad of ['1', 1.5, 0, -1, null]) expect(() => revert(w.home, 'coder', bad), String(bad)).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(() => revert(w.home, 'ghost', 1)).toThrow(expect.objectContaining({ code: 'not_found' }));
    expect(revert(w.home, 'coder', 1)).toMatchObject({ version: 3, guidance: [] });
  });
});

// ---------------------------------------------------------------- API

describe('Evolve over HTTP', () => {
  let base = '';
  let close: () => Promise<void>;
  let w: ReturnType<typeof world>;
  let store: Store;
  function raw(method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const u = new URL(base);
      const req = request({ host: u.hostname, port: u.port, method, path, headers: { host: u.host, ...opts.headers } }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }));
      });
      req.on('error', reject);
      req.end(opts.body);
    });
  }
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await raw(method, path, { headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, json: r.body ? JSON.parse(r.body) : undefined };
  };
  beforeAll(async () => {
    w = world();
    const vault = new Vault(tmp('evs-vault-'));
    store = Store.open(':memory:');
    const engine = new Engine(store, { home: w.home, registry: w.registry, vault });
    const s = await startServer({ engine, store, vault, registry: w.registry, cfg: { home: w.home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0 });
    base = s.url;
    close = s.close;
  });
  afterAll(() => close());

  it('GET /api/harness/:bot gives the current version and the version list', async () => {
    const r = await api('GET', '/api/harness/coder');
    expect(r.status).toBe(200);
    // a read never snapshots v1: a bot that never ran shows what v1 would be, with nothing stored
    expect(r.json).toMatchObject({ bot: 'coder', evolvable: true, current: { version: 1 }, versions: [] });
    expect((await api('GET', '/api/harness/ghost')).status).toBe(404);
    expect((await api('GET', '/api/harness/..%2Fx')).status).toBe(400);
    expect((await api('GET', '/api/harness/manager')).json).toMatchObject({ evolvable: false });
  });
  it('GET /api/lessons?bot= returns lesson data with evidence ids', async () => {
    const r = await api('GET', '/api/lessons?bot=coder');
    expect(r.status).toBe(200);
    expect(r.json.lessons).toHaveLength(2);
    expect(r.json.lessons[0]).toMatchObject({ id: 'coder-aaaa1111', status: 'confident', runs: 3 });
    expect(r.json.lessons[0].evidence[0]).toEqual({ run: 'raaaa11110', node: 'code', signal: 'redos:2', source: 'metrics' });
    expect((await api('GET', '/api/lessons?bot=ghost')).status).toBe(404);
    expect((await api('GET', '/api/lessons?bot=BAD!')).status).toBe(400);
  });
  it('lists, accepts with 1-based picks, rejects; status codes for every refusal', async () => {
    const p = await proposal(w);
    const list = await api('GET', '/api/proposals?bot=coder');
    expect(list.status).toBe(200);
    expect(list.json.proposals.map((x: { id: string }) => x.id)).toContain(p.id);
    expect((await api('GET', '/api/proposals')).json.proposals.some((x: { id: string }) => x.id === p.id)).toBe(true);
    expect((await api('POST', `/api/proposals/${p.id}/accept`, { pick: [0] })).status).toBe(400);
    expect((await api('POST', `/api/proposals/${p.id}/accept`, { pick: [4] })).status).toBe(400);
    expect((await api('POST', `/api/proposals/${p.id}/accept`, { pick: '1' })).status).toBe(400);
    expect((await api('POST', `/api/proposals/${p.id}/accept`, { pick: 'kept' })).status).toBe(400); // no probe results
    expect((await api('POST', '/api/proposals/not-an-id/accept', {})).status).toBe(400);
    expect((await api('POST', '/api/proposals/coder-0000000000000000/accept', {})).status).toBe(404);
    expect((await api('POST', '/api/proposals/ghost-0000000000000000/reject', {})).status).toBe(404);
    const ok = await api('POST', `/api/proposals/${p.id}/accept`, { pick: [2] });
    expect(ok.status).toBe(200);
    expect(ok.json.harness.guidance).toEqual(['Run the linter before finishing']);
    expect(ok.json.proposal).toMatchObject({ status: 'accepted', picked: [2] });
    expect((await api('POST', `/api/proposals/${p.id}/accept`, {})).status).toBe(409);
    expect((await api('POST', `/api/proposals/${p.id}/reject`, {})).status).toBe(409);
  });
  it('a stale base is a 409 and changes nothing', async () => {
    const p = await proposal(w, [edits[0]!]);
    const cur = currentHarness(w.home, coder);
    saveVersion(w.home, coder, { persona: cur.persona, guidance: [...cur.guidance, 'other'], skills: cur.skills }, cur.version);
    const before = listVersions(w.home, coder).length;
    const r = await api('POST', `/api/proposals/${p.id}/accept`, {});
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/harness changed/);
    expect(listVersions(w.home, coder)).toHaveLength(before);
    const view = (await api('GET', '/api/proposals?bot=coder')).json.proposals.find((x: { id: string }) => x.id === p.id);
    expect(view.stale).toBe(true);
  });
  it('reject closes it; superseded proposals are labelled', async () => {
    const p = await proposal(w, [{ ...edits[2]!, after: 'Name the failing test in the summary' }]);
    const r = await api('POST', `/api/proposals/${p.id}/reject`, {});
    expect(r.status).toBe(200);
    expect(r.json.proposal).toMatchObject({ status: 'rejected', label: 'rejected' });
  });
  it('rollback: validates the version; current or missing is 400; unknown bot 404', async () => {
    const cur = currentHarness(w.home, coder).version;
    expect((await api('POST', '/api/harness/coder/rollback', { version: cur })).status).toBe(400);
    expect((await api('POST', '/api/harness/coder/rollback', { version: 999 })).status).toBe(400);
    expect((await api('POST', '/api/harness/coder/rollback', { version: '1' })).status).toBe(400);
    expect((await api('POST', '/api/harness/coder/rollback', {})).status).toBe(400);
    expect((await api('POST', '/api/harness/ghost/rollback', { version: 1 })).status).toBe(404);
    const r = await api('POST', '/api/harness/coder/rollback', { version: 1 });
    expect(r.status).toBe(200);
    expect(r.json.harness).toMatchObject({ version: cur + 1, guidance: [], note: 'rollback to v1' });
  });
  it('refuses a non-loopback Host on every Evolve route', async () => {
    const routes: [string, string][] = [
      ['GET', '/api/harness/coder'],
      ['GET', '/api/lessons?bot=coder'],
      ['GET', '/api/proposals?bot=coder'],
      ['POST', '/api/proposals/coder-0000000000000000/accept'],
      ['POST', '/api/proposals/coder-0000000000000000/reject'],
      ['POST', '/api/harness/coder/rollback'],
    ];
    for (const [m, p] of routes) {
      const r = await raw(m, p, { headers: { host: 'evil.example.com', 'content-type': 'application/json' }, body: m === 'POST' ? '{}' : undefined });
      expect(r.status, `${m} ${p}`).toBe(403);
    }
  });
  it('probe runs are hidden from /api/runs unless all=1', async () => {
    const pl = pipe([{ id: 'code', role: 'coder' }], []);
    store.append('probe1', { type: 'run.started', pipeline: pl, task: 't', repo: '/r', workdir: '/r', baseSha: '0', branch: 'b', probe: { proposal: 'coder-0000000000000000', side: 'baseline' } } as never);
    store.append('work1', { type: 'run.started', pipeline: pl, task: 't', repo: '/r', workdir: '/r', baseSha: '0', branch: 'b' } as never);
    const ids = (await api('GET', '/api/runs')).json.map((r: { id: string }) => r.id);
    expect(ids).toContain('work1');
    expect(ids).not.toContain('probe1');
    const all = (await api('GET', '/api/runs?all=1')).json;
    expect(all.find((r: { id: string }) => r.id === 'probe1')).toMatchObject({ probe: true });
  });
});

// ---------------------------------------------------------------- TUI

describe('evolve view (pure)', () => {
  async function data() {
    const w = world();
    const p = await proposal(w);
    return { w, p, d: evolveData(w.home, 'coder') };
  }
  it('lines show the diff, cited evidence, keys, and fit the width', async () => {
    const { d, p } = await data();
    const st: EvolveState = { bot: 'coder', pick: [] };
    for (const width of [60, 100]) {
      const ls = evolveLines(d, st, width);
      for (const l of ls) expect(vlen(l), l).toBeLessThanOrEqual(width);
      const t = ls.map(strip).join('\n');
      expect(t).toContain(p.id);
      expect(t).toContain('+ Write the tests first');
      expect(t).toMatch(/because coder-aaaa1111/);
      expect(t).toMatch(/a accept/);
    }
  });
  it('keys: digits toggle picks, a accepts picks (1-based), r asks first, esc backs out', async () => {
    const { d, p } = await data();
    const st: EvolveState = { bot: 'coder', pick: [] };
    expect(evolveKey(d, st, '2').act).toBeUndefined();
    evolveKey(d, st, '3');
    expect(st.pick).toEqual([1, 2]);
    evolveKey(d, st, '3');
    expect(st.pick).toEqual([1]);
    expect(evolveKey(d, st, 'a').act).toEqual({ kind: 'accept', id: p.id, pick: [2] });
    st.pick = [];
    expect(evolveKey(d, st, 'a').act).toEqual({ kind: 'accept', id: p.id });
    expect(evolveKey(d, st, 'r').act).toBeUndefined();
    expect(st.confirm).toEqual({ id: p.id });
    expect(evolveLines(d, st, 80).map(strip).join('\n')).toMatch(/y to reject/);
    expect(evolveKey(d, st, 'esc').act).toBeUndefined(); // cancels the confirm, does not leave
    expect(st.confirm).toBeUndefined();
    evolveKey(d, st, 'r');
    expect(evolveKey(d, st, 'y').act).toEqual({ kind: 'reject', id: p.id });
    expect(evolveKey(d, st, 'esc').act).toEqual({ kind: 'back' });
    expect(evolveKey(d, st, '9').act).toBeUndefined();
  });
  it('a stale or decided proposal cannot be accepted from the view', async () => {
    const { w, p } = await data();
    const cur = currentHarness(w.home, coder);
    saveVersion(w.home, coder, { persona: cur.persona, guidance: ['x'], skills: cur.skills }, cur.version);
    const d = evolveData(w.home, 'coder');
    const st: EvolveState = { bot: 'coder', sel: p.id, pick: [] };
    const r = evolveKey(d, st, 'a');
    expect(r.act).toBeUndefined();
    expect(r.msg).toMatch(/aorch evolve coder/);
  });
});

describe('Tui crew tab and evolve view', () => {
  async function boot(withProposal: boolean) {
    const w = world();
    const store = Store.open(':memory:');
    const engine = new Engine(store, { home: w.home, registry: w.registry });
    const out = { write: () => true, columns: 100, rows: 40 } as unknown as NodeJS.WriteStream;
    const ui = new Tui({ cfg: { home: w.home, vault: tmp('evs-v-'), adapters: {}, endpoints: {} } as never, store, engine }, out) as any;
    const p = withProposal ? await proposal(w) : undefined;
    ui.screen.tab = 'crew';
    ui.screen.sel.crew = Object.keys((await import('../src/bots.js')).CREW).indexOf('coder');
    return { ui, w, p, store };
  }
  it('crew rows show the harness version and a proposal marker, within the width', async () => {
    const a = await boot(false);
    const t0 = a.ui.crewBody(30).map(strip).join('\n');
    expect(t0).toMatch(/Bolt.*v1/);
    expect(t0).not.toContain('● proposal');
    for (const l of a.ui.crewBody(30)) expect(vlen(l)).toBeLessThanOrEqual(100);
    const b = await boot(true);
    b.ui.evolveAt = 0; // refresh the cached summary
    const lines: string[] = b.ui.crewBody(30);
    const row = lines.map(strip).find((l) => /[●◉] Bolt/.test(l))!;
    expect(row).toContain('● proposal');
    for (const l of lines) expect(vlen(l)).toBeLessThanOrEqual(100);
    expect(lines.map(strip).join('\n')).toMatch(/v\s+evolve/);
  });
  it('v opens the evolve view; e still edits the bot; a accepts; esc goes back', async () => {
    const { ui, w, p } = await boot(true);
    ui.key('e');
    expect(ui.screen.kind).toBe('botedit');
    ui.pop();
    ui.key('v');
    expect(ui.screen.kind).toBe('evolve');
    expect(ui.body(30).map(strip).join('\n')).toContain(p!.id);
    ui.key('1');
    ui.key('a');
    await vi.waitFor(() => expect(getProposal(w.home, p!.id).status).toBe('accepted'));
    expect(getVersion(w.home, 'coder', 2)!.guidance).toEqual(['Write the tests first']);
    ui.key('esc');
    expect(ui.screen.kind).toBe('dash');
  });
  it('r asks inline before rejecting; a waiting modal gets the keys first', async () => {
    const { ui, w, p } = await boot(true);
    ui.key('v');
    ui.modal = { kind: 'confirm', title: 'something else', onYes: () => {} };
    ui.key('a'); // goes to the modal, not to accept
    expect(getProposal(w.home, p!.id).status).toBe('open');
    ui.modal = undefined;
    ui.key('r');
    expect(getProposal(w.home, p!.id).status).toBe('open');
    ui.key('y');
    expect(getProposal(w.home, p!.id).status).toBe('rejected');
  });
  it('the evolve view never runs the editor', async () => {
    const { ui, w } = await boot(false);
    ui.key('v');
    for (const k of ['a', 'r', 'y', 'E', 'p', 'enter']) ui.key(k);
    expect(w.mock.calls).toHaveLength(0);
    expect(listProposals(w.home, 'coder')).toHaveLength(0);
  });
  it('probe runs are hidden from the runs tab unless toggled with P', async () => {
    const { ui, store } = await boot(false);
    const pl = pipe([{ id: 'code', role: 'coder' }], []);
    store.append('probe1', { type: 'run.started', pipeline: pl, task: 't', repo: '/r', workdir: '/r', baseSha: '0', branch: 'b', probe: { proposal: 'coder-0000000000000000', side: 'baseline' } } as never);
    store.append('work1', { type: 'run.started', pipeline: pl, task: 't', repo: '/r', workdir: '/r', baseSha: '0', branch: 'b' } as never);
    expect(ui.runs().map((r: { id: string }) => r.id)).toEqual(['work1']);
    ui.screen.tab = 'runs';
    ui.key('P');
    expect(ui.runs().map((r: { id: string }) => r.id).sort()).toEqual(['probe1', 'work1']);
  });
});

describe('evolveSummary', () => {
  it('reads without writing: no harness snapshot for bots that never ran', async () => {
    const w = world();
    const s = evolveSummary(w.home, ['coder', 'reviewer']);
    expect(s.coder).toEqual({ version: 1, open: 0 });
    expect(existsSync(join(w.home, 'harness', 'reviewer', 'v1.json'))).toBe(false);
  });
});

// ---------------------------------------------------------------- Maestro

describe('Maestro hint', () => {
  it('the chat prompt says Maestro may offer evolve and never runs it itself', async () => {
    const mock = new MockAdapter();
    await chat('bolt keeps getting sent back', { home: tmp('evs-m-'), repo: makeRepo(), registry: new AdapterRegistry().register(mock), agent: 'mock' });
    const prompt = mock.calls[0]!.prompt;
    expect(prompt).toMatch(/aorch evolve <bot>/);
    expect(prompt).toMatch(/never run it yourself|only offer/i);
  });
});

// ---------------------------------------------------------------- end to end

describe('end to end with the mock adapter', () => {
  it('redos and thumbs-down -> confident lesson -> proposal -> accept -> the next run uses the new version', async () => {
    const { home, mock, registry, store, engine } = setup();
    const repo = makeRepo();
    const reviewed = () => pipe([{ id: 'code', role: 'coder', mock: { output: 'done' } }, { id: 'rev', role: 'reviewer', verdict: true, readOnly: true, fixNode: 'code', mock: { verdicts: ['FAIL', 'FAIL', 'PASS'] } }], [['code', 'rev']]);
    for (let i = 0; i < 3; i++) {
      const id = await engine.start({ pipeline: reviewed(), task: `task ${i}`, repo, workspace: false });
      await engine.wait(id);
      expect(store.state(id)!.status).toBe('done');
      engine.feedback(id, 'code', 'down', 'forgot the tests again');
    }
    // the redos alone make a lesson worded from reviewer output (low trust: never cited without feedback); the thumbs-down notes make a usable one
    const usable = () => loadLessons(home, 'coder').find((l) => l.status === 'confident' && l.provenance === 'feedback');
    await vi.waitFor(() => expect(usable()).toBeDefined(), { timeout: 5000 });
    expect(loadLessons(home, 'coder').some((l) => l.topic === 'rework' && l.runs === 3)).toBe(true);
    const lesson = usable()!;
    const r = await proposeFor({ home, bot: coder, registry, agent: 'mock', mock: { proposal: { edits: [{ field: 'guidance', op: 'add', after: 'Always add a test for the change', lessons: [lesson.id] }] } } });
    expect(r.proposal, r.reason).toBeDefined();
    const { harness } = await adopt(home, r.proposal!.id);
    expect(harness.version).toBe(2);
    mock.calls.length = 0;
    const id = await engine.start({ pipeline: pipe([{ id: 'code', role: 'coder', mock: { output: 'ok' } }], []), task: 'next', repo, workspace: false });
    await engine.wait(id);
    const started = store.events(id).map((e) => e.event).find((e) => e.type === 'node.started' && e.node === 'code') as { harness?: { bot: string; version: number } };
    expect(started.harness).toEqual({ bot: 'coder', version: 2 });
    expect(mock.calls.find((c) => c.nodeId === 'code')!.prompt).toContain('Always add a test for the change');
  });
});

// ---------------------------------------------------------------- CLI

describe('aorch evolve / harness / probes (CLI)', () => {
  const root = new URL('..', import.meta.url).pathname;
  const tsx = join(root, 'node_modules/.bin/tsx');
  const aorch = (h: string, ...args: string[]) => {
    const r = spawnSync(tsx, [join(root, 'src/cli.ts'), ...args, '--home', h, '--vault', join(h, 'vault')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', AORCH_NO_ANIMATION: '1' }, timeout: 60_000 });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  it('show, accept with --pick (1-based), refuse a bad pick, never pick for you after a probe, log, diff and rollback', async () => {
    const w = world();
    const p = await proposal(w);
    const s = aorch(w.home, 'evolve', '--show', p.id);
    expect(s.code).toBe(0);
    expect(s.out).toContain('+   Write the tests first');
    expect(s.out).toContain(`aorch evolve --accept ${p.id}`);
    expect(aorch(w.home, 'evolve', '--accept', p.id, '--pick', '0').code).toBe(2);
    const a = aorch(w.home, 'evolve', '--accept', p.id, '--pick', '2');
    expect(a.code, a.out).toBe(0);
    expect(a.out).toMatch(/harness is now v2/);
    expect(getVersion(w.home, 'coder', 2)!.guidance).toEqual(['Run the linter before finishing']);
    expect(existsSync(join(w.home, 'vault', 'lessons', 'coder', 'harness-v2.md'))).toBe(true);
    const log = aorch(w.home, 'harness', 'coder', 'log');
    expect(log.out).toMatch(/v2.*evolve/);
    expect(aorch(w.home, 'harness', 'coder', 'diff', '1', '2').out).toContain('+   Run the linter before finishing');
    expect(aorch(w.home, 'harness', 'coder', 'rollback', '2').out).toMatch(/already the current version/);
    // a probe that dropped an edit: accepting needs an explicit --pick
    const q = await proposal(w, [edits[0]!, edits[2]!]);
    const sc = (redos: number) => ({ gatesPassed: true, redos, costUsd: 0.1, durationMs: 1 });
    saveProbe(w.home, q.id, { results: [{ task: 't', run: 'r', edit: 1, baseline: sc(0), candidate: sc(2), verdict: 'worse', costUsd: 0.1 }], spentUsd: 0.2, budgetUsd: 1 } as never);
    const refused = aorch(w.home, 'evolve', '--accept', q.id);
    expect(refused.code).toBe(2);
    expect(refused.out).toMatch(/--pick kept/);
    const kept = aorch(w.home, 'evolve', '--accept', q.id, '--pick', 'kept');
    expect(kept.code, kept.out).toBe(0);
    expect(currentHarness(w.home, coder).guidance).toEqual(['Run the linter before finishing', 'Write the tests first']);
    expect(aorch(w.home, 'probes', '--clean').out).toMatch(/deleted 0/);
  }, 60_000);
});
