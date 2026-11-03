import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Exec } from '../src/exec.js';
import { buildPrompt, CAREFUL } from '../src/prompt.js';
import { MAX_FILE_BYTES } from '../src/history.js';
import { landRun, RunShip } from '../src/runShip.js';
import { soloPipeline } from '../src/solo.js';
import type { MockScript, StoredEvent } from '../src/types.js';
import { makeRepo, pipe, plainFolder, setup, tmp } from './helpers.js';

/** Holds a landing open at its start, for as long as a test needs, without a huge folder. Everything else is the real thing. */
const held = vi.hoisted(() => ({ gate: undefined as Promise<void> | undefined }));
vi.mock('../src/history.js', async (real) => {
  const h = await real<typeof import('../src/history.js')>();
  return { ...h, landBranch: async (...a: Parameters<typeof h.landBranch>) => (await held.gate, h.landBranch(...a)) };
});

const read = (dir: string, f: string) => readFileSync(join(dir, f), 'utf8');
const CONFLICT = (f: string) => `${f} changed since this work started, so nothing in the folder was changed. Keep your version, or rewind this run from its page and run it again.`;
const GIT_WORDS = /\b(git|branch|merge|commit|repository|fatal)\b/i;

/** A finished solo run. `writes` is what its one step writes; `during` runs on each event, before the landing starts (a person editing, a broken history). */
async function soloRun(writes: Record<string, string> = {}, o: { folder?: string; mock?: MockScript; teamOwns?: boolean; during?: (e: StoredEvent, s: ReturnType<typeof setup>) => void } = {}) {
  const s = setup();
  const folder = o.folder ?? plainFolder({ 'a.txt': 'one\n' });
  if (o.during) s.store.onAppend((e) => o.during!(e, s));
  const calls: string[][] = [];
  const exec: Exec = async (_c, args) => (calls.push(args), { code: 0, stdout: '', stderr: '' });
  const ship = new RunShip({ store: s.store, engine: s.engine, exec, home: s.home, teamOwns: () => !!o.teamOwns });
  const [path, content] = Object.entries(writes)[0] ?? [];
  const pipeline = soloPipeline({ task: 'Write it', agent: 'mock' });
  pipeline.nodes[0]!.mock = { ...(path ? { writeFile: { path, content: content! } } : {}), ...o.mock };
  const id = await s.engine.start({ pipeline, task: 'Write it', repo: folder, solo: true });
  await s.engine.wait(id);
  return { ...s, ship, id, folder, calls };
}
const shipped = (r: { store: { events(id: string): StoredEvent[] }; id: string }) => r.store.events(r.id).filter((e) => e.event.type === 'run.shipped');

describe('a solo run', () => {
  it('is one writable step', () => {
    const p = soloPipeline({ task: 'Fix the title\n\nmore', agent: 'mock', model: 'm1' });
    expect(p.name).toBe('solo');
    expect(p.nodes).toHaveLength(1);
    expect(p.nodes[0]).toMatchObject({ id: 'work', kind: 'agent', role: 'coder', agent: 'mock', model: 'm1', title: 'Fix the title' });
    expect(p.nodes[0]!.maxLoops).toBeUndefined();
    expect(p.nodes[0]!.readOnly).toBeFalsy();
    expect(p.edges).toEqual([]);
    expect(soloPipeline({ task: 'x', bot: 'reviewer' }).nodes[0]).toMatchObject({ role: 'reviewer', readOnly: true });
    expect(soloPipeline({ task: 'x', bot: 'reviewer' }).nodes[0]!.maxLoops).toBeUndefined();
    expect(soloPipeline({ task: 'x', bot: 'someone-new' }).nodes[0]!.role).toBe('someone-new');
  });

  it('a solo run in a plain folder lands when it finishes, with Undo', async () => {
    const { ship, store, id, folder, calls } = await soloRun({ 'b.txt': 'two\n' });
    await ship.idle();
    expect(store.state(id)!.history).toBeTruthy();
    expect(store.state(id)!.solo).toBe(true);
    expect(read(folder, 'b.txt')).toBe('two\n');
    expect(store.state(id)!.ship).toMatchObject({ merged: true, landed: { files: ['b.txt'] } });
    expect(calls).toEqual([]);
    await ship.undo(id);
    expect(existsSync(join(folder, 'b.txt'))).toBe(false);
  });

  it('a failed solo run lands nothing and says why', async () => {
    const r = await soloRun({ 'b.txt': 'two\n' }, { mock: { failFirst: 9 } });
    await r.ship.idle();
    const s = r.store.state(r.id)!;
    expect(s.status).toBe('error');
    expect(s.error).toContain('mock failure');
    expect(s.ship).toBeUndefined();
    expect(existsSync(join(r.folder, 'b.txt'))).toBe(false);
  });

  it('a retried solo run lands its finished work, once', async () => {
    const r = await soloRun({ 'b.txt': 'two\n' }, { mock: { failFirst: 1 } });
    await r.ship.idle();
    expect(r.store.state(r.id)!.status).toBe('error');
    await r.engine.resume(r.id, { retryFailed: true });
    await r.engine.wait(r.id);
    await r.ship.idle();
    expect(read(r.folder, 'b.txt')).toBe('two\n');
    expect(shipped(r)).toHaveLength(1);
  });

  it('a solo run whose file the person changed stops, names it, and changes nothing', async () => {
    const r = await soloRun({ 'a.txt': 'two\n' }, {
      during: (e, s) => {
        if (e.event.type === 'node.finished') writeFileSync(join(s.store.state(e.runId)!.repo, 'a.txt'), 'mine\n');
      },
    });
    await r.ship.idle();
    const ship = r.store.state(r.id)!.ship!;
    expect(ship.landed).toBeUndefined();
    expect(ship.error).toBe(CONFLICT('a.txt'));
    expect(ship.error).not.toMatch(GIT_WORDS);
    expect(ship.error).not.toContain(r.home);
    expect(read(r.folder, 'a.txt')).toBe('mine\n');
  });

  it('what a conflict offers works: the run rewinds from its page, and lands once the file is clear', async () => {
    const r = await soloRun({ 'a.txt': 'two\n' }, {
      during: (e, s) => {
        if (e.event.type === 'node.finished' && !s.store.state(e.runId)!.rewinds) writeFileSync(join(s.store.state(e.runId)!.repo, 'a.txt'), 'mine\n');
      },
    });
    await r.ship.idle();
    await r.engine.rewind(r.id, 'work');
    await r.engine.resume(r.id);
    await r.engine.wait(r.id);
    await r.ship.idle();
    // still the person's file: it stops again, in the same words
    expect(r.store.state(r.id)!.ship?.error).toBe(CONFLICT('a.txt'));
    expect(read(r.folder, 'a.txt')).toBe('mine\n');

    writeFileSync(join(r.folder, 'a.txt'), 'one\n');
    await r.engine.rewind(r.id, 'work');
    await r.engine.resume(r.id);
    await r.engine.wait(r.id);
    await r.ship.idle();
    expect(read(r.folder, 'a.txt')).toBe('two\n');
    expect(r.store.state(r.id)!.ship).toMatchObject({ landed: { files: ['a.txt'] } });
  });

  it('a landing that breaks says so without git words or a path, and leaves the folder alone', async () => {
    const r = await soloRun({ 'b.txt': 'two\n' }, {
      during: (e, s) => {
        if (e.event.type === 'run.finished') writeFileSync(join(s.store.state(e.runId)!.history!, 'HEAD'), 'not a ref\n');
      },
    });
    await r.ship.idle();
    const ship = r.store.state(r.id)!.ship!;
    expect(ship.landed).toBeUndefined();
    expect(ship.error).toBe("This work couldn't be put in the folder, so nothing was changed.");
    expect(ship.error).not.toContain(r.home);
    expect(existsSync(join(r.folder, 'b.txt'))).toBe(false);
    expect(read(r.folder, 'a.txt')).toBe('one\n');
  });

  it('a solo run with no changes says nothing needed changing and lands nothing', async () => {
    const r = await soloRun();
    await r.ship.idle();
    const ship = r.store.state(r.id)!.ship!;
    expect(ship.landed).toBeUndefined();
    expect(ship.error).toBe('No files came out of this run.');
  });

  it('a solo run lands a file under a path the folder ignores, with Undo', async () => {
    const r = await soloRun({ 'out/report.txt': 'r\n' }, { folder: plainFolder({ '.gitignore': 'out/\n', 'a.txt': 'one\n' }) });
    await r.ship.idle();
    expect(r.store.state(r.id)!.ship).toMatchObject({ merged: true, landed: { files: ['out/report.txt'] } });
    expect(read(r.folder, 'out/report.txt')).toBe('r\n');
    await r.ship.undo(r.id);
    expect(existsSync(join(r.folder, 'out'))).toBe(false);
  });

  it('a solo run that only changed dependencies names them and lands nothing', async () => {
    const r = await soloRun({ 'node_modules/x': 'x\n' });
    await r.ship.idle();
    const ship = r.store.state(r.id)!.ship!;
    expect(ship.landed).toBeUndefined();
    expect(ship.error).toBe("It changed node_modules, which Undo can't restore, so it wasn't put in your folder.");
    expect(existsSync(join(r.folder, 'node_modules'))).toBe(false);
  });

  it('a solo run that also made a file too big to undo lands the rest and says what it left out', async () => {
    const r = await soloRun({ 'out/report.txt': 'r\n' }, {
      folder: plainFolder({ '.gitignore': 'out/\n', 'a.txt': 'one\n', 'model.bin': 'old\n' }),
      during: (e, s) => {
        if (e.event.type !== 'node.started') return;
        const wd = s.store.state(e.runId)!.workdir;
        // the big file may be where the person's model.bin went, so that deletion is kept back and named
        rmSync(join(wd, 'model.bin'));
        mkdirSync(join(wd, 'out'), { recursive: true });
        writeFileSync(join(wd, 'out/model.bin'), '');
        truncateSync(join(wd, 'out/model.bin'), MAX_FILE_BYTES + 1);
      },
    });
    await r.ship.idle();
    const s = r.store.state(r.id)!;
    expect(s.ship).toMatchObject({ merged: true, landed: { files: ['out/report.txt'] } });
    expect(s.notices?.map((n) => n.text)).toContain("out/model.bin was too big or too many to keep, so it wasn't put in your folder. model.bin was removed by the agent but kept in your folder, because it may have moved into something too big to keep.");
    expect(existsSync(join(r.folder, 'out/model.bin'))).toBe(false);
    expect(read(r.folder, 'model.bin')).toBe('old\n');
    await r.ship.undo(r.id);
    expect(existsSync(join(r.folder, 'out'))).toBe(false);
  });

  it('a file a person makes while the work is being put in stops it, by name', async () => {
    let release!: () => void;
    held.gate = new Promise((res) => (release = res));
    const r = await soloRun({ 'out/report.txt': 'r\n' }, { folder: plainFolder({ '.gitignore': 'out/\n', 'a.txt': 'one\n' }) }).finally(() => (held.gate = undefined));
    mkdirSync(join(r.folder, 'out'));
    writeFileSync(join(r.folder, 'out/report.txt'), 'mine\n');
    release();
    await r.ship.idle();
    const ship = r.store.state(r.id)!.ship!;
    expect(ship.landed).toBeUndefined();
    expect(ship.error).toBe(CONFLICT('out/report.txt'));
    expect(read(r.folder, 'out/report.txt')).toBe('mine\n');
  });

  it('a solo run in a real repo finishes on the ordinary decision and pushes nothing', async () => {
    const repo = makeRepo();
    const bare = tmp('bare-');
    execFileSync('git', ['init', '-q', '--bare'], { cwd: bare });
    execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: repo });
    const r = await soloRun({ 'b.txt': 'two\n' }, { folder: repo });
    await r.ship.idle();
    const s = r.store.state(r.id)!;
    expect(s).toMatchObject({ status: 'done', solo: true });
    expect(s.history).toBeUndefined();
    expect(s.ship).toBeUndefined();
    expect(r.calls).toEqual([]);
    expect(existsSync(join(repo, 'b.txt'))).toBe(false);
    expect(execFileSync('git', ['branch', '--list'], { cwd: bare, encoding: 'utf8' })).toBe('');
  });

  it('a run nobody marked solo waits for the person, and a squad ships its own', async () => {
    const s = setup();
    const folder = plainFolder({ 'a.txt': 'one\n' });
    const ship = new RunShip({ store: s.store, engine: s.engine, exec: async () => ({ code: 1, stdout: '', stderr: '' }), home: s.home, teamOwns: () => false });
    const id = await s.engine.start({ pipeline: pipe([{ id: 'code', role: 'coder', mock: { writeFile: { path: 'b.txt', content: 'x\n' } } }], []), task: 't', repo: folder });
    await s.engine.wait(id);
    await ship.idle();
    expect(existsSync(join(folder, 'b.txt'))).toBe(false);

    const r = await soloRun({ 'b.txt': 'two\n' }, { teamOwns: true });
    await r.ship.idle();
    expect(existsSync(join(r.folder, 'b.txt'))).toBe(false);
    expect(r.store.state(r.id)!.ship).toBeUndefined();
  });

  it('a shipped run never lands twice, whoever hears it finish again', async () => {
    const r = await soloRun({ 'b.txt': 'two\n' });
    await r.ship.idle();
    // a restart builds a new RunShip on the same log
    const after = new RunShip({ store: r.store, engine: r.engine, exec: async () => ({ code: 1, stdout: '', stderr: '' }), home: r.home, teamOwns: () => false });
    r.store.append(r.id, { type: 'run.finished', status: 'done' });
    await after.idle();
    await r.ship.idle();
    expect(shipped(r)).toHaveLength(1);
    expect(r.store.state(r.id)!.ship?.error).toBeUndefined();
  });

  it('a rewound run lands only what it finishes with, after the old landing is undone', async () => {
    const r = await soloRun({ 'b.txt': 'two\n' });
    await r.ship.idle();
    await expect(r.engine.rewind(r.id, 'work')).rejects.toThrow(/already in the folder/);
    await r.ship.undo(r.id);
    await r.engine.rewind(r.id, 'work');
    await r.ship.idle();
    expect(existsSync(join(r.folder, 'b.txt'))).toBe(false); // going back lands nothing
    await r.engine.resume(r.id);
    await r.engine.wait(r.id);
    await r.ship.idle();
    expect(read(r.folder, 'b.txt')).toBe('two\n');
    expect(r.store.state(r.id)!.ship).toMatchObject({ merged: true, landed: { files: ['b.txt'] } });
  });

  it('a run being landed refuses a rewind, and takes one again once the landing is over', async () => {
    let release!: () => void;
    held.gate = new Promise((res) => (release = res));
    const r = await soloRun({ 'b.txt': 'two\n' }).finally(() => (held.gate = undefined));
    expect(r.store.state(r.id)!.ship).toBeUndefined(); // the run let go; its landing is open
    await expect(r.engine.rewind(r.id, 'work')).rejects.toThrow('This work is being put in the folder. Try again in a moment.');
    expect(r.store.state(r.id)!.status).toBe('done');
    release();
    await r.ship.idle();
    expect(read(r.folder, 'b.txt')).toBe('two\n');
    await r.ship.undo(r.id);
    await expect(r.engine.rewind(r.id, 'work')).resolves.toMatchObject({ status: 'stopped' });
  });

  it('a landing that dies lets go of the run too', async () => {
    held.gate = Promise.reject(new Error('it broke'));
    held.gate.catch(() => {});
    const r = await soloRun({ 'b.txt': 'two\n' }).finally(() => (held.gate = undefined));
    await r.ship.idle();
    expect(r.store.state(r.id)!.ship?.error).toBe('it broke');
    await expect(r.engine.rewind(r.id, 'work')).resolves.toMatchObject({ status: 'stopped' });
  });

  it('a landing that was waiting its turn lands nothing once the run has gone back', async () => {
    const r = await soloRun({ 'a.txt': 'two\n' }, {
      during: (e, s) => {
        if (e.event.type === 'node.finished') writeFileSync(join(s.store.state(e.runId)!.repo, 'a.txt'), 'mine\n');
      },
    });
    await r.ship.idle();
    await r.engine.rewind(r.id, 'work');
    writeFileSync(join(r.folder, 'a.txt'), 'one\n');
    expect(await landRun(r, r.id)).toEqual({ error: 'This work is still changing, so nothing was put in the folder.' });
    expect(read(r.folder, 'a.txt')).toBe('one\n');
  });
});

describe('the care rules', () => {
  it('writable steps get the care rules; read-only steps do not', () => {
    const p = pipe([{ id: 'write', role: 'coder' }, { id: 'look', role: 'reviewer', readOnly: true }], []);
    const state = { id: 'r', task: 't', nodes: {} } as never;
    expect(CAREFUL.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(6);
    expect(CAREFUL).toContain('Read the relevant files before changing them.');
    expect(CAREFUL).toContain('say plainly what wasn\'t checked');
    expect(CAREFUL).toContain('- Keep tool output small.');
    expect(buildPrompt({ pipeline: p, node: p.nodes[0]!, state })).toContain(CAREFUL);
    expect(buildPrompt({ pipeline: p, node: p.nodes[1]!, state })).not.toContain(CAREFUL);
  });
});
