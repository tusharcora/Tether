import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitAll, createWorktree } from '../src/git.js';
import { historyDir, landBranch, MAX_FILE_BYTES, undoLanding, type Landed } from '../src/history.js';
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
});
