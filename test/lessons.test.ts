import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHEAP_USD, FAST_MS, MAX_LESSONS_PER_BOT, extractLessons, loadLessons, mergeLessons, reflect, saveLessons, settle, similarity, type Lesson, type NewLesson } from '../src/lessons.js';
import type { StepSignal } from '../src/signals.js';
import { foldRun, type PipelineNode, type RunEvent, type StoredEvent } from '../src/types.js';
import { Vault } from '../src/vault.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

const sig = (over: Partial<StepSignal> = {}): StepSignal => ({ run: 'r1', node: 'code', bot: 'coder', redos: 0, handoffRefusals: 0, costUsd: 0.01, durationMs: 1000, ...over });
const inc = (run: string, text = 'Work gets sent back for rework repeatedly', polarity: 'do' | 'avoid' = 'avoid', node = 'code', over: Partial<NewLesson> = {}): NewLesson => ({ bot: 'coder', text, polarity, topic: `t:${text}`, provenance: 'metrics', runs: 1, evidence: [{ run, node, signal: 'redos:2', source: 'metrics' }], ...over });

describe('extractLessons', () => {
  it('2+ redos -> avoid, with the reason when given and never invented', () => {
    expect(extractLessons([sig({ redos: 1 })])).toEqual([]);
    const [a] = extractLessons([sig({ redos: 2 })]);
    expect(a).toMatchObject({ bot: 'coder', polarity: 'avoid', evidence: [{ run: 'r1', node: 'code', signal: 'redos:2' }] });
    expect(a!.text).not.toMatch(/:\s/);
    const [b] = extractLessons([sig({ redos: 3 })], { reasons: new Map([['code', { text: 'missing tests', source: 'verdict' as const }]]) });
    expect(b!.text).toContain('missing tests');
    expect(b).toMatchObject({ provenance: 'check', topic: 'rework', evidence: [{ source: 'verdict' }] });
    expect(a).toMatchObject({ provenance: 'metrics', topic: 'rework', evidence: [{ source: 'metrics' }] });
  });
  it('repeated handoff refusals -> avoid', () => {
    expect(extractLessons([sig({ handoffRefusals: 1 })])).toEqual([]);
    expect(extractLessons([sig({ handoffRefusals: 2 })])[0]).toMatchObject({ polarity: 'avoid', evidence: [{ signal: 'refusals:2' }] });
  });
  it('thumbs-down needs a note; the note is bounded and cleaned', () => {
    expect(extractLessons([sig({ feedback: 'down' })])).toEqual([]);
    const [l] = extractLessons([sig({ feedback: 'down' })], { notes: new Map([['code', `too‮ verbose ${'x'.repeat(1000)}`]]) });
    expect(l!.polarity).toBe('avoid');
    expect(l).toMatchObject({ provenance: 'feedback', evidence: [{ source: 'feedback' }] });
    expect(l!.text.length).toBeLessThanOrEqual(240);
    expect(l!.text).not.toContain('‮');
  });
  it('keep-doing only with thumbs up, no redos, passing checks, fast and cheap', () => {
    const good = sig({ feedback: 'up', gatePassed: true, verdict: 'pass', approved: true });
    const [d] = extractLessons([good]);
    expect(d).toMatchObject({ polarity: 'do', topic: 'rework', provenance: 'metrics', evidence: [{ signal: 'feedback:up', source: 'feedback' }] });
    expect(d!.text).not.toMatch(/approved/i);
    expect(extractLessons([{ ...good, feedback: undefined }])).toEqual([]);
    for (const bad of [{ redos: 1 }, { verdict: 'fail' as const }, { gatePassed: false }, { approved: false }, { durationMs: FAST_MS + 1 }, { costUsd: CHEAP_USD + 0.01 }])
      expect(extractLessons([{ ...good, ...bad }])).toEqual([]);
  });
  it('skips ids that are not bot ids', () => {
    expect(extractLessons([sig({ bot: '../x', redos: 5 })])).toEqual([]);
  });
});

describe('mergeLessons', () => {
  it('reflecting the same run twice does not raise runs', () => {
    const once = mergeLessons([], [inc('r1')]);
    const twice = mergeLessons(once, [inc('r1')]);
    expect(twice).toHaveLength(1);
    expect(twice[0]!.runs).toBe(1);
    expect(twice[0]!.evidence).toHaveLength(1);
    expect(twice[0]!.id).toBe(once[0]!.id);
  });
  it('merges similar text, stable bot-hash ids, evidence from several nodes of one run is one run', () => {
    let ls = mergeLessons([], [inc('r1', 'Work gets sent back for rework: missing tests')]);
    ls = mergeLessons(ls, [inc('r2', 'Work gets sent back for rework: missing tests please'), inc('r2', 'Work gets sent back for rework: missing tests', 'avoid', 'other')]);
    expect(ls).toHaveLength(1);
    expect(ls[0]!.id).toMatch(/^coder-[0-9a-f]{8}$/);
    expect(ls[0]!.runs).toBe(2);
    expect(ls[0]!.evidence).toHaveLength(3);
    expect(similarity('a b c', 'a b d')).toBeLessThan(0.7);
  });
  it('confident at 3 distinct runs, tentative at 2', () => {
    const two = mergeLessons([], [inc('r1'), inc('r2')]);
    expect(two[0]!.status).toBe('tentative');
    const three = mergeLessons(two, [inc('r3')]);
    expect(three[0]).toMatchObject({ runs: 3, status: 'confident' });
    expect(mergeLessons(two, [inc('r3')], 4)[0]!.status).toBe('tentative');
  });
  it('conflicting polarity stays tentative, and a later conflict demotes a confident lesson', () => {
    const avoid = mergeLessons([], [inc('r1'), inc('r2'), inc('r3')]);
    expect(avoid[0]!.status).toBe('confident');
    const mixed = mergeLessons(avoid, [inc('r4', undefined, 'do'), inc('r5', undefined, 'do'), inc('r6', undefined, 'do')]);
    expect(mixed).toHaveLength(2);
    expect(mixed.every((l) => l.runs >= 3 && l.status === 'tentative')).toBe(true);
  });
  it('different bots never merge; caps drop the oldest tentative first', () => {
    const other = mergeLessons([], [inc('r1'), { ...inc('r1'), bot: 'reviewer' }]);
    expect(other).toHaveLength(2);
    let ls: Lesson[] = mergeLessons([], [inc('a1', 'confident thing one'), inc('a2', 'confident thing one'), inc('a3', 'confident thing one')], 3, new Date(1000));
    for (let i = 0; i < 205; i++) ls = mergeLessons(ls, [inc(`x${i}`, `unique${i} alpha${i} beta${i}`)], 3, new Date(2000 + i));
    expect(ls).toHaveLength(200);
    expect(ls.some((l) => l.status === 'confident')).toBe(true);
    expect(ls.some((l) => l.text.startsWith('unique0 '))).toBe(false);
    expect(ls.some((l) => l.text.startsWith('unique204 '))).toBe(true);
  });
});

describe('mergeLessons: topics, provenance, replacement, eviction', () => {
  const fam = (run: string, polarity: 'do' | 'avoid', text: string) => inc(run, text, polarity, 'code', { topic: 'rework' });
  it('a do and an avoid on the same topic conflict even with different text; both stay tentative', () => {
    const ls = mergeLessons([], [fam('r1', 'avoid', 'Work gets sent back for rework: tests'), fam('r2', 'avoid', 'Work gets sent back for rework: tests'), fam('r3', 'avoid', 'Work gets sent back for rework: tests'), fam('r4', 'do', 'Work was liked and needed no rework'), fam('r5', 'do', 'Work was liked and needed no rework'), fam('r6', 'do', 'Work was liked and needed no rework')]);
    expect(ls.map((l) => [l.polarity, l.runs, l.status])).toEqual([['avoid', 3, 'tentative'], ['do', 3, 'tentative']]);
  });
  it('replacing a run retracts its old evidence everywhere and never counts it twice', () => {
    let ls = mergeLessons([], [inc('r1', 'liked it', 'do'), inc('r2', 'liked it', 'do')]);
    ls = mergeLessons(ls, [inc('r1', 'too verbose', 'avoid')], 3, new Date(), 'r1');
    expect(ls.map((l) => [l.text, l.runs])).toEqual([['liked it', 1], ['too verbose', 1]]);
    ls = mergeLessons(ls, [], 3, new Date(), 'r2');
    expect(ls.map((l) => l.text)).toEqual(['too verbose']);
  });
  it('a check-derived lesson needs 3 runs or feedback evidence, whatever minRuns says', () => {
    const chk = (run: string, extra: NewLesson['evidence'] = []) => inc(run, 'Work gets sent back: lint', 'avoid', 'code', { provenance: 'check', evidence: [{ run, node: 'code', signal: 'redos:2', source: 'verdict' }, ...extra] });
    expect(mergeLessons([], [chk('r1'), chk('r2')], 2)[0]!.status).toBe('tentative');
    expect(mergeLessons([], [chk('r1'), chk('r2'), chk('r3')], 2)[0]!.status).toBe('confident');
    const withFb = mergeLessons([], [chk('r1', [{ run: 'r1', node: 'code', signal: 'feedback:down', source: 'feedback' }]), chk('r2')], 2);
    expect(withFb[0]).toMatchObject({ status: 'confident', provenance: 'check' });
    // a metrics lesson has no such extra rule
    expect(mergeLessons([], [inc('r1'), inc('r2')], 2)[0]!.status).toBe('confident');
  });
  it('picks the best match, and tokenless text is never a lesson', () => {
    let ls = mergeLessons([], [inc('r1', 'alpha beta gamma delta epsilon zeta eta'), inc('r1', 'alpha beta gamma delta epsilon zeta theta')]);
    expect(ls).toHaveLength(1); // 6/8 = 0.75 similar
    ls = mergeLessons([], [inc('r1', 'one two three four five six seven eight'), inc('r2', 'one two three four five six seven nine'), inc('r3', 'one two three four five six seven eight')]);
    expect(ls.map((l) => l.runs)).toEqual([3]);
    expect(mergeLessons([], [inc('r1', '!!! ???'), inc('r2', '***')])).toEqual([]);
    expect(similarity('!!!', '???')).toBe(0);
  });
  it('evicts before computing status: a conflicting counterpart that is evicted no longer blocks', () => {
    const old = new Date(1000);
    let ls = mergeLessons([], [fam('a1', 'do', 'liked'), ...['b1', 'b2', 'b3'].map((r) => fam(r, 'avoid', 'sent back repeatedly'))], 3, old);
    expect(ls.find((l) => l.polarity === 'avoid')!.status).toBe('tentative');
    ls = ls.map((l) => (l.polarity === 'do' ? { ...l, updatedAt: new Date(1).toISOString() } : { ...l, updatedAt: new Date(2).toISOString() }));
    const fill = Array.from({ length: MAX_LESSONS_PER_BOT - 1 }, (_, i) => inc(`f${i}`, `filler${i} word${i} more${i}`));
    ls = mergeLessons(ls, fill, 3, new Date(5000));
    expect(ls).toHaveLength(MAX_LESSONS_PER_BOT);
    expect(ls.some((l) => l.polarity === 'do')).toBe(false);
    expect(ls.find((l) => l.polarity === 'avoid')!.status).toBe('confident');
  });
  it('settle recomputes status from evidence and conflicts, whatever it said before', () => {
    const [l] = mergeLessons([], [inc('r1')]);
    expect(settle([{ ...l!, status: 'confident' }], 3)[0]!.status).toBe('tentative');
  });
});

describe('storage', () => {
  it('round-trips and writes atomically (no tmp left)', () => {
    const home = tmp();
    const ls = mergeLessons([], [inc('r1')]);
    saveLessons(home, 'coder', ls);
    expect(loadLessons(home, 'coder')).toEqual(ls);
    expect(readdirSync(join(home, 'harness', 'coder')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(loadLessons(home, 'reviewer')).toEqual([]);
  });
  it('corrupt file reads as empty and is kept as .bak when overwritten', () => {
    const home = tmp();
    mkdirSync(join(home, 'harness', 'coder'), { recursive: true });
    const f = join(home, 'harness', 'coder', 'lessons.json');
    writeFileSync(f, '{not json');
    expect(loadLessons(home, 'coder')).toEqual([]);
    saveLessons(home, 'coder', mergeLessons([], [inc('r1')]));
    expect(readFileSync(`${f}.bak`, 'utf8')).toBe('{not json');
    expect(loadLessons(home, 'coder')).toHaveLength(1);
  });
  it('never trusts a stored status: confident with too few runs loads as tentative', () => {
    const home = tmp();
    const [l] = mergeLessons([], [inc('r1')]);
    mkdirSync(join(home, 'harness', 'coder'), { recursive: true });
    writeFileSync(join(home, 'harness', 'coder', 'lessons.json'), JSON.stringify({ version: 1, lessons: [{ ...l, status: 'confident' }] }));
    expect(loadLessons(home, 'coder')[0]!.status).toBe('tentative');
    expect(loadLessons(home, 'coder', 1)[0]!.status).toBe('confident');
  });
  it('an I/O error is not corruption: load throws, save refuses, nothing is overwritten or backed up', () => {
    const home = tmp();
    mkdirSync(join(home, 'harness', 'coder', 'lessons.json'), { recursive: true }); // a directory where the file belongs: EISDIR even as root
    expect(() => loadLessons(home, 'coder')).toThrow();
    expect(() => saveLessons(home, 'coder', mergeLessons([], [inc('r1')]))).toThrow();
    expect(statSync(join(home, 'harness', 'coder', 'lessons.json')).isDirectory()).toBe(true);
    expect(existsSync(join(home, 'harness', 'coder', 'lessons.json.bak'))).toBe(false);
  });
  it('does not create the home (teardown) when saving', () => {
    const home = join(tmp(), 'gone');
    expect(() => saveLessons(home, 'coder', mergeLessons([], [inc('r1')]))).toThrow();
    expect(existsSync(home)).toBe(false);
  });
  it('a file that would exceed the cap is pruned to fit, not refused', () => {
    const home = tmp();
    const big: Lesson[] = Array.from({ length: MAX_LESSONS_PER_BOT }, (_, i) => ({
      id: `coder-${String(i).padStart(8, '0')}`,
      bot: 'coder',
      text: `lesson ${i} ${'w'.repeat(200)}`,
      polarity: 'avoid',
      topic: `t${i}`,
      provenance: 'metrics',
      evidence: Array.from({ length: 60 }, (_, k) => ({ run: `run-${'r'.repeat(70)}${k}`, node: 'n'.repeat(70), signal: 'redos:2', source: 'metrics' as const })),
      runs: 60,
      status: 'confident',
      updatedAt: new Date(i).toISOString(),
    }));
    const saved = saveLessons(home, 'coder', big);
    expect(statSync(join(home, 'harness', 'coder', 'lessons.json')).size).toBeLessThanOrEqual(2_000_000);
    expect(saved.length).toBeGreaterThan(0);
    expect(loadLessons(home, 'coder').length).toBe(saved.length);
  });
  it('drops malformed or foreign entries and prototype keys; refuses bad bot ids', () => {
    const home = tmp();
    mkdirSync(join(home, 'harness', 'coder'), { recursive: true });
    writeFileSync(
      join(home, 'harness', 'coder', 'lessons.json'),
      JSON.stringify({ lessons: [{ id: 'coder-aaaaaaaa', bot: 'coder', text: 'ok', polarity: 'do', evidence: [{ run: 'r', node: 'n', signal: 's' }], status: 'confident', __proto__: { x: 1 } }, { id: 'x', bot: 'reviewer', text: 'no', polarity: 'do', evidence: [] }, 5] }),
    );
    const ls = loadLessons(home, 'coder');
    expect(ls.map((l) => l.id)).toEqual(['coder-aaaaaaaa']);
    expect(ls[0]!.runs).toBe(1);
    expect(() => loadLessons(home, '../etc')).toThrow();
    expect(() => loadLessons(home, '__proto__')).toThrow();
  });
});


// ---------- reflect ----------
const nodes: Partial<PipelineNode>[] = [{ id: 'code', role: 'coder' }, { id: 'rev', role: 'reviewer', verdict: true, fixNode: 'code' }];
const fin = (node: string, over: Record<string, unknown> = {}): RunEvent => ({ type: 'node.finished', node, status: 'done', output: 'ok', durationMs: 100, costUsd: 0.01, attempt: 1, ...over }) as RunEvent;
function runLog(id: string, evs: RunEvent[]): { s: ReturnType<typeof foldRun>; events: StoredEvent[] } {
  const p = pipe(nodes, [['code', 'rev']]);
  const all: RunEvent[] = [{ type: 'run.started', pipeline: p, task: 't', repo: '/r', workdir: '/w', baseSha: 'x', branch: 'b' }, ...evs];
  const events = all.map((event, i) => ({ runId: id, seq: i + 1, ts: 1000 * (i + 1), event }));
  return { s: foldRun(events), events };
}
const badRun = (id: string, reason = 'Missing tests for edge cases') =>
  runLog(id, [
    fin('code'),
    fin('rev', { status: 'error', verdict: 'FAIL', output: `VERDICT: FAIL ${reason}\nmore detail [[Secret]]` }),
    { type: 'loop', check: 'rev', fixNode: 'code', n: 1 },
    fin('code', { attempt: 2 }),
    fin('rev', { status: 'error', verdict: 'FAIL', attempt: 2, output: `VERDICT: FAIL ${reason}` }),
    { type: 'loop', check: 'rev', fixNode: 'code', n: 2 },
    fin('code', { attempt: 3 }),
    fin('rev', { verdict: 'PASS', attempt: 3 }),
  ]);
const goodRun = (id: string, fb: RunEvent[] = [{ type: 'feedback', node: 'code', rating: 'up' }]) => runLog(id, [fin('code'), fin('rev', { verdict: 'PASS' }), ...fb]);
const refl = (home: string, r: { s: ReturnType<typeof foldRun>; events: StoredEvent[] }, vault?: Vault) => reflect(home, r.s!, vault, r.events);

describe('reflect', () => {
  it('writes lessons per bot with the reason from the verdict text; same run twice is idempotent; confident at 3 runs writes one vault note', async () => {
    const home = tmp();
    const vault = new Vault(tmp('vault-'));
    for (const id of ['r1', 'r1', 'r2']) await refl(home, badRun(id), vault);
    let ls = loadLessons(home, 'coder');
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ runs: 2, status: 'tentative', polarity: 'avoid', provenance: 'check', topic: 'rework' });
    expect(ls[0]!.evidence.every((e) => e.source === 'verdict')).toBe(true);
    expect(ls[0]!.text).toContain('Missing tests for edge cases');
    expect(loadLessons(home, 'reviewer')).toEqual([]); // no lesson from a reviewer's verdicts
    expect(existsSync(join(vault.root, 'lessons'))).toBe(false);

    const out = await refl(home, badRun('r3'), vault);
    ls = loadLessons(home, 'coder');
    expect(ls[0]).toMatchObject({ runs: 3, status: 'confident' });
    expect(out.map((l) => l.id)).toEqual([ls[0]!.id]);
    const note = readFileSync(join(vault.root, 'lessons', 'coder', `${ls[0]!.id}.md`), 'utf8');
    expect(note).toContain('Missing tests for edge cases');
    expect(note).not.toContain('[[');
  });
  it('neutralises links in notes of confident lessons', async () => {
    const home = tmp();
    const vault = new Vault(tmp('vault-'));
    for (const id of ['r1', 'r2', 'r3']) await refl(home, goodRun(id, [{ type: 'feedback', node: 'code', rating: 'down', note: 'see [[Secret/Plan]] first' }]), vault);
    const ls = loadLessons(home, 'coder');
    expect(ls[0]).toMatchObject({ status: 'confident', provenance: 'feedback' });
    const note = readFileSync(join(vault.root, 'lessons', 'coder', `${ls[0]!.id}.md`), 'utf8');
    expect(note).toContain('[ [Secret/Plan] ]');
    expect(note).not.toContain('[[');
  });

  it('conflicting evidence from real runs: rework in three runs, liked in three others -> both tentative, and the vault note is retired', async () => {
    const home = tmp();
    const vault = new Vault(tmp('vault-'));
    for (const id of ['b1', 'b2', 'b3']) await refl(home, badRun(id), vault);
    const avoid = loadLessons(home, 'coder')[0]!;
    expect(avoid.status).toBe('confident');
    const notePath = join(vault.root, 'lessons', 'coder', `${avoid.id}.md`);
    expect(readFileSync(notePath, 'utf8')).toContain('Missing tests');
    for (const id of ['g1', 'g2', 'g3']) await refl(home, goodRun(id), vault);
    const ls = loadLessons(home, 'coder');
    expect(ls.map((l) => [l.polarity, l.runs, l.status]).sort()).toEqual([['avoid', 3, 'tentative'], ['do', 3, 'tentative']]);
    const retired = readFileSync(notePath, 'utf8');
    expect(retired).toMatch(/retired/i);
    expect(retired).not.toContain('Missing tests');
    expect(readdirSync(join(vault.root, 'lessons', 'coder'))).toEqual([`${avoid.id}.md`]); // the do lesson never got a note
  });

  it('a flipped rating moves the evidence: up then down on the same run is one run in one lesson', async () => {
    const home = tmp();
    await refl(home, goodRun('r1', [{ type: 'feedback', node: 'code', rating: 'up' }]));
    expect(loadLessons(home, 'coder').map((l) => [l.polarity, l.runs])).toEqual([['do', 1]]);
    await refl(home, goodRun('r1', [{ type: 'feedback', node: 'code', rating: 'up' }, { type: 'feedback', node: 'code', rating: 'down', note: 'too verbose' }]));
    expect(loadLessons(home, 'coder').map((l) => [l.polarity, l.runs, l.text])).toEqual([['avoid', 1, 'Person said: too verbose']]);
    await refl(home, goodRun('r1', [{ type: 'feedback', node: 'code', rating: 'down', note: 'too verbose' }, { type: 'feedback', node: 'code', rating: 'up' }]));
    expect(loadLessons(home, 'coder').map((l) => [l.polarity, l.runs])).toEqual([['do', 1]]);
  });
  it('an edited note replaces the old one for that run', async () => {
    const home = tmp();
    await refl(home, goodRun('r1', [{ type: 'feedback', node: 'code', rating: 'down', note: 'too verbose' }]));
    await refl(home, goodRun('r2', [{ type: 'feedback', node: 'code', rating: 'down', note: 'too verbose' }]));
    await refl(home, goodRun('r1', [{ type: 'feedback', node: 'code', rating: 'down', note: 'ignores the style guide entirely' }]));
    const ls = loadLessons(home, 'coder');
    expect(ls.map((l) => [l.text, l.runs]).sort()).toEqual([['Person said: ignores the style guide entirely', 1], ['Person said: too verbose', 1]]);
  });

  it('failure cases have observable outcomes', async () => {
    // a file where the harness directory belongs fails even as root: nothing returned, file untouched
    const blocked = tmp();
    writeFileSync(join(blocked, 'harness'), 'a file, not a directory');
    expect(await refl(blocked, badRun('r1'))).toEqual([]);
    expect(readFileSync(join(blocked, 'harness'), 'utf8')).toBe('a file, not a directory');
    // an I/O error on the lessons file: nothing returned, the directory is not replaced
    const io = tmp();
    mkdirSync(join(io, 'harness', 'coder', 'lessons.json'), { recursive: true });
    expect(await refl(io, badRun('r1'))).toEqual([]);
    expect(statSync(join(io, 'harness', 'coder', 'lessons.json')).isDirectory()).toBe(true);
    // a vanished home is not recreated
    const gone = join(tmp(), 'gone');
    expect(await refl(gone, badRun('r1'))).toEqual([]);
    expect(existsSync(gone)).toBe(false);
    // a failing vault does not stop lessons being saved
    const vaultFile = join(tmp(), 'v');
    writeFileSync(vaultFile, 'x');
    const home = tmp();
    let out: Lesson[] = [];
    for (const id of ['r1', 'r2', 'r3']) out = await refl(home, badRun(id), new Vault(vaultFile));
    expect(out).toHaveLength(1);
    expect(loadLessons(home, 'coder')).toMatchObject([{ runs: 3, status: 'confident' }]);
  });
});

class HangingVault extends Vault {
  override async writeNote(rel: string, content: string, opts?: { overwrite?: boolean }): Promise<boolean> {
    if (rel.startsWith('lessons/')) return new Promise(() => {});
    return super.writeNote(rel, content, opts);
  }
}
const reviewed = (opts: Record<string, unknown> = {}) => ({
  pipeline: pipe([{ id: 'code', role: 'coder', mock: { output: 'hi' } }, { id: 'rev', role: 'reviewer', verdict: true, readOnly: true, fixNode: 'code', mock: { verdicts: ['FAIL', 'FAIL', 'PASS'] } }], [['code', 'rev']]),
  task: 't',
  ...opts,
});

describe('engine hook', () => {
  it('finish() reflects a finished run: redos make a lesson without any feedback', async () => {
    const { engine, home, store } = setup();
    const id = await engine.start({ ...reviewed(), repo: makeRepo() });
    await engine.wait(id);
    expect(store.state(id)!.status).toBe('done');
    expect(existsSync(join(home, 'harness', 'coder', 'lessons.json'))).toBe(true);
    expect(loadLessons(home, 'coder')).toMatchObject([{ polarity: 'avoid', runs: 1, evidence: [{ run: id }] }]);
  });
  it('reflect:false is honoured for finish() and for later feedback', async () => {
    const { engine, home } = setup();
    const id = await engine.start({ ...reviewed(), repo: makeRepo(), reflect: false });
    await engine.wait(id);
    engine.feedback(id, 'code', 'down', 'be terser');
    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(join(home, 'harness', 'coder', 'lessons.json'))).toBe(false);
  });
  it('feedback after the run reflects it, once per run', async () => {
    const { engine, home } = setup();
    const id = await engine.start({ pipeline: pipe([{ id: 'code', role: 'coder', mock: { output: 'hi' } }], []), task: 't', repo: makeRepo() });
    await engine.wait(id);
    engine.feedback(id, 'code', 'down', 'be terser');
    await new Promise((r) => setTimeout(r, 200));
    expect(loadLessons(home, 'coder')).toMatchObject([{ text: 'Person said: be terser', runs: 1 }]);
    engine.feedback(id, 'code', 'up');
    await new Promise((r) => setTimeout(r, 200));
    expect(loadLessons(home, 'coder').map((l) => [l.polarity, l.runs])).toEqual([['do', 1]]);
  });
  it('a broken home never fails the run', async () => {
    const bad = setup();
    writeFileSync(join(bad.home, 'harness'), 'blocker');
    const id = await bad.engine.start({ ...reviewed(), repo: makeRepo() });
    await bad.engine.wait(id);
    expect(bad.store.state(id)!.status).toBe('done');
    expect(readFileSync(join(bad.home, 'harness'), 'utf8')).toBe('blocker');
  });
  it('a hanging vault delays the run result by at most the reflect timeout', async () => {
    const vault = new HangingVault(tmp('vault-'));
    const { engine, home, store } = setup(vault);
    // two earlier runs already support the lesson, so this run makes it confident and writes a note (which hangs)
    const text = 'Work gets sent back for rework: mock output from rev';
    const chk = { topic: 'rework', provenance: 'check' as const };
    saveLessons(home, 'coder', mergeLessons([], [inc('x1', text, 'avoid', 'code', chk), inc('x2', text, 'avoid', 'code', chk)]));
    (engine as unknown as { opts: { reflectTimeoutMs?: number } }).opts.reflectTimeoutMs = 100;
    const t0 = Date.now();
    const id = await engine.start({ ...reviewed(), repo: makeRepo() });
    await engine.wait(id);
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(store.state(id)!.status).toBe('done');
    expect(loadLessons(home, 'coder')[0]).toMatchObject({ runs: 3, status: 'confident' }); // the lessons were saved before the vault hung
  });
});
