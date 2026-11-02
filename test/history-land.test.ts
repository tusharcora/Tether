import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitAll, createWorktree } from '../src/git.js';
import { historyDir, landBranch, MAX_FILE_BYTES, snapshotFolder, undoLanding, type Landed } from '../src/history.js';
import { plainFolder, tmp } from './helpers.js';

const read = (folder: string, f: string) => readFileSync(join(folder, f), 'utf8');
const put = (dir: string, f: string, c: string) => {
  mkdirSync(dirname(join(dir, f)), { recursive: true });
  writeFileSync(join(dir, f), c);
};

/** A folder holding `start`, and a run on it that wrote `changes` and removed `removes`. */
async function run(start: Record<string, string>, changes: Record<string, string> = {}, removes: string[] = [], prepare?: (folder: string) => void) {
  const home = tmp('home-');
  const folder = plainFolder(start);
  prepare?.(folder);
  const wt = await createWorktree(folder, home, 'r1');
  for (const f of removes) rmSync(join(wt.workdir, f), { recursive: true });
  for (const [f, c] of Object.entries(changes)) put(wt.workdir, f, c);
  const head = await commitAll(wt.workdir, 'work');
  return { home, folder, base: wt.baseSha, head: head!, workdir: wt.workdir };
}

const landed = (r: Landed | { conflicts: string[] }): Landed => {
  if ('conflicts' in r) throw new Error(`conflicts: ${r.conflicts.join(', ')}`);
  return r;
};

describe('landing', () => {
  it('adds, changes and deletes files, with awkward names', async () => {
    const { home, folder, base, head } = await run({ 'a b.txt': '1', 'é.txt': '1', 'gone.txt': '1' }, { 'a b.txt': '2', 'é.txt': '2', 'new.txt': '3' }, ['gone.txt']);
    const r = await landBranch(home, folder, base, head);
    expect('files' in r).toBe(true);
    expect(read(folder, 'a b.txt')).toBe('2');
    expect(read(folder, 'é.txt')).toBe('2');
    expect(read(folder, 'new.txt')).toBe('3');
    expect(existsSync(join(folder, 'gone.txt'))).toBe(false);
    expect(readdirSync(folder)).not.toContain('.git');
  });

  it('lands names with a newline, a leading space, quotes and spaces in folders', async () => {
    const names = ['line\nbreak.txt', ' lead.txt', 'quo"te.txt', 'Masters HW/week 1/notes é.txt', '*.txt', ':(top)odd'];
    const { home, folder, base, head } = await run({ 'keep.txt': 'k', ...Object.fromEntries(names.map((n) => [n, '1'])) }, Object.fromEntries(names.map((n) => [n, '2'])));
    const r = landed(await landBranch(home, folder, base, head));
    expect([...r.files].sort()).toEqual([...names].sort());
    for (const n of names) expect(read(folder, n)).toBe('2');
    expect(read(folder, 'keep.txt')).toBe('k');
    expect(await undoLanding(home, folder, r)).toBe(true);
    for (const n of names) expect(read(folder, n)).toBe('1');
  });

  it('deletes and restores a file whose name has a newline', async () => {
    const { home, folder, base, head } = await run({ 'odd\nname.txt': '1', 'x.txt': '1' }, {}, ['odd\nname.txt']);
    const r = landed(await landBranch(home, folder, base, head));
    expect(existsSync(join(folder, 'odd\nname.txt'))).toBe(false);
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'odd\nname.txt')).toBe('1');
  });

  // macOS keeps names as they were made: this é is e plus a combining accent
  const decomposed = 'cafe\u0301.txt';

  it('lands and undoes a decomposed name', async () => {
    const { home, folder, base, head, workdir } = await run({ [decomposed]: '1', 'x.txt': '1' }, { [decomposed]: '2' });
    expect(read(workdir, decomposed)).toBe('2');
    const r = landed(await landBranch(home, folder, base, head));
    expect(r.files).toEqual([decomposed]);
    expect(readdirSync(folder)).toContain(decomposed);
    expect(read(folder, decomposed)).toBe('2');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, decomposed)).toBe('1');
  });

  it('stops when a person edited a decomposed name', async () => {
    const { home, folder, base, head } = await run({ [decomposed]: '1' }, { [decomposed]: '2' });
    writeFileSync(join(folder, decomposed), 'mine');
    expect(await landBranch(home, folder, base, head)).toEqual({ conflicts: [decomposed] });
    expect(read(folder, decomposed)).toBe('mine');
  });

  it('lands and undoes a symlink and an exec bit', async () => {
    const { home, folder, base, workdir } = await run({ 'run.sh': 'x', 't.txt': 't' });
    chmodSync(join(workdir, 'run.sh'), 0o755);
    symlinkSync('t.txt', join(workdir, 'link'));
    const head = await commitAll(workdir, 'work');
    const r = landed(await landBranch(home, folder, base, head!));
    expect(statSync(join(folder, 'run.sh')).mode & 0o111).not.toBe(0);
    expect(readlinkSync(join(folder, 'link'))).toBe('t.txt');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(statSync(join(folder, 'run.sh')).mode & 0o111).toBe(0);
    expect(existsSync(join(folder, 'link'))).toBe(false);
  });

  it('runs no git hook in the folder', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
    const hooks = join(historyDir(home, folder), 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'post-checkout'), '#!/bin/sh\ntouch hook-ran\n', { mode: 0o755 });
    landed(await landBranch(home, folder, base, head));
    expect(read(folder, 'a.txt')).toBe('2');
    expect(existsSync(join(folder, 'hook-ran'))).toBe(false);
  });

  it('lands a file the folder\'s .gitignore names', async () => {
    const { home, folder, base, head } = await run({ '.gitignore': 'secret.env\n', 'secret.env': '1' }, { 'secret.env': '2' });
    landed(await landBranch(home, folder, base, head));
    expect(read(folder, 'secret.env')).toBe('2');
  });

  it('lands nothing when the run changed nothing', async () => {
    const home = tmp('home-');
    const folder = plainFolder({ 'a.txt': '1' });
    const wt = await createWorktree(folder, home, 'r1');
    const r = landed(await landBranch(home, folder, wt.baseSha, wt.baseSha));
    expect(r.files).toEqual([]);
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'a.txt')).toBe('1');
  });

  it('keeps a person\'s other changes', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1', 'other.txt': '1' }, { 'a.txt': '2' });
    writeFileSync(join(folder, 'other.txt'), 'mine');
    writeFileSync(join(folder, 'added.txt'), 'mine too');
    landed(await landBranch(home, folder, base, head));
    expect(read(folder, 'a.txt')).toBe('2');
    expect(read(folder, 'other.txt')).toBe('mine');
    expect(read(folder, 'added.txt')).toBe('mine too');
  });

  it('stops on a conflict, names the file, changes nothing', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
    writeFileSync(join(folder, 'a.txt'), 'mine');
    expect(await landBranch(home, folder, base, head)).toEqual({ conflicts: ['a.txt'] });
    expect(read(folder, 'a.txt')).toBe('mine');
  });

  it('a conflict on one file stops the others landing too', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1', 'b.txt': '1' }, { 'a.txt': '2', 'b.txt': '2' });
    writeFileSync(join(folder, 'a.txt'), 'mine');
    expect(await landBranch(home, folder, base, head)).toEqual({ conflicts: ['a.txt'] });
    expect(read(folder, 'b.txt')).toBe('1');
  });

  it('stops when a person made a file where the run needs a folder', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'x/y.txt': '2' });
    writeFileSync(join(folder, 'x'), 'mine');
    expect(await landBranch(home, folder, base, head)).toEqual({ conflicts: ['x'] });
    expect(read(folder, 'x')).toBe('mine');
  });

  it('stops when the run turns a folder into a file and a person added to that folder', async () => {
    const { home, folder, base, head } = await run({ 'x/y.txt': '1' }, { x: 'file' }, ['x']);
    writeFileSync(join(folder, 'x/mine.txt'), 'mine');
    expect(await landBranch(home, folder, base, head)).toEqual({ conflicts: ['x/mine.txt'] });
    expect(read(folder, 'x/mine.txt')).toBe('mine');
    expect(read(folder, 'x/y.txt')).toBe('1');
  });

  it('turns a folder into a file and back on undo', async () => {
    const { home, folder, base, head } = await run({ 'x/y.txt': '1' }, { x: 'file' }, ['x']);
    const r = landed(await landBranch(home, folder, base, head));
    expect(read(folder, 'x')).toBe('file');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'x/y.txt')).toBe('1');
  });

  it('turns a file into a folder and back on undo', async () => {
    const { home, folder, base, head } = await run({ x: 'file' }, { 'x/y.txt': '1' }, ['x']);
    const r = landed(await landBranch(home, folder, base, head));
    expect(read(folder, 'x/y.txt')).toBe('1');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'x')).toBe('file');
  });

  it('a rename that only changes case keeps the file', async () => {
    const { home, folder, base, head, workdir } = await run({ 'a.txt': '1' });
    expect(head).toBeUndefined();
    execFileSync('git', ['mv', '-f', 'a.txt', 'A.txt'], { cwd: workdir });
    writeFileSync(join(workdir, 'A.txt'), '2');
    const sha = await commitAll(workdir, 'rename');
    const r = landed(await landBranch(home, folder, base, sha!));
    expect(read(folder, 'A.txt')).toBe('2');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'a.txt')).toBe('1');
  });

  it('removes a folder the run emptied', async () => {
    const { home, folder, base, head } = await run({ 'd/e/f.txt': '1', 'k.txt': '1' }, {}, ['d']);
    landed(await landBranch(home, folder, base, head));
    expect(existsSync(join(folder, 'd'))).toBe(false);
  });

  it('never lands or touches what the history left out', async () => {
    const { home, folder, base, head, workdir } = await run({ 'a.txt': '1', 'sub/b.txt': '1' }, { 'a.txt': '2' }, [], (f) => {
      put(f, 'node_modules/dep/index.js', 'dep');
      put(f, 'sub/node_modules/x.js', 'x');
      put(f, 'big.bin', '');
      truncateSync(join(f, 'big.bin'), MAX_FILE_BYTES + 1);
      put(f, 'nested/file.txt', 'n');
      execFileSync('git', ['init', '-q'], { cwd: join(f, 'nested') });
    });
    expect(lstatSync(join(workdir, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(workdir, 'big.bin')).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(workdir, 'nested')).isSymbolicLink()).toBe(true);
    const r = landed(await landBranch(home, folder, base, head));
    expect(r.files).toEqual(['a.txt']);
    for (const p of ['node_modules', 'big.bin', 'nested', 'sub/node_modules']) expect(lstatSync(join(folder, p)).isSymbolicLink()).toBe(false);
    expect(read(folder, 'node_modules/dep/index.js')).toBe('dep');
    expect(lstatSync(join(folder, 'big.bin')).size).toBe(MAX_FILE_BYTES + 1);
    expect(existsSync(join(folder, 'nested/.git'))).toBe(true);
  });

  it('stops rather than overwrite a big file made during the run', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'big.bin': 'small' });
    put(folder, 'big.bin', '');
    truncateSync(join(folder, 'big.bin'), MAX_FILE_BYTES + 1);
    expect(await landBranch(home, folder, base, head)).toEqual({ conflicts: ['big.bin'] });
    expect(lstatSync(join(folder, 'big.bin')).size).toBe(MAX_FILE_BYTES + 1);
  });

  it('stops rather than wipe a left-out file when the run turns its folder into a file', async () => {
    const { home, folder, base, head } = await run({ 'x/y.txt': '1' }, { x: 'file' }, ['x']);
    put(folder, 'x/node_modules/dep.js', 'dep');
    expect(await landBranch(home, folder, base, head)).toEqual({ conflicts: ['x/node_modules'] });
    expect(read(folder, 'x/node_modules/dep.js')).toBe('dep');
  });

  it('puts the folder back and says so when landing fails part way', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1', 'sub/b.txt': '1', 'sub/gone.txt': '1' }, { 'a.txt': '2', 'sub/b.txt': '2', 'z.txt': 'new' }, ['sub/gone.txt']);
    chmodSync(join(folder, 'sub'), 0o555);
    try {
      await expect(landBranch(home, folder, base, head)).rejects.toThrow(/put back as it was/);
    } finally {
      chmodSync(join(folder, 'sub'), 0o755);
    }
    expect(read(folder, 'a.txt')).toBe('1');
    expect(read(folder, 'sub/b.txt')).toBe('1');
    expect(read(folder, 'sub/gone.txt')).toBe('1');
    expect(existsSync(join(folder, 'z.txt'))).toBe(false);
  });

  it('undo restores changed, added and deleted files', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1', 'gone.txt': '1' }, { 'a.txt': '2', 'd/new.txt': '3' }, ['gone.txt']);
    const r = landed(await landBranch(home, folder, base, head));
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'a.txt')).toBe('1');
    expect(read(folder, 'gone.txt')).toBe('1');
    expect(existsSync(join(folder, 'd'))).toBe(false);
    expect(readdirSync(folder).sort()).toEqual(['a.txt', 'gone.txt']);
  });

  it('undo stops if a landed file changed since, names it, changes nothing', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2', 'new.txt': '3' });
    const r = landed(await landBranch(home, folder, base, head));
    writeFileSync(join(folder, 'new.txt'), 'mine');
    expect(await undoLanding(home, folder, r)).toEqual({ conflicts: ['new.txt'] });
    expect(read(folder, 'new.txt')).toBe('mine');
    expect(read(folder, 'a.txt')).toBe('2');
  });

  it('undo stops if a landed file was deleted since', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
    const r = landed(await landBranch(home, folder, base, head));
    rmSync(join(folder, 'a.txt'));
    expect(await undoLanding(home, folder, r)).toEqual({ conflicts: ['a.txt'] });
    expect(existsSync(join(folder, 'a.txt'))).toBe(false);
  });

  it('undo stops rather than delete a landed file too big to compare', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'data.bin': 'x'.repeat(MAX_FILE_BYTES + 1) });
    const r = landed(await landBranch(home, folder, base, head));
    appendFileSync(join(folder, 'data.bin'), 'mine');
    expect(await undoLanding(home, folder, r)).toEqual({ conflicts: ['data.bin'] });
    expect(lstatSync(join(folder, 'data.bin')).size).toBe(MAX_FILE_BYTES + 5);
  });

  it('undo keeps a person\'s new file beside a landed one', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'd/new.txt': '3' });
    const r = landed(await landBranch(home, folder, base, head));
    writeFileSync(join(folder, 'd/mine.txt'), 'mine');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(existsSync(join(folder, 'd/new.txt'))).toBe(false);
    expect(read(folder, 'd/mine.txt')).toBe('mine');
  });

  it('undo leaves files it did not land alone', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1', 'other.txt': '1' }, { 'a.txt': '2' });
    const r = landed(await landBranch(home, folder, base, head));
    writeFileSync(join(folder, 'other.txt'), 'mine');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'a.txt')).toBe('1');
    expect(read(folder, 'other.txt')).toBe('mine');
  });

  it('undo refuses a path outside the folder', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
    const outside = join(dirname(folder), 'outside.txt');
    writeFileSync(outside, 'keep');
    const r = landed(await landBranch(home, folder, base, head));
    await expect(undoLanding(home, folder, { ...r, files: [`../outside.txt`] })).rejects.toThrow();
    expect(readFileSync(outside, 'utf8')).toBe('keep');
    rmSync(outside);
  });

  it('a missing folder is a plain error', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
    const r = landed(await landBranch(home, folder, base, head));
    rmSync(folder, { recursive: true });
    for (const attempt of [landBranch(home, folder, base, head), undoLanding(home, folder, r)]) {
      const e: Error = await attempt.then(() => { throw new Error('should have failed'); }, (x) => x);
      expect(e.message).toMatch(/no longer there/);
      expect(e.message).not.toContain(home);
      expect(e.message).not.toContain(folder);
    }
  });

  describe('names the volume treats as one file', () => {
    const nfc = 'café.txt';
    const nfd = 'café.txt';

    it('stops when a person made the same name in another case', async () => {
      const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'notes.txt': 'run' });
      writeFileSync(join(folder, 'NOTES.txt'), 'mine');
      expect(await landBranch(home, folder, base, head)).toEqual({ conflicts: ['NOTES.txt'] });
      expect(read(folder, 'NOTES.txt')).toBe('mine');
    });

    it.each([[nfc, nfd], [nfd, nfc]])('stops when a person made the same name in another Unicode form', async (runs, mine) => {
      const { home, folder, base, head } = await run({ 'a.txt': '1' }, { [runs]: 'run' });
      writeFileSync(join(folder, mine), 'mine');
      expect(await landBranch(home, folder, base, head)).toEqual({ conflicts: [mine] });
      expect(read(folder, mine)).toBe('mine');
    });

    it.each([
      ['straße.txt', 'STRASSE.TXT'],
      ['σx.txt', 'ςx.txt'],
      ['ﬁle.txt', 'FILE.txt'],
      ['strasse.txt', 'STRA\u1E9EE.txt'],
      ['straße.txt', 'STRA\u1E9EE.txt'],
      ['STRA\u1E9EE.txt', 'strasse.txt'],
      ['\u0390.txt', '\u03AA\u0301.txt'],
      ['\u03AA\u0301.txt', '\u0390.txt'],
      ['\u03B0.txt', '\u03AB\u0301.txt'],
      ['\u03AB\u0301.txt', '\u03B0.txt'],
      ['\u1FD2.txt', '\u0399\u0308\u0300.txt'],
      ['\u1FD7.txt', '\u0399\u0308\u0342.txt'],
      ['\u1FE2.txt', '\u03A5\u0308\u0300.txt'],
      ['\u1FE7.txt', '\u03A5\u0308\u0342.txt'],
    ])('stops on the volume\'s fuller case folding: %j over %j', async (runs, mine) => {
      const { home, folder, base, head } = await run({ 'a.txt': '1' }, { [runs]: 'run' });
      writeFileSync(join(folder, mine), 'mine');
      expect(await landBranch(home, folder, base, head)).toEqual({ conflicts: [mine] });
      expect(read(folder, mine)).toBe('mine');
    });

    it('stops when the folded name is a folder above the file', async () => {
      const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'docs/x.txt': 'run' });
      writeFileSync(join(folder, 'DOCS'), 'mine');
      expect(await landBranch(home, folder, base, head)).toEqual({ conflicts: ['DOCS'] });
      expect(read(folder, 'DOCS')).toBe('mine');
    });

    it('stops on a left-out file in another case', async () => {
      const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'big.bin': 'small' });
      put(folder, 'BIG.bin', '');
      truncateSync(join(folder, 'BIG.bin'), MAX_FILE_BYTES + 1);
      expect(await landBranch(home, folder, base, head)).toEqual({ conflicts: ['BIG.bin'] });
      expect(lstatSync(join(folder, 'BIG.bin')).size).toBe(MAX_FILE_BYTES + 1);
    });

    it('undo stops when a person remade a removed file in another case', async () => {
      const { home, folder, base, head } = await run({ 'a.txt': '1', 'gone.txt': 'old' }, { 'a.txt': '2' }, ['gone.txt']);
      const r = landed(await landBranch(home, folder, base, head));
      writeFileSync(join(folder, 'GONE.txt'), 'mine');
      expect(await undoLanding(home, folder, r)).toEqual({ conflicts: ['GONE.txt'] });
      expect(read(folder, 'GONE.txt')).toBe('mine');
      expect(read(folder, 'a.txt')).toBe('2');
    });
  });

  describe('a project the run made inside its work', () => {
    async function nested() {
      const r = await run({ 'a.txt': '1' });
      writeFileSync(join(r.workdir, 'a.txt'), '2');
      put(r.workdir, 'app/index.js', 'x');
      const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: join(r.workdir, 'app'), stdio: 'ignore' });
      g('init', '-q');
      g('add', '-A');
      g('commit', '-qm', 'x');
      return { ...r, head: (await commitAll(r.workdir, 'nested'))! };
    }

    it('is refused by name before anything is written', async () => {
      const { home, folder, base, head } = await nested();
      await expect(landBranch(home, folder, base, head)).rejects.toThrow(/"app"/);
      expect(read(folder, 'a.txt')).toBe('1');
      expect(readdirSync(folder)).toEqual(['a.txt']);
    });

    it('is refused in words a person can read', async () => {
      const { home, folder, base, head } = await nested();
      const e: Error = await landBranch(home, folder, base, head).then(() => { throw new Error('should have failed'); }, (x) => x);
      expect(e.message).not.toMatch(/git|repo|commit|submodule|branch/i);
      expect(e.message).not.toContain(home);
    });
  });

  it('undo goes through when a person deleted a landed file too big for the history', async () => {
    const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2', 'data.bin': 'x'.repeat(MAX_FILE_BYTES + 1) });
    const r = landed(await landBranch(home, folder, base, head));
    rmSync(join(folder, 'data.bin'));
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'a.txt')).toBe('1');
    expect(existsSync(join(folder, 'data.bin'))).toBe(false);
  });

  describe('a folder that moved', () => {
    const plainly = (e: Error, home: string) => {
      expect(e.message).toMatch(/history for this folder is gone/);
      expect(e.message).not.toMatch(/git|fatal|bad object/i);
      expect(e.message).not.toContain(home);
      expect(String((e.cause as Error).message)).toMatch(/bad object|fatal|failed/);
    };

    it('undo says so plainly and changes nothing', async () => {
      const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
      const r = landed(await landBranch(home, folder, base, head));
      const moved = `${folder}-moved`;
      renameSync(folder, moved);
      plainly(await undoLanding(home, moved, r).then(() => { throw new Error('should have failed'); }, (x) => x), home);
      expect(read(moved, 'a.txt')).toBe('2');
    });

    it('landing says so plainly and changes nothing', async () => {
      const { home, folder, base, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
      const moved = `${folder}-moved`;
      renameSync(folder, moved);
      plainly(await landBranch(home, moved, base, head).then(() => { throw new Error('should have failed'); }, (x) => x), home);
      expect(read(moved, 'a.txt')).toBe('1');
    });
  });

  describe('file permissions', () => {
    const mode = (folder: string, f: string) => statSync(join(folder, f)).mode & 0o777;

    it('keeps a private file private through landing and undo', async () => {
      const { home, folder, base, head } = await run({ '.env': 'A=1' }, { '.env': 'A=2' }, [], (f) => chmodSync(join(f, '.env'), 0o600));
      const r = landed(await landBranch(home, folder, base, head));
      expect(read(folder, '.env')).toBe('A=2');
      expect(mode(folder, '.env')).toBe(0o600);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(read(folder, '.env')).toBe('A=1');
      expect(mode(folder, '.env')).toBe(0o600);
    });

    it('keeps a private script private and runnable', async () => {
      const { home, folder, base, head } = await run({ 's.sh': '1' }, { 's.sh': '2' }, [], (f) => chmodSync(join(f, 's.sh'), 0o700));
      const r = landed(await landBranch(home, folder, base, head));
      expect(mode(folder, 's.sh')).toBe(0o700);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(mode(folder, 's.sh')).toBe(0o700);
    });

    it('takes the exec bit from the work and keeps the private bits', async () => {
      const { home, folder, base, workdir } = await run({ 's.sh': '1' }, {}, [], (f) => chmodSync(join(f, 's.sh'), 0o600));
      chmodSync(join(workdir, 's.sh'), 0o755);
      const head = await commitAll(workdir, 'work');
      const r = landed(await landBranch(home, folder, base, head!));
      expect(mode(folder, 's.sh')).toBe(0o700);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(mode(folder, 's.sh')).toBe(0o600);
    });

    it('stays private through a rename that only changes case', async () => {
      const { home, folder, base, workdir } = await run({ 'a.txt': '1' }, {}, [], (f) => chmodSync(join(f, 'a.txt'), 0o600));
      execFileSync('git', ['mv', '-f', 'a.txt', 'A.txt'], { cwd: workdir });
      const r = landed(await landBranch(home, folder, base, (await commitAll(workdir, 'rename'))!));
      expect(mode(folder, 'A.txt')).toBe(0o600);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(mode(folder, 'a.txt')).toBe(0o600);
    });

    it('a private file the run deletes comes back private on undo', async () => {
      const { home, folder, base, head } = await run({ '.env': 'A=1', 'a.txt': '1' }, { 'a.txt': '2' }, ['.env'], (f) => chmodSync(join(f, '.env'), 0o600));
      const r = landed(await landBranch(home, folder, base, head));
      expect(r.modes).toEqual({ '.env': 0o600 });
      expect(existsSync(join(folder, '.env'))).toBe(false);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(read(folder, '.env')).toBe('A=1');
      expect(mode(folder, '.env')).toBe(0o600);
    });

    it('keeps a mode that survives being stored as JSON', async () => {
      const { home, folder, base, head } = await run({ 'k.pem': 'x' }, {}, ['k.pem'], (f) => chmodSync(join(f, 'k.pem'), 0o400));
      const r = landed(await landBranch(home, folder, base, head));
      expect(await undoLanding(home, folder, JSON.parse(JSON.stringify(r)))).toBe(true);
      expect(mode(folder, 'k.pem')).toBe(0o400);
    });

    it('records no modes for files git brings back as they were', async () => {
      const { home, folder, base, head } = await run({ 'a.txt': '1', 's.sh': '1', 'kept.txt': 'k' }, { 'kept.txt': 'k2' }, ['a.txt', 's.sh'], (f) => {
        chmodSync(join(f, 'a.txt'), 0o644);
        chmodSync(join(f, 's.sh'), 0o755);
      });
      const r = landed(await landBranch(home, folder, base, head));
      expect(r.modes).toBeUndefined();
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(mode(folder, 'a.txt')).toBe(0o644);
      expect(mode(folder, 's.sh')).toBe(0o755);
    });

    it('a private file the run swaps for a symlink comes back private on undo', async () => {
      const { home, folder, base, workdir } = await run({ '.env': 'A=1', 'shared.env': 'B=2' }, {}, [], (f) => chmodSync(join(f, '.env'), 0o600));
      rmSync(join(workdir, '.env'));
      symlinkSync('shared.env', join(workdir, '.env'));
      const r = landed(await landBranch(home, folder, base, (await commitAll(workdir, 'link'))!));
      expect(readlinkSync(join(folder, '.env'))).toBe('shared.env');
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(lstatSync(join(folder, '.env')).isFile()).toBe(true);
      expect(read(folder, '.env')).toBe('A=1');
      expect(mode(folder, '.env')).toBe(0o600);
    });

    it('a private file the run swaps for a folder comes back private on undo', async () => {
      const { home, folder, base, head } = await run({ key: 'x', 'a.txt': '1' }, { 'key/inner.txt': 'y' }, ['key'], (f) => chmodSync(join(f, 'key'), 0o600));
      const r = landed(await landBranch(home, folder, base, head));
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(read(folder, 'key')).toBe('x');
      expect(mode(folder, 'key')).toBe(0o600);
    });

    it('a private file the run deletes stays private when landing fails part way', async () => {
      const { home, folder, base, head } = await run({ '.env': 'A=1', 'sub/b.txt': '1' }, { 'sub/b.txt': '2' }, ['.env'], (f) => chmodSync(join(f, '.env'), 0o600));
      chmodSync(join(folder, 'sub'), 0o555);
      try {
        await expect(landBranch(home, folder, base, head)).rejects.toThrow(/put back as it was/);
      } finally {
        chmodSync(join(folder, 'sub'), 0o755);
      }
      expect(read(folder, '.env')).toBe('A=1');
      expect(mode(folder, '.env')).toBe(0o600);
    });

    it('stays private when landing fails part way', async () => {
      const { home, folder, base, head } = await run({ '.env': 'A=1', 'sub/b.txt': '1' }, { '.env': 'A=2', 'sub/b.txt': '2' }, [], (f) => chmodSync(join(f, '.env'), 0o600));
      chmodSync(join(folder, 'sub'), 0o555);
      try {
        await expect(landBranch(home, folder, base, head)).rejects.toThrow(/put back as it was/);
      } finally {
        chmodSync(join(folder, 'sub'), 0o755);
      }
      expect(read(folder, '.env')).toBe('A=1');
      expect(mode(folder, '.env')).toBe(0o600);
    });
  });

  describe('exact bytes', () => {
    const bytes = (folder: string, f: string) => readFileSync(join(folder, f));
    const binary = Buffer.from([0x00, 0x0d, 0x0a, 0x0d, 0xff, 0x0d]);

    it.each(['* text\n', '* text=auto\n', '* text eol=lf\n', '* ident\n', '* working-tree-encoding=UTF-16\n'])('undo restores them under a .gitattributes of %j', async (attributes) => {
      const csv = Buffer.from('a,b\r\n$Id$\r\n');
      const { home, folder, base, workdir } = await run({ '.gitattributes': attributes, 'keep.txt': 'k' }, {}, [], (f) => {
        writeFileSync(join(f, 'data.csv'), csv);
        writeFileSync(join(f, 'p.bin'), binary);
      });
      writeFileSync(join(workdir, 'data.csv'), 'x,y\r\n');
      writeFileSync(join(workdir, 'p.bin'), Buffer.from([0x0d, 0x0a]));
      const r = landed(await landBranch(home, folder, base, (await commitAll(workdir, 'work'))!));
      expect(bytes(folder, 'data.csv').equals(Buffer.from('x,y\r\n'))).toBe(true);
      expect(bytes(folder, 'p.bin').equals(Buffer.from([0x0d, 0x0a]))).toBe(true);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(bytes(folder, 'data.csv').equals(csv)).toBe(true);
      expect(bytes(folder, 'p.bin').equals(binary)).toBe(true);
    });

    it('a run sees and keeps a folder\'s bytes', async () => {
      const { home, folder, base, head, workdir } = await run({ '.gitattributes': '* text\n', 'data.csv': 'a\r\n', 'b.txt': '1' }, { 'b.txt': '2' });
      expect(bytes(workdir, 'data.csv').equals(Buffer.from('a\r\n'))).toBe(true);
      landed(await landBranch(home, folder, base, head));
      expect(bytes(folder, 'data.csv').equals(Buffer.from('a\r\n'))).toBe(true);
    });

    it('an older history is brought up to date by the next snapshot', async () => {
      const home = tmp('home-');
      const folder = plainFolder({ '.gitattributes': '* text\n', 'data.csv': 'a\r\n' });
      await snapshotFolder(home, folder);
      const history = historyDir(home, folder);
      rmSync(join(history, 'info', 'attributes'), { force: true });
      execFileSync('git', ['config', 'core.precomposeunicode', 'true'], { cwd: history });
      await snapshotFolder(home, folder);
      expect(existsSync(join(history, 'info', 'attributes'))).toBe(true);
      expect(execFileSync('git', ['config', 'core.precomposeunicode'], { cwd: history, encoding: 'utf8' }).trim()).toBe('false');
    });

    it('sets the history up once when two first snapshots overlap', async () => {
      for (let i = 0; i < 10; i++) {
        const home = tmp('home-');
        const folder = plainFolder({ 'a.txt': '1' });
        await Promise.all([snapshotFolder(home, folder), snapshotFolder(home, folder), snapshotFolder(home, folder)]);
        expect(execFileSync('git', ['config', 'core.autocrlf'], { cwd: historyDir(home, folder), encoding: 'utf8' }).trim()).toBe('false');
      }
    }, 30_000);
  });
});
