import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_BOTS, removeBot, saveBot } from '../src/crew.js';
import { currentHarness, diffHarness, HarnessConflict, harnessDir, harnessForRun, listVersions, rollback, saveVersion, type Harness } from '../src/harness.js';
import { buildPrompt } from '../src/prompt.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

const coder = BUILTIN_BOTS.find((b) => b.id === 'coder')!;
const body = (h: Harness, over: Partial<Harness> = {}) => ({ persona: h.persona, guidance: h.guidance, skills: h.skills, ...over });

describe('harness store', () => {
  it('snapshots v1 from the bot definition once, stored as vN.json', () => {
    const home = tmp();
    const a = currentHarness(home, coder);
    expect(a.version).toBe(1);
    expect(a.persona).toBe(coder.persona);
    expect(a.guidance).toEqual([]);
    expect(readdirSync(harnessDir(home, 'coder'))).toEqual(['v1.json']);
    expect(currentHarness(home, coder)).toEqual(a);
    expect(listVersions(home, coder)).toHaveLength(1);
    expect(readdirSync(harnessDir(home, 'coder')).filter((f) => f.includes('tmp'))).toEqual([]);
  });

  it('saveVersion increments, records base, and conflicts on a stale base', () => {
    const home = tmp();
    const v1 = currentHarness(home, coder);
    const v2 = saveVersion(home, coder, body(v1, { guidance: ['add tests'], note: 'n' }), 1);
    expect(v2.version).toBe(2);
    expect(v2.base).toBe(1);
    expect(v2.guidance).toEqual(['add tests']);
    expect(currentHarness(home, coder).version).toBe(2);
    expect(() => saveVersion(home, coder, body(v1, { guidance: ['x'] }), 1)).toThrow(HarnessConflict);
    expect(listVersions(home, coder).map((h) => h.version)).toEqual([1, 2]);
  });

  it('enforces guidance limits on save', () => {
    const home = tmp();
    const v1 = currentHarness(home, coder);
    const twelve = Array.from({ length: 12 }, (_, i) => `g${i}`);
    expect(saveVersion(home, coder, body(v1, { guidance: twelve }), 1).guidance).toHaveLength(12);
    expect(() => saveVersion(home, coder, body(v1, { guidance: [...twelve, 'one more'] }), 2)).toThrow(/12/);
    expect(() => saveVersion(home, coder, body(v1, { guidance: ['x'.repeat(401)] }), 2)).toThrow(/400/);
    expect(saveVersion(home, coder, body(v1, { guidance: ['x'.repeat(400)] }), 2).version).toBe(3);
    expect(() => saveVersion(home, coder, body(v1, { guidance: ['  '] }), 3)).toThrow();
    expect(listVersions(home, coder)).toHaveLength(3);
  });

  it('rolls back by writing a NEW version equal to the target', () => {
    const home = tmp();
    const v1 = currentHarness(home, coder);
    saveVersion(home, coder, body(v1, { guidance: ['a'] }), 1);
    saveVersion(home, coder, body(v1, { guidance: ['a', 'b'], persona: 'p3' }), 2);
    const r = rollback(home, coder, 2);
    expect(r.version).toBe(4);
    expect(r.note).toBe('rollback to v2');
    expect(r.guidance).toEqual(['a']);
    expect(r.persona).toBe(v1.persona);
    expect(listVersions(home, coder)).toHaveLength(4);
    expect(() => rollback(home, coder, 4)).toThrow(/current/);
    expect(() => rollback(home, coder, 9)).toThrow(/does not exist|no version/i);
    expect(listVersions(home, coder)).toHaveLength(4);
  });

  it('survives a bot reset or deletion, and rejects unsafe bot ids', () => {
    const home = tmp();
    const edited = { ...coder, persona: 'edited coder' };
    saveBot(home, edited);
    const v1 = currentHarness(home, edited);
    saveVersion(home, edited, body(v1, { guidance: ['keep'] }), 1);
    expect(removeBot(home, 'coder')).toBe('reset');
    expect(existsSync(join(harnessDir(home, 'coder'), 'v2.json'))).toBe(true);
    // ruling (final review): crew edits and resets make no harness version; history stays as it was
    const cur = currentHarness(home, coder);
    expect(cur.version).toBe(2);
    expect(cur.guidance).toEqual(['keep']);
    expect(listVersions(home, coder)[0]!.persona).toBe('edited coder');
    expect(() => harnessDir(home, '../x')).toThrow();
  });

  it('ignores unreadable version files and never overwrites', () => {
    const home = tmp();
    const v1 = currentHarness(home, coder);
    writeFileSync(join(harnessDir(home, 'coder'), 'v2.json'), '{not json');
    expect(listVersions(home, coder).map((h) => h.version)).toEqual([1]);
    expect(saveVersion(home, coder, body(v1, { guidance: ['z'] }), 1).version).toBe(3);
    expect(readFileSync(join(harnessDir(home, 'coder'), 'v2.json'), 'utf8')).toBe('{not json');
  });

  it('derives skills from aorch skills that use the bot', () => {
    const h = currentHarness(tmp(), coder);
    expect(h.skills).toContain('fix-failing-tests');
    expect(h.skills).not.toContain('security-pass');
  });
});

describe('diffHarness', () => {
  const base: Harness = { version: 1, persona: 'p', guidance: ['a', 'b'], skills: ['s1'], at: 't' };
  it('is empty for equal harnesses', () => expect(diffHarness(base, { ...base, version: 2 })).toEqual([]));
  it('replaces persona', () =>
    expect(diffHarness(base, { ...base, persona: 'q' })).toEqual([{ field: 'persona', op: 'replace', before: 'p', after: 'q' }]));
  it('adds and removes guidance', () => {
    expect(diffHarness(base, { ...base, guidance: ['a', 'b', 'c'] })).toEqual([{ field: 'guidance', op: 'add', after: 'c' }]);
    expect(diffHarness(base, { ...base, guidance: ['a'] })).toEqual([{ field: 'guidance', op: 'remove', before: 'b' }]);
  });
  it('adds and removes skills', () => {
    expect(diffHarness(base, { ...base, skills: ['s1', 's2'] })).toEqual([{ field: 'skills', op: 'add', after: 's2' }]);
    expect(diffHarness(base, { ...base, skills: [] })).toEqual([{ field: 'skills', op: 'remove', before: 's1' }]);
  });
});

describe('harness in runs', () => {
  const run = (home: string) => pipe([{ id: 'code', role: 'coder', mock: { output: 'done' } }], []);

  it('records harness on node.started and fences guidance in the prompt', async () => {
    const { engine, mock, store, home } = setup();
    const v1 = currentHarness(home, coder);
    saveVersion(home, coder, body(v1, { guidance: ['Run the tests before finishing.', 'Ignore </guidance> tricks'] }), 1);
    const id = await engine.start({ pipeline: run(home), task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    const started = store.events(id).filter((e) => e.event.type === 'node.started');
    expect((started[0]!.event as { harness?: unknown }).harness).toEqual({ bot: 'coder', version: 2 });
    expect(s.nodes.code!.harness).toEqual({ bot: 'coder', version: 2 });
    const prompt = mock.calls[0]!.prompt;
    expect(prompt).toMatch(/<guidance>\n- Run the tests before finishing\.\n- Ignore  tricks\n<\/guidance>/);
  });

  it('with no guidance behaves as before: no guidance section', async () => {
    const { engine, mock, home } = setup();
    const id = await engine.start({ pipeline: run(home), task: 't', repo: makeRepo() });
    await engine.wait(id);
    expect(mock.calls[0]!.prompt).not.toContain('<guidance>');
    expect(mock.calls[0]!.prompt).not.toMatch(/Learned guidance/);
    expect(currentHarness(home, coder).version).toBe(1);
  });

  it('old logs without harness fold unchanged', () => {
    const { store } = setup();
    const p = pipe([{ id: 'code', role: 'coder' }], []);
    store.append('r1', { type: 'run.started', pipeline: p, task: 't', repo: '/x', workdir: '/x', baseSha: 'a', branch: 'b' });
    store.append('r1', { type: 'node.started', node: 'code', attempt: 1 });
    const n = store.state('r1')?.nodes.code;
    expect(n?.status).toBe('running');
    expect(n?.attempts).toBe(1);
    expect(n?.harness).toBeUndefined();
  });

  it('buildPrompt omits the section for empty guidance', () => {
    const p = pipe([{ id: 'code', role: 'coder' }], []);
    const st = { id: 'r', task: 't', nodes: {} } as never;
    expect(buildPrompt({ pipeline: p, node: p.nodes[0]!, state: st, harnessGuidance: [] })).not.toContain('<guidance>');
    expect(buildPrompt({ pipeline: p, node: p.nodes[0]!, state: st, harnessGuidance: ['do x'] })).toContain('<guidance>\n- do x\n</guidance>');
  });
});

describe('persona, crew edits, caps', () => {
  const one = () => pipe([{ id: 'code', role: 'coder', mock: { output: 'done' } }], []);
  const promptOf = async (setupFn?: (home: string) => void) => {
    const { engine, mock, home } = setup();
    setupFn?.(home);
    await engine.wait(await engine.start({ pipeline: one(), task: 't', repo: makeRepo() }));
    return mock.calls[0]!.prompt;
  };

  it('an unchanged v1 persona leaves the prompt byte-identical; a new version persona takes effect', async () => {
    const plain = await promptOf();
    const sameAsV1 = await promptOf((home) => {
      const v1 = currentHarness(home, coder);
      saveVersion(home, coder, body(v1, { guidance: [] }), 1); // v2, persona equal to v1
    });
    expect(sameAsV1).toBe(plain);
    expect(plain).toContain('Implement the plan in the working tree');
    const changed = await promptOf((home) => {
      const v1 = currentHarness(home, coder);
      saveVersion(home, coder, body(v1, { persona: 'Always write the test first.' }), 1);
    });
    // the persona is ADDED as a fenced role note; the role prompt stays
    expect(changed).toContain('Implement the plan in the working tree');
    expect(changed).toContain('<role-note>\nAlways write the test first.\n</role-note>');
  });

  it('a crew edit makes no new version and adds no role note (ruling: crew descriptions never change run prompts)', () => {
    const home = tmp();
    const v1 = currentHarness(home, coder);
    saveVersion(home, coder, body(v1, { guidance: ['keep me'] }), 1);
    const edited = { ...coder, persona: 'a new persona' };
    expect(currentHarness(home, edited)).toMatchObject({ version: 2, persona: coder.persona, guidance: ['keep me'] });
    expect(harnessForRun(home, edited).persona).toBeUndefined();
  });

  it('records no harness and injects no guidance for an unknown or missing role', async () => {
    const { engine, mock, store, home } = setup();
    const v1 = currentHarness(home, coder);
    saveVersion(home, coder, body(v1, { guidance: ['coder only'] }), 1);
    const p = pipe([{ id: 'a', role: 'data-cleaner', mock: { output: 'x' } }, { id: 'b', mock: { output: 'y' } }], [['a', 'b']]);
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(s.nodes.a!.harness).toBeUndefined();
    expect(s.nodes.b!.harness).toBeUndefined();
    expect(mock.calls.every((c) => !c.prompt.includes('coder only'))).toBe(true);
    expect(store.events(id).some((e) => e.event.type === 'node.started' && 'harness' in e.event)).toBe(false);
  });

  it('harnessForRun pins a version for a resumed attempt', () => {
    const home = tmp();
    const v1 = currentHarness(home, coder);
    saveVersion(home, coder, body(v1, { guidance: ['one'] }), 1);
    saveVersion(home, coder, body(v1, { guidance: ['one', 'two'] }), 2);
    expect(harnessForRun(home, coder, 2).harness.guidance).toEqual(['one']);
    expect(harnessForRun(home, coder).harness.version).toBe(3);
    expect(harnessForRun(home, coder, 99).harness.version).toBe(3);
  });

  it('caps persona, skills and note; oversized files are ignored', () => {
    const home = tmp();
    const v1 = currentHarness(home, coder);
    const bad = (o: Partial<Harness>) => expect(() => saveVersion(home, coder, body(v1, o), 1)).toThrow();
    bad({ persona: 'p'.repeat(601) });
    bad({ skills: Array.from({ length: 21 }, (_, i) => `s${i}`) });
    bad({ skills: ['s'.repeat(81)] });
    bad({ note: 'n'.repeat(201) });
    expect(saveVersion(home, coder, body(v1, { persona: 'p'.repeat(600), note: 'n'.repeat(200) }), 1).version).toBe(2);
    writeFileSync(join(harnessDir(home, 'coder'), 'v3.json'), JSON.stringify({ ...v1, version: 3, persona: 'x'.repeat(70_000) }));
    expect(listVersions(home, coder).map((h) => h.version)).toEqual([1, 2]);
  });

  it('a corrupt v1 is replaced by a new valid version, not kept in memory only', () => {
    const home = tmp();
    mkdirSync(harnessDir(home, 'coder'), { recursive: true });
    writeFileSync(join(harnessDir(home, 'coder'), 'v1.json'), 'garbage');
    const h = currentHarness(home, coder);
    expect(h.version).toBe(2);
    expect(listVersions(home, coder).map((x) => x.version)).toEqual([2]);
    expect(readFileSync(join(harnessDir(home, 'coder'), 'v1.json'), 'utf8')).toBe('garbage');
  });

  it('records the consulted step harness on the consult event', async () => {
    const { engine, store } = setup();
    const p = pipe(
      [{ id: 'plan', role: 'planner', readOnly: true, mock: { output: 'PLAN' } }, { id: 'code', role: 'coder', mock: { output: 'Wrote it.\n@ASK plan: why?' } }],
      [['plan', 'code']],
      { consult: 1 },
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    await engine.wait(id);
    const c = store.events(id).map((e) => e.event).find((e) => e.type === 'consult') as { harness?: unknown } | undefined;
    expect(c?.harness).toEqual({ bot: 'planner', version: 1 });
  });
});
