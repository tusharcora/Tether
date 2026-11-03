import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitAll, createWorktree } from '../src/git.js';
import { historyDir, landBranch, MAX_FILE_BYTES, MAX_FOLDER_FILES, notLanded, snapshotFolder, undoLanding, type Landed } from '../src/history.js';
import { makeRepo, plainFolder, tmp } from './helpers.js';

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
  return { home, folder, head: head!, workdir: wt.workdir };
}

const landed = (r: Landed | { conflicts: string[] }): Landed => {
  if ('conflicts' in r) throw new Error(`conflicts: ${r.conflicts.join(', ')}`);
  return r;
};

describe('landing', () => {
  it('adds, changes and deletes files, with awkward names', async () => {
    const { home, folder, head } = await run({ 'a b.txt': '1', 'é.txt': '1', 'gone.txt': '1' }, { 'a b.txt': '2', 'é.txt': '2', 'new.txt': '3' }, ['gone.txt']);
    const r = await landBranch(home, folder, head);
    expect('files' in r).toBe(true);
    expect(read(folder, 'a b.txt')).toBe('2');
    expect(read(folder, 'é.txt')).toBe('2');
    expect(read(folder, 'new.txt')).toBe('3');
    expect(existsSync(join(folder, 'gone.txt'))).toBe(false);
    expect(readdirSync(folder)).not.toContain('.git');
  });

  it('lands names with a newline, a leading space, quotes and spaces in folders', async () => {
    const names = ['line\nbreak.txt', ' lead.txt', 'quo"te.txt', 'Masters HW/week 1/notes é.txt', '*.txt', ':(top)odd'];
    const { home, folder, head } = await run({ 'keep.txt': 'k', ...Object.fromEntries(names.map((n) => [n, '1'])) }, Object.fromEntries(names.map((n) => [n, '2'])));
    const r = landed(await landBranch(home, folder, head));
    expect([...r.files].sort()).toEqual([...names].sort());
    for (const n of names) expect(read(folder, n)).toBe('2');
    expect(read(folder, 'keep.txt')).toBe('k');
    expect(await undoLanding(home, folder, r)).toBe(true);
    for (const n of names) expect(read(folder, n)).toBe('1');
  });

  it('lands names git would read as pathspecs, and Undo is exact', async () => {
    const names = [':(x)y', ':out'];
    const { home, folder, head } = await run({ 'keep.txt': 'k' }, Object.fromEntries(names.map((n) => [n, '2'])));
    const r = landed(await landBranch(home, folder, head));
    expect([...r.files].sort()).toEqual([...names].sort());
    for (const n of names) expect(read(folder, n)).toBe('2');
    expect(await undoLanding(home, folder, r)).toBe(true);
    for (const n of names) expect(existsSync(join(folder, n))).toBe(false);
    expect(read(folder, 'keep.txt')).toBe('k');
  });

  it('deletes and restores a file whose name has a newline', async () => {
    const { home, folder, head } = await run({ 'odd\nname.txt': '1', 'x.txt': '1' }, {}, ['odd\nname.txt']);
    const r = landed(await landBranch(home, folder, head));
    expect(existsSync(join(folder, 'odd\nname.txt'))).toBe(false);
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'odd\nname.txt')).toBe('1');
  });

  // macOS keeps names as they were made: this é is e plus a combining accent
  const decomposed = 'cafe\u0301.txt';

  it('lands and undoes a decomposed name', async () => {
    const { home, folder, head, workdir } = await run({ [decomposed]: '1', 'x.txt': '1' }, { [decomposed]: '2' });
    expect(read(workdir, decomposed)).toBe('2');
    const r = landed(await landBranch(home, folder, head));
    expect(r.files).toEqual([decomposed]);
    expect(readdirSync(folder)).toContain(decomposed);
    expect(read(folder, decomposed)).toBe('2');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, decomposed)).toBe('1');
  });

  it('stops when a person edited a decomposed name', async () => {
    const { home, folder, head } = await run({ [decomposed]: '1' }, { [decomposed]: '2' });
    writeFileSync(join(folder, decomposed), 'mine');
    expect(await landBranch(home, folder, head)).toEqual({ conflicts: [decomposed] });
    expect(read(folder, decomposed)).toBe('mine');
  });

  it('lands and undoes a symlink and an exec bit', async () => {
    const { home, folder, workdir } = await run({ 'run.sh': 'x', 't.txt': 't' });
    chmodSync(join(workdir, 'run.sh'), 0o755);
    symlinkSync('t.txt', join(workdir, 'link'));
    const head = await commitAll(workdir, 'work');
    const r = landed(await landBranch(home, folder, head!));
    expect(statSync(join(folder, 'run.sh')).mode & 0o111).not.toBe(0);
    expect(readlinkSync(join(folder, 'link'))).toBe('t.txt');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(statSync(join(folder, 'run.sh')).mode & 0o111).toBe(0);
    expect(existsSync(join(folder, 'link'))).toBe(false);
  });

  it('runs no git hook in the folder', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
    const hooks = join(historyDir(home, folder), 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'post-checkout'), '#!/bin/sh\ntouch hook-ran\n', { mode: 0o755 });
    landed(await landBranch(home, folder, head));
    expect(read(folder, 'a.txt')).toBe('2');
    expect(existsSync(join(folder, 'hook-ran'))).toBe(false);
  });

  it('lands a file the folder\'s .gitignore names', async () => {
    const { home, folder, head } = await run({ '.gitignore': 'secret.env\n', 'secret.env': '1' }, { 'secret.env': '2' });
    landed(await landBranch(home, folder, head));
    expect(read(folder, 'secret.env')).toBe('2');
  });

  describe('all of a run\'s work', () => {
    it('lands a new file under a path the folder\'s .gitignore names, and undo takes it out', async () => {
      const { home, folder, head } = await run({ '.gitignore': 'out/\n', 'a.txt': '1' }, { 'out/report.txt': 'r' });
      expect(head).toBeDefined();
      const r = landed(await landBranch(home, folder, head));
      expect(r.files).toEqual(['out/report.txt']);
      expect(read(folder, 'out/report.txt')).toBe('r');
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(existsSync(join(folder, 'out'))).toBe(false);
    });

    it('lands a case-only rename made on disk, and undo brings the old name back', async () => {
      const { home, folder, workdir } = await run({ 'Readme.md': '1' });
      renameSync(join(workdir, 'Readme.md'), join(workdir, 'README.md'));
      const head = await commitAll(workdir, 'rename');
      expect(head).toBeDefined();
      const r = landed(await landBranch(home, folder, head!));
      expect(readdirSync(folder)).toEqual(['README.md']);
      expect(read(folder, 'README.md')).toBe('1');
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(readdirSync(folder)).toEqual(['Readme.md']);
      expect(read(folder, 'Readme.md')).toBe('1');
    });

    it('lands a rename to the other Unicode form, and undo keeps the file', async () => {
      const nfc = 'café.txt';
      const nfd = 'café.txt';
      const { home, folder, workdir } = await run({ [nfc]: '1' });
      renameSync(join(workdir, nfc), join(workdir, nfd));
      const head = await commitAll(workdir, 'rename');
      expect(head).toBeDefined();
      const r = landed(await landBranch(home, folder, head!));
      expect(readdirSync(folder)).toEqual([nfd]);
      expect(read(folder, nfd)).toBe('1');
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(readdirSync(folder)).toEqual([nfc]);
      expect(read(folder, nfc)).toBe('1');
    });

    it('leaves out dependencies, caches and Finder files at any depth', async () => {
      const { head } = await run({ 'a.txt': '1' }, { 'node_modules/x': 'x', 'sub/node_modules/y': 'y', '.venv/z': 'z', 'venv/z': 'z', 'p/__pycache__/m.pyc': 'c', 'd/.DS_Store': 'f', '.DS_Store': 'f' });
      expect(head).toBeUndefined();
    });

    it('commits nothing from the links to what the folder left out', async () => {
      const { home, folder, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' }, [], (f) => {
        put(f, 'big.bin', '');
        truncateSync(join(f, 'big.bin'), MAX_FILE_BYTES + 1);
        put(f, 'nested/file.txt', 'n');
        execFileSync('git', ['init', '-q'], { cwd: join(f, 'nested') });
      });
      expect(landed(await landBranch(home, folder, head)).files).toEqual(['a.txt']);
    });

    it('leaves out a file too big to undo under an ignored path, lands the rest, and undo works', async () => {
      const { home, folder, workdir, head } = await run({ '.gitignore': 'out/\n', 'a.txt': '1' }, { 'out/report.txt': 'r' }, []);
      put(workdir, 'out/model.bin', '');
      truncateSync(join(workdir, 'out/model.bin'), MAX_FILE_BYTES + 1);
      expect(await commitAll(workdir, 'big')).toBeUndefined();
      expect(await notLanded(workdir)).toEqual({ made: [], tooMuch: ['out'], nested: [], kept: [] });
      const r = landed(await landBranch(home, folder, head));
      expect(r.files).toEqual(['out/report.txt']);
      expect(existsSync(join(folder, 'out/model.bin'))).toBe(false);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(existsSync(join(folder, 'out'))).toBe(false);
    });

    it('leaves out every ignored-path change when one folder has more files than undo can keep, names the folders, lands the rest, and undo works', async () => {
      const start = { '.gitignore': 'target/\nout/\n', 'a.txt': '1', 'empty.txt': '', 'twin.md': 'abcd', 'Readme.md': 'r', 'out/Readme.md': 'o', 'out/Guide.md': 'g', 'out/notes.md': 'n', 'target/Keep.md': 'k' };
      const { home, folder, workdir } = await run(start, { 'a.txt': '2' });
      // a case-only rename outside the ignored paths lands with its old spelling; under them, nothing lands this step
      renameSync(join(workdir, 'Readme.md'), join(workdir, 'README.md'));
      renameSync(join(workdir, 'out/Readme.md'), join(workdir, 'out/README.md'));
      renameSync(join(workdir, 'target/Keep.md'), join(workdir, 'target/KEEP.md'));
      renameSync(join(workdir, 'out/notes.md'), join(workdir, 'out/notes2.md'));
      renameSync(join(workdir, 'out/Guide.md'), join(workdir, 'out/GUIDE.md'));
      truncateSync(join(workdir, 'out/GUIDE.md'), MAX_FILE_BYTES + 1);
      // a deleted empty file lands; a deleted 4-byte file beside a hundred thousand 4-byte build files is kept, and finding that costs nothing
      rmSync(join(workdir, 'empty.txt'));
      rmSync(join(workdir, 'twin.md'));
      for (let d = 0; d * 1000 <= MAX_FOLDER_FILES; d++) {
        mkdirSync(join(workdir, `target/d${d}`), { recursive: true });
        for (let f = 0; f < 1000; f++) writeFileSync(join(workdir, `target/d${d}/${f}`), 'abcd');
      }
      const t = Date.now();
      const head = await commitAll(workdir, 'many');
      const took = Date.now() - t;
      console.log(`commitAll with ${MAX_FOLDER_FILES + 1000} ignored 4-byte files and a ${MAX_FILE_BYTES + 1}-byte one: ${took} ms`);
      expect(took).toBeLessThan(10_000);
      expect(await notLanded(workdir)).toEqual({ made: [], tooMuch: ['out', 'target'], nested: [], kept: ['twin.md'] });
      const r = landed(await landBranch(home, folder, head!));
      expect([...r.files].sort()).toEqual(['README.md', 'Readme.md', 'a.txt', 'empty.txt']);
      expect(readdirSync(folder).sort()).toEqual(['.gitignore', 'README.md', 'a.txt', 'out', 'target', 'twin.md']);
      expect(readdirSync(join(folder, 'out')).sort()).toEqual(['Guide.md', 'Readme.md', 'notes.md']);
      expect(readdirSync(join(folder, 'target'))).toEqual(['Keep.md']);
      expect(read(folder, 'README.md')).toBe('r');
      expect(read(folder, 'out/Readme.md')).toBe('o');
      expect(read(folder, 'out/Guide.md')).toBe('g');
      expect(read(folder, 'out/notes.md')).toBe('n');
      expect(read(folder, 'target/Keep.md')).toBe('k');
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(read(folder, 'a.txt')).toBe('1');
      expect(readdirSync(folder).sort()).toEqual(['.gitignore', 'Readme.md', 'a.txt', 'empty.txt', 'out', 'target', 'twin.md']);
      expect(readdirSync(join(folder, 'out')).sort()).toEqual(['Guide.md', 'Readme.md', 'notes.md']);
      expect(readdirSync(join(folder, 'target'))).toEqual(['Keep.md']);
      rmSync(join(workdir, 'target'), { recursive: true, force: true });
    }, 600_000);

    it('a move with an edit under an ignored path waits while a file there is too big, then lands whole, and undo is exact', async () => {
      const { home, folder, workdir, head: first } = await run({ '.gitignore': 'out/\n', 'a.txt': '1', 'out/notes.md': 'n' }, { 'a.txt': '2' });
      renameSync(join(workdir, 'out/notes.md'), join(workdir, 'out/notes2.md'));
      writeFileSync(join(workdir, 'out/notes2.md'), 'edited');
      put(workdir, 'out/model.bin', '');
      truncateSync(join(workdir, 'out/model.bin'), MAX_FILE_BYTES + 1);
      expect(await commitAll(workdir, 'big')).toBeUndefined();
      expect(await notLanded(workdir)).toEqual({ made: [], tooMuch: ['out'], nested: [], kept: [] });
      let r = landed(await landBranch(home, folder, first));
      expect(r.files).toEqual(['a.txt']);
      expect(readdirSync(join(folder, 'out'))).toEqual(['notes.md']);
      expect(read(folder, 'out/notes.md')).toBe('n');
      expect(await undoLanding(home, folder, r)).toBe(true);
      // once the big file is gone, the move lands as the agent made it
      rmSync(join(workdir, 'out/model.bin'));
      const head = await commitAll(workdir, 'move');
      expect(await notLanded(workdir)).toEqual({ made: [], tooMuch: [], nested: [], kept: [] });
      r = landed(await landBranch(home, folder, head!));
      expect([...r.files].sort()).toEqual(['a.txt', 'out/notes.md', 'out/notes2.md']);
      expect(readdirSync(join(folder, 'out'))).toEqual(['notes2.md']);
      expect(read(folder, 'out/notes2.md')).toBe('edited');
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(readdirSync(join(folder, 'out'))).toEqual(['notes.md']);
      expect(read(folder, 'out/notes.md')).toBe('n');
    });

    it('a rename chain under an ignored path keeps every file the person had while a file there is too big', async () => {
      const { home, folder, workdir, head: first } = await run({ '.gitignore': 'out/\n', 'a.txt': '1', 'out/a': 'A', 'out/b': 'B', 'out/c': 'C' }, { 'a.txt': '2' });
      renameSync(join(workdir, 'out/b'), join(workdir, 'out/c'));
      renameSync(join(workdir, 'out/a'), join(workdir, 'out/b'));
      put(workdir, 'out/model.bin', '');
      truncateSync(join(workdir, 'out/model.bin'), MAX_FILE_BYTES + 1);
      expect(await commitAll(workdir, 'chain')).toBeUndefined();
      expect(await notLanded(workdir)).toEqual({ made: [], tooMuch: ['out'], nested: [], kept: [] });
      const r = landed(await landBranch(home, folder, first));
      expect(r.files).toEqual(['a.txt']);
      expect(readdirSync(join(folder, 'out')).sort()).toEqual(['a', 'b', 'c']);
      expect([read(folder, 'out/a'), read(folder, 'out/b'), read(folder, 'out/c')]).toEqual(['A', 'B', 'C']);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect([read(folder, 'a.txt'), read(folder, 'out/a'), read(folder, 'out/b'), read(folder, 'out/c')]).toEqual(['1', 'A', 'B', 'C']);
    });

    it('lands a deletion beside a file too big to keep, but keeps and names one that may have moved into it', async () => {
      const { home, folder, workdir } = await run({ '.gitignore': 'out/\n', 'a.txt': '1', 'notes.md': 'n', 'model.bin': 'm' });
      rmSync(join(workdir, 'notes.md'));
      rmSync(join(workdir, 'model.bin'));
      put(workdir, 'out/model.bin', '');
      truncateSync(join(workdir, 'out/model.bin'), MAX_FILE_BYTES + 1);
      const head = await commitAll(workdir, 'big');
      expect(await notLanded(workdir)).toEqual({ made: [], tooMuch: ['out'], nested: [], kept: ['model.bin'] });
      const r = landed(await landBranch(home, folder, head!));
      expect(r.files).toEqual(['notes.md']);
      expect(readdirSync(folder).sort()).toEqual(['.gitignore', 'a.txt', 'model.bin']);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(read(folder, 'notes.md')).toBe('n');
    });

    it('leaves out a rename to the other Unicode form whose new file is too big, and undo works', async () => {
      const nfc = 'caf\u00e9.bin';
      const nfd = 'cafe\u0301.bin';
      const { home, folder, workdir } = await run({ [nfc]: '1', 'a.txt': '1' });
      renameSync(join(workdir, nfc), join(workdir, nfd));
      truncateSync(join(workdir, nfd), MAX_FILE_BYTES + 1);
      writeFileSync(join(workdir, 'a.txt'), '2');
      const head = await commitAll(workdir, 'big');
      expect(await notLanded(workdir)).toEqual({ made: [], tooMuch: [nfd], nested: [], kept: [nfc] });
      const r = landed(await landBranch(home, folder, head!));
      expect(r.files).toEqual(['a.txt']);
      expect(readdirSync(folder).sort()).toEqual(['a.txt', nfc]);
      expect(read(folder, nfc)).toBe('1');
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(read(folder, 'a.txt')).toBe('1');
      expect(read(folder, nfc)).toBe('1');
    });

    it('keeps and names a file moved to a new name that grew too big, and undo is exact', async () => {
      const { home, folder, workdir } = await run({ 'notes.md': 'n', 'a.txt': '1' });
      renameSync(join(workdir, 'notes.md'), join(workdir, 'notes2.md'));
      truncateSync(join(workdir, 'notes2.md'), MAX_FILE_BYTES + 1);
      writeFileSync(join(workdir, 'a.txt'), '2');
      const head = await commitAll(workdir, 'big move');
      expect(await notLanded(workdir)).toEqual({ made: [], tooMuch: ['notes2.md'], nested: [], kept: ['notes.md'] });
      const r = landed(await landBranch(home, folder, head!));
      expect(r.files).toEqual(['a.txt']);
      expect(readdirSync(folder).sort()).toEqual(['a.txt', 'notes.md']);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(read(folder, 'a.txt')).toBe('1');
      expect(read(folder, 'notes.md')).toBe('n');
    });

    it('keeps the old spelling of a case-only rename whose new one is too big, so nothing is deleted', async () => {
      const { home, folder, workdir } = await run({ 'Readme.md': 'r', 'a.txt': '1' });
      renameSync(join(workdir, 'Readme.md'), join(workdir, 'README.md'));
      truncateSync(join(workdir, 'README.md'), MAX_FILE_BYTES + 1);
      writeFileSync(join(workdir, 'a.txt'), '2');
      const head = await commitAll(workdir, 'big rename');
      expect(await notLanded(workdir)).toEqual({ made: [], tooMuch: ['README.md'], nested: [], kept: ['Readme.md'] });
      const r = landed(await landBranch(home, folder, head!));
      expect(r.files).toEqual(['a.txt']);
      expect(readdirSync(folder).sort()).toEqual(['Readme.md', 'a.txt']);
      expect(read(folder, 'Readme.md')).toBe('r');
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(read(folder, 'a.txt')).toBe('1');
    });

    it('skips and names a project with no commit made under an ignored path, and lands the rest', async () => {
      const { home, folder, workdir, head: first } = await run({ '.gitignore': 'out/\n', 'a.txt': '1' }, { 'out/report.txt': 'r' });
      put(workdir, 'out/sub/x.txt', 'x');
      execFileSync('git', ['init', '-q'], { cwd: join(workdir, 'out/sub') });
      expect(await commitAll(workdir, 'nested')).toBeUndefined();
      expect(await notLanded(workdir)).toEqual({ made: [], tooMuch: [], nested: ['out/sub'], kept: [] });
      const r = landed(await landBranch(home, folder, first));
      expect(r.files).toEqual(['out/report.txt']);
      expect(existsSync(join(folder, 'out/sub'))).toBe(false);
    });

    it('a real repo keeps its ignores', async () => {
      const repo = makeRepo();
      writeFileSync(join(repo, '.gitignore'), 'out/\n');
      execFileSync('git', ['add', '.gitignore'], { cwd: repo });
      execFileSync('git', ['commit', '-qm', 'ignore'], { cwd: repo });
      const wt = await createWorktree(repo, tmp('home-'), 'r1');
      put(wt.workdir, 'out/report.txt', 'r');
      expect(await commitAll(wt.workdir, 'work')).toBeUndefined();
    });
  });

  it('lands nothing when the run changed nothing', async () => {
    const home = tmp('home-');
    const folder = plainFolder({ 'a.txt': '1' });
    const wt = await createWorktree(folder, home, 'r1');
    const r = landed(await landBranch(home, folder, wt.baseSha));
    expect(r.files).toEqual([]);
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'a.txt')).toBe('1');
  });

  it('keeps a person\'s other changes', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1', 'other.txt': '1' }, { 'a.txt': '2' });
    writeFileSync(join(folder, 'other.txt'), 'mine');
    writeFileSync(join(folder, 'added.txt'), 'mine too');
    landed(await landBranch(home, folder, head));
    expect(read(folder, 'a.txt')).toBe('2');
    expect(read(folder, 'other.txt')).toBe('mine');
    expect(read(folder, 'added.txt')).toBe('mine too');
  });

  it('stops on a conflict, names the file, changes nothing', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
    writeFileSync(join(folder, 'a.txt'), 'mine');
    expect(await landBranch(home, folder, head)).toEqual({ conflicts: ['a.txt'] });
    expect(read(folder, 'a.txt')).toBe('mine');
  });

  it('a conflict on one file stops the others landing too', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1', 'b.txt': '1' }, { 'a.txt': '2', 'b.txt': '2' });
    writeFileSync(join(folder, 'a.txt'), 'mine');
    expect(await landBranch(home, folder, head)).toEqual({ conflicts: ['a.txt'] });
    expect(read(folder, 'b.txt')).toBe('1');
  });

  it('stops when a person made a file where the run needs a folder', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1' }, { 'x/y.txt': '2' });
    writeFileSync(join(folder, 'x'), 'mine');
    expect(await landBranch(home, folder, head)).toEqual({ conflicts: ['x'] });
    expect(read(folder, 'x')).toBe('mine');
  });

  it('stops when the run turns a folder into a file and a person added to that folder', async () => {
    const { home, folder, head } = await run({ 'x/y.txt': '1' }, { x: 'file' }, ['x']);
    writeFileSync(join(folder, 'x/mine.txt'), 'mine');
    expect(await landBranch(home, folder, head)).toEqual({ conflicts: ['x/mine.txt'] });
    expect(read(folder, 'x/mine.txt')).toBe('mine');
    expect(read(folder, 'x/y.txt')).toBe('1');
  });

  it('turns a folder into a file and back on undo', async () => {
    const { home, folder, head } = await run({ 'x/y.txt': '1' }, { x: 'file' }, ['x']);
    const r = landed(await landBranch(home, folder, head));
    expect(read(folder, 'x')).toBe('file');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'x/y.txt')).toBe('1');
  });

  it('turns a file into a folder and back on undo', async () => {
    const { home, folder, head } = await run({ x: 'file' }, { 'x/y.txt': '1' }, ['x']);
    const r = landed(await landBranch(home, folder, head));
    expect(read(folder, 'x/y.txt')).toBe('1');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'x')).toBe('file');
  });

  it('a rename that only changes case keeps the file', async () => {
    const { home, folder, head, workdir } = await run({ 'a.txt': '1' });
    expect(head).toBeUndefined();
    execFileSync('git', ['mv', '-f', 'a.txt', 'A.txt'], { cwd: workdir });
    writeFileSync(join(workdir, 'A.txt'), '2');
    const sha = await commitAll(workdir, 'rename');
    const r = landed(await landBranch(home, folder, sha!));
    expect(read(folder, 'A.txt')).toBe('2');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'a.txt')).toBe('1');
  });

  it('removes a folder the run emptied', async () => {
    const { home, folder, head } = await run({ 'd/e/f.txt': '1', 'k.txt': '1' }, {}, ['d']);
    landed(await landBranch(home, folder, head));
    expect(existsSync(join(folder, 'd'))).toBe(false);
  });

  it('never lands or touches what the history left out', async () => {
    const { home, folder, head, workdir } = await run({ 'a.txt': '1', 'sub/b.txt': '1' }, { 'a.txt': '2' }, [], (f) => {
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
    const r = landed(await landBranch(home, folder, head));
    expect(r.files).toEqual(['a.txt']);
    for (const p of ['node_modules', 'big.bin', 'nested', 'sub/node_modules']) expect(lstatSync(join(folder, p)).isSymbolicLink()).toBe(false);
    expect(read(folder, 'node_modules/dep/index.js')).toBe('dep');
    expect(lstatSync(join(folder, 'big.bin')).size).toBe(MAX_FILE_BYTES + 1);
    expect(existsSync(join(folder, 'nested/.git'))).toBe(true);
  });

  it('stops rather than overwrite a big file made during the run', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1' }, { 'big.bin': 'small' });
    put(folder, 'big.bin', '');
    truncateSync(join(folder, 'big.bin'), MAX_FILE_BYTES + 1);
    expect(await landBranch(home, folder, head)).toEqual({ conflicts: ['big.bin'] });
    expect(lstatSync(join(folder, 'big.bin')).size).toBe(MAX_FILE_BYTES + 1);
  });

  it('stops rather than wipe a left-out file when the run turns its folder into a file', async () => {
    const { home, folder, head } = await run({ 'x/y.txt': '1' }, { x: 'file' }, ['x']);
    put(folder, 'x/node_modules/dep.js', 'dep');
    expect(await landBranch(home, folder, head)).toEqual({ conflicts: ['x/node_modules'] });
    expect(read(folder, 'x/node_modules/dep.js')).toBe('dep');
  });

  it('puts the folder back and says so when landing fails part way', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1', 'sub/b.txt': '1', 'sub/gone.txt': '1' }, { 'a.txt': '2', 'sub/b.txt': '2', 'z.txt': 'new' }, ['sub/gone.txt']);
    chmodSync(join(folder, 'sub'), 0o555);
    try {
      await expect(landBranch(home, folder, head)).rejects.toThrow(/put back as it was/);
    } finally {
      chmodSync(join(folder, 'sub'), 0o755);
    }
    expect(read(folder, 'a.txt')).toBe('1');
    expect(read(folder, 'sub/b.txt')).toBe('1');
    expect(read(folder, 'sub/gone.txt')).toBe('1');
    expect(existsSync(join(folder, 'z.txt'))).toBe(false);
  });

  it('undo restores changed, added and deleted files', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1', 'gone.txt': '1' }, { 'a.txt': '2', 'd/new.txt': '3' }, ['gone.txt']);
    const r = landed(await landBranch(home, folder, head));
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'a.txt')).toBe('1');
    expect(read(folder, 'gone.txt')).toBe('1');
    expect(existsSync(join(folder, 'd'))).toBe(false);
    expect(readdirSync(folder).sort()).toEqual(['a.txt', 'gone.txt']);
  });

  it('undo stops if a landed file changed since, names it, changes nothing', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2', 'new.txt': '3' });
    const r = landed(await landBranch(home, folder, head));
    writeFileSync(join(folder, 'new.txt'), 'mine');
    expect(await undoLanding(home, folder, r)).toEqual({ conflicts: ['new.txt'] });
    expect(read(folder, 'new.txt')).toBe('mine');
    expect(read(folder, 'a.txt')).toBe('2');
  });

  it('undo stops if a landed file was deleted since', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
    const r = landed(await landBranch(home, folder, head));
    rmSync(join(folder, 'a.txt'));
    expect(await undoLanding(home, folder, r)).toEqual({ conflicts: ['a.txt'] });
    expect(existsSync(join(folder, 'a.txt'))).toBe(false);
  });

  /** A run's commit that holds a file too big for undo: a step no longer makes one, but work committed before that can. */
  const bigCommit = (workdir: string, files: Record<string, string>) => {
    for (const [f, c] of Object.entries(files)) put(workdir, f, c);
    const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: workdir, encoding: 'utf8' }).trim();
    g('add', '-f', '--', ...Object.keys(files));
    g('commit', '-qm', 'big');
    return g('rev-parse', 'HEAD');
  };

  it('undo stops rather than delete a landed file too big to compare', async () => {
    const { home, folder, workdir } = await run({ 'a.txt': '1' });
    const head = bigCommit(workdir, { 'data.bin': 'x'.repeat(MAX_FILE_BYTES + 1) });
    const r = landed(await landBranch(home, folder, head));
    appendFileSync(join(folder, 'data.bin'), 'mine');
    expect(await undoLanding(home, folder, r)).toEqual({ conflicts: ['data.bin'] });
    expect(lstatSync(join(folder, 'data.bin')).size).toBe(MAX_FILE_BYTES + 5);
  });

  it('undo keeps a person\'s new file beside a landed one', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1' }, { 'd/new.txt': '3' });
    const r = landed(await landBranch(home, folder, head));
    writeFileSync(join(folder, 'd/mine.txt'), 'mine');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(existsSync(join(folder, 'd/new.txt'))).toBe(false);
    expect(read(folder, 'd/mine.txt')).toBe('mine');
  });

  it('undo leaves files it did not land alone', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1', 'other.txt': '1' }, { 'a.txt': '2' });
    const r = landed(await landBranch(home, folder, head));
    writeFileSync(join(folder, 'other.txt'), 'mine');
    expect(await undoLanding(home, folder, r)).toBe(true);
    expect(read(folder, 'a.txt')).toBe('1');
    expect(read(folder, 'other.txt')).toBe('mine');
  });

  it('undo refuses a path outside the folder', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
    const outside = join(dirname(folder), 'outside.txt');
    writeFileSync(outside, 'keep');
    const r = landed(await landBranch(home, folder, head));
    await expect(undoLanding(home, folder, { ...r, files: [`../outside.txt`] })).rejects.toThrow();
    expect(readFileSync(outside, 'utf8')).toBe('keep');
    rmSync(outside);
  });

  it('a missing folder is a plain error', async () => {
    const { home, folder, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
    const r = landed(await landBranch(home, folder, head));
    rmSync(folder, { recursive: true });
    for (const attempt of [landBranch(home, folder, head), undoLanding(home, folder, r)]) {
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
      const { home, folder, head } = await run({ 'a.txt': '1' }, { 'notes.txt': 'run' });
      writeFileSync(join(folder, 'NOTES.txt'), 'mine');
      expect(await landBranch(home, folder, head)).toEqual({ conflicts: ['NOTES.txt'] });
      expect(read(folder, 'NOTES.txt')).toBe('mine');
    });

    it.each([[nfc, nfd], [nfd, nfc]])('stops when a person made the same name in another Unicode form', async (runs, mine) => {
      const { home, folder, head } = await run({ 'a.txt': '1' }, { [runs]: 'run' });
      writeFileSync(join(folder, mine), 'mine');
      expect(await landBranch(home, folder, head)).toEqual({ conflicts: [mine] });
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
      const { home, folder, head } = await run({ 'a.txt': '1' }, { [runs]: 'run' });
      writeFileSync(join(folder, mine), 'mine');
      expect(await landBranch(home, folder, head)).toEqual({ conflicts: [mine] });
      expect(read(folder, mine)).toBe('mine');
    });

    it('stops when the folded name is a folder above the file', async () => {
      const { home, folder, head } = await run({ 'a.txt': '1' }, { 'docs/x.txt': 'run' });
      writeFileSync(join(folder, 'DOCS'), 'mine');
      expect(await landBranch(home, folder, head)).toEqual({ conflicts: ['DOCS'] });
      expect(read(folder, 'DOCS')).toBe('mine');
    });

    it('stops on a left-out file in another case', async () => {
      const { home, folder, head } = await run({ 'a.txt': '1' }, { 'big.bin': 'small' });
      put(folder, 'BIG.bin', '');
      truncateSync(join(folder, 'BIG.bin'), MAX_FILE_BYTES + 1);
      expect(await landBranch(home, folder, head)).toEqual({ conflicts: ['BIG.bin'] });
      expect(lstatSync(join(folder, 'BIG.bin')).size).toBe(MAX_FILE_BYTES + 1);
    });

    it('undo stops when a person remade a removed file in another case', async () => {
      const { home, folder, head } = await run({ 'a.txt': '1', 'gone.txt': 'old' }, { 'a.txt': '2' }, ['gone.txt']);
      const r = landed(await landBranch(home, folder, head));
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
      const { home, folder, head } = await nested();
      await expect(landBranch(home, folder, head)).rejects.toThrow(/"app"/);
      expect(read(folder, 'a.txt')).toBe('1');
      expect(readdirSync(folder)).toEqual(['a.txt']);
    });

    it('is refused in words a person can read', async () => {
      const { home, folder, head } = await nested();
      const e: Error = await landBranch(home, folder, head).then(() => { throw new Error('should have failed'); }, (x) => x);
      expect(e.message).not.toMatch(/git|repo|commit|submodule|branch/i);
      expect(e.message).not.toContain(home);
    });
  });

  it('undo goes through when a person deleted a landed file too big for the history', async () => {
    const { home, folder, workdir } = await run({ 'a.txt': '1' });
    const head = bigCommit(workdir, { 'a.txt': '2', 'data.bin': 'x'.repeat(MAX_FILE_BYTES + 1) });
    const r = landed(await landBranch(home, folder, head));
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
      const { home, folder, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
      const r = landed(await landBranch(home, folder, head));
      const moved = `${folder}-moved`;
      renameSync(folder, moved);
      plainly(await undoLanding(home, moved, r).then(() => { throw new Error('should have failed'); }, (x) => x), home);
      expect(read(moved, 'a.txt')).toBe('2');
    });

    it('landing says so plainly and changes nothing', async () => {
      const { home, folder, head } = await run({ 'a.txt': '1' }, { 'a.txt': '2' });
      const moved = `${folder}-moved`;
      renameSync(folder, moved);
      plainly(await landBranch(home, moved, head).then(() => { throw new Error('should have failed'); }, (x) => x), home);
      expect(read(moved, 'a.txt')).toBe('1');
    });
  });

  describe('file permissions', () => {
    const mode = (folder: string, f: string) => statSync(join(folder, f)).mode & 0o777;

    it('keeps a private file private through landing and undo', async () => {
      const { home, folder, head } = await run({ '.env': 'A=1' }, { '.env': 'A=2' }, [], (f) => chmodSync(join(f, '.env'), 0o600));
      const r = landed(await landBranch(home, folder, head));
      expect(read(folder, '.env')).toBe('A=2');
      expect(mode(folder, '.env')).toBe(0o600);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(read(folder, '.env')).toBe('A=1');
      expect(mode(folder, '.env')).toBe(0o600);
    });

    it('keeps a private script private and runnable', async () => {
      const { home, folder, head } = await run({ 's.sh': '1' }, { 's.sh': '2' }, [], (f) => chmodSync(join(f, 's.sh'), 0o700));
      const r = landed(await landBranch(home, folder, head));
      expect(mode(folder, 's.sh')).toBe(0o700);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(mode(folder, 's.sh')).toBe(0o700);
    });

    it('takes the exec bit from the work and keeps the private bits', async () => {
      const { home, folder, workdir } = await run({ 's.sh': '1' }, {}, [], (f) => chmodSync(join(f, 's.sh'), 0o600));
      chmodSync(join(workdir, 's.sh'), 0o755);
      const head = await commitAll(workdir, 'work');
      const r = landed(await landBranch(home, folder, head!));
      expect(mode(folder, 's.sh')).toBe(0o700);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(mode(folder, 's.sh')).toBe(0o600);
    });

    it('stays private through a rename that only changes case', async () => {
      const { home, folder, workdir } = await run({ 'a.txt': '1' }, {}, [], (f) => chmodSync(join(f, 'a.txt'), 0o600));
      execFileSync('git', ['mv', '-f', 'a.txt', 'A.txt'], { cwd: workdir });
      const r = landed(await landBranch(home, folder, (await commitAll(workdir, 'rename'))!));
      expect(mode(folder, 'A.txt')).toBe(0o600);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(mode(folder, 'a.txt')).toBe(0o600);
    });

    it('stays private through a rename to another name, edited or not', async () => {
      const text = Array.from({ length: 20 }, (_, i) => `KEY_${i}=value`).join('\n');
      const { home, folder, workdir } = await run({ 'creds.txt': text, 'k.pem': 'x' }, {}, [], (f) => {
        chmodSync(join(f, 'creds.txt'), 0o600);
        chmodSync(join(f, 'k.pem'), 0o400);
      });
      execFileSync('git', ['mv', 'creds.txt', 'new-creds.txt'], { cwd: workdir });
      execFileSync('git', ['mv', 'k.pem', 'moved.pem'], { cwd: workdir });
      writeFileSync(join(workdir, 'new-creds.txt'), `${text}\nKEY_20=value`);
      const r = landed(await landBranch(home, folder, (await commitAll(workdir, 'rename'))!));
      expect(mode(folder, 'new-creds.txt')).toBe(0o600);
      expect(mode(folder, 'moved.pem')).toBe(0o400);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(mode(folder, 'creds.txt')).toBe(0o600);
      expect(mode(folder, 'k.pem')).toBe(0o400);
    });

    describe('a rename', () => {
      const text = (word: string) => Array.from({ length: 30 }, (_, i) => `${word} line ${i} ${word.repeat(3)}`).join('\n');
      /** Land work done on a folder holding `start`, with `secret` at 0600. */
      const land = async (start: Record<string, string>, secret: string[], work: (w: string) => void, prepare?: (folder: string, home: string) => void) => {
        const { home, folder, workdir } = await run(start, {}, [], (f) => secret.forEach((p) => chmodSync(join(f, p), 0o600)));
        work(workdir);
        const sha = (await commitAll(workdir, 'work'))!;
        prepare?.(folder, home);
        return { home, folder, r: landed(await landBranch(home, folder, sha)) };
      };
      const mv = (w: string, a: string, b: string) => renameSync(join(w, a), join(w, b));

      it('takes no mode from a public copy a person added meanwhile', async () => {
        const { folder } = await land({ 'k.txt': text('key') }, ['k.txt'], (w) => mv(w, 'k.txt', 'new.txt'), (f) => writeFileSync(join(f, 'copy.txt'), text('key')));
        expect(mode(folder, 'new.txt')).toBe(0o600);
        expect(mode(folder, 'copy.txt')).toBe(0o644);
      });

      it('takes no mode from a similar file a person added meanwhile', async () => {
        const { folder } = await land({ 'o.txt': 'other' }, [], (w) => writeFileSync(join(w, 'new.txt'), text('scratch')), (f) => {
          writeFileSync(join(f, 'scratch.txt'), text('scratch'));
          chmodSync(join(f, 'scratch.txt'), 0o666);
        });
        expect(mode(folder, 'new.txt')).toBe(0o644);
      });

      it('takes no mode from a file the person already took to where the work did', async () => {
        const fresh = '0123456789\n'.repeat(100);
        const { folder } = await land({ a: text('old') }, [], (w) => (writeFileSync(join(w, 'b'), text('old')), writeFileSync(join(w, 'a'), fresh)), (f) => {
          writeFileSync(join(f, 'a'), fresh);
          chmodSync(join(f, 'a'), 0o600);
        });
        expect(mode(folder, 'b')).toBe(0o644);
      });

      it('to a backup, while a new file takes the name', async () => {
        const fresh = '0123456789\n'.repeat(100);
        const { folder } = await land({ key: text('secret') }, ['key'], (w) => (mv(w, 'key', 'key.old'), writeFileSync(join(w, 'key'), fresh)));
        expect(read(folder, 'key.old')).toBe(text('secret'));
        expect(mode(folder, 'key.old')).toBe(0o600);
        expect(mode(folder, 'key')).toBe(0o600);
      });

      it('never starts wider than git would write it', async () => {
        const { folder } = await land({ 'wide.txt': text('wide') }, [], (w) => mv(w, 'wide.txt', 'new.txt'), (f) => chmodSync(join(f, 'wide.txt'), 0o666));
        expect(mode(folder, 'new.txt')).toBe(0o644);
      });

      it('onto a public file stays private, and undo stays private', async () => {
        const { home, folder, r } = await land({ 's.txt': text('secret'), 'pub.txt': text('public') }, ['s.txt'], (w) => mv(w, 's.txt', 'pub.txt'));
        expect(read(folder, 'pub.txt')).toBe(text('secret'));
        expect(mode(folder, 'pub.txt')).toBe(0o600);
        expect(await undoLanding(home, folder, r)).toBe(true);
        expect(read(folder, 's.txt')).toBe(text('secret'));
        expect(mode(folder, 's.txt')).toBe(0o600);
      });

      it('in a swap stays private both ways', async () => {
        const { home, folder, r } = await land({ a: text('secret'), b: text('public') }, ['a'], (w) => (mv(w, 'a', 't'), mv(w, 'b', 'a'), mv(w, 't', 'b')));
        expect(read(folder, 'b')).toBe(text('secret'));
        expect(mode(folder, 'b')).toBe(0o600);
        expect(await undoLanding(home, folder, r)).toBe(true);
        expect(read(folder, 'a')).toBe(text('secret'));
        expect(mode(folder, 'a')).toBe(0o600);
      });

      it('in a rotation follows the content', async () => {
        const { folder } = await land({ a: text('secret'), b: text('public'), c: text('open') }, ['a'], (w) => (mv(w, 'c', 't'), mv(w, 'b', 'c'), mv(w, 'a', 'b'), mv(w, 't', 'a')));
        expect(read(folder, 'b')).toBe(text('secret'));
        expect(mode(folder, 'b')).toBe(0o600);
        expect(mode(folder, 'c')).toBe(0o644);
      });

      it('from a file into a folder of its name', async () => {
        const { home, folder, r } = await land({ key: text('secret') }, ['key'], (w) => (mv(w, 'key', 't'), mkdirSync(join(w, 'key')), mv(w, 't', 'key/key')));
        expect(mode(folder, 'key/key')).toBe(0o600);
        expect(await undoLanding(home, folder, r)).toBe(true);
        expect(mode(folder, 'key')).toBe(0o600);
      });

      it('from a folder to a file of its name', async () => {
        const { home, folder, r } = await land({ 'conf/secret': text('secret') }, ['conf/secret'], (w) => (mv(w, 'conf/secret', 't'), rmSync(join(w, 'conf'), { recursive: true }), mv(w, 't', 'conf')));
        expect(mode(folder, 'conf')).toBe(0o600);
        expect(await undoLanding(home, folder, r)).toBe(true);
        expect(mode(folder, 'conf/secret')).toBe(0o600);
      });

      it('onto a name that differs from an old file only by case', async () => {
        const { folder } = await land({ 'secret.txt': text('secret'), 'a.txt': text('public') }, ['secret.txt'], (w) => (rmSync(join(w, 'a.txt')), mv(w, 'secret.txt', 'A.txt')));
        expect(read(folder, 'A.txt')).toBe(text('secret'));
        expect(mode(folder, 'A.txt')).toBe(0o600);
      });

      // git never breaks a pair under 400 bytes, so these rest on matching the content itself
      for (const size of [98, 263, 397]) {
        const small = (c: string) => c.padEnd(size, `${c} `);
        const [secret, open, plain] = [small('secret'), small('public'), small('zzz')];

        it(`of ${size} bytes onto a public file stays private`, async () => {
          const { home, folder, r } = await land({ s: secret, pub: open }, ['s'], (w) => mv(w, 's', 'pub'));
          expect(read(folder, 'pub')).toBe(secret);
          expect(mode(folder, 'pub')).toBe(0o600);
          expect(await undoLanding(home, folder, r)).toBe(true);
          expect(read(folder, 's')).toBe(secret);
          expect(mode(folder, 's')).toBe(0o600);
        });

        it(`of ${size} bytes in a swap stays private`, async () => {
          const { home, folder, r } = await land({ a: secret, b: open }, ['a'], (w) => (mv(w, 'a', 't'), mv(w, 'b', 'a'), mv(w, 't', 'b')));
          expect(read(folder, 'b')).toBe(secret);
          expect(mode(folder, 'b')).toBe(0o600);
          expect(await undoLanding(home, folder, r)).toBe(true);
          expect(read(folder, 'a')).toBe(secret);
          expect(mode(folder, 'a')).toBe(0o600);
        });

        it(`of ${size} bytes in a rotation follows the content`, async () => {
          const { home, folder, r } = await land({ a: secret, b: open, c: plain }, ['a'], (w) => (mv(w, 'c', 't'), mv(w, 'b', 'c'), mv(w, 'a', 'b'), mv(w, 't', 'a')));
          expect(read(folder, 'b')).toBe(secret);
          expect(mode(folder, 'b')).toBe(0o600);
          expect(mode(folder, 'c')).toBe(0o644);
          expect(await undoLanding(home, folder, r)).toBe(true);
          expect(read(folder, 'a')).toBe(secret);
          expect(mode(folder, 'a')).toBe(0o600);
        });

        it(`of ${size} bytes to a backup, while a new file takes the name`, async () => {
          const { home, folder, r } = await land({ key: secret }, ['key'], (w) => (mv(w, 'key', 'key.old'), writeFileSync(join(w, 'key'), plain)));
          expect(read(folder, 'key.old')).toBe(secret);
          expect(mode(folder, 'key.old')).toBe(0o600);
          expect(await undoLanding(home, folder, r)).toBe(true);
          expect(read(folder, 'key')).toBe(secret);
          expect(mode(folder, 'key')).toBe(0o600);
        });
      }

      it('takes the narrowest mode when the same content had two names', async () => {
        const { folder } = await land({ a: 'same', b: 'same' }, ['a'], (w) => (rmSync(join(w, 'a')), rmSync(join(w, 'b')), writeFileSync(join(w, 'c'), 'same')));
        expect(mode(folder, 'c')).toBe(0o600);
      });

      it('takes no mode from a small file with the same content outside the work', async () => {
        const { folder } = await land({ o: 'other' }, [], (w) => writeFileSync(join(w, 'new.txt'), 'token'), (f) => {
          writeFileSync(join(f, 'mine.txt'), 'token');
          chmodSync(join(f, 'mine.txt'), 0o600);
        });
        expect(mode(folder, 'new.txt')).toBe(0o644);
      });

      it('past the search cap keeps exact matches and lets inexact ones go', async () => {
        const names = Array.from({ length: 2100 }, (_, i) => `f${i}`);
        const body = (n: string) => Array.from({ length: 12 }, (_, i) => `${n} ${i} ${n.repeat(4)}`).join('\n');
        const start = { ...Object.fromEntries(names.map((n) => [n, body(n)])), s: 'token', pub: 'open', edited: text('edited') };
        const { folder } = await land(start, ['s', 'edited'], (w) => {
          for (const n of names) (writeFileSync(join(w, n), `${body(n)}\nmore`), mv(w, n, `${n}.new`));
          mv(w, 's', 'pub');
          writeFileSync(join(w, 'edited'), `${text('edited')}\nmore`);
          mv(w, 'edited', 'edited.new');
        });
        expect(mode(folder, 'pub')).toBe(0o600);
        expect(mode(folder, 'edited.new')).toBe(0o644);
      });

      it('is seen past a rename limit set in git config', async () => {
        const names = ['a', 'b', 'c', 'd'];
        const start = Object.fromEntries(names.map((n) => [n, text(n)]));
        const { folder } = await land(start, names, (w) => names.forEach((n) => (writeFileSync(join(w, n), `${text(n)}\nmore`), mv(w, n, `${n}.new`))), (f, home) => execFileSync('git', ['--git-dir', historyDir(home, f), 'config', 'diff.renameLimit', '1']));
        for (const n of names) expect(mode(folder, `${n}.new`)).toBe(0o600);
      });
    });

    it('a private file the run deletes comes back private on undo', async () => {
      const { home, folder, head } = await run({ '.env': 'A=1', 'a.txt': '1' }, { 'a.txt': '2' }, ['.env'], (f) => chmodSync(join(f, '.env'), 0o600));
      const r = landed(await landBranch(home, folder, head));
      expect(r.modes).toEqual({ '.env': 0o600 });
      expect(existsSync(join(folder, '.env'))).toBe(false);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(read(folder, '.env')).toBe('A=1');
      expect(mode(folder, '.env')).toBe(0o600);
    });

    it('keeps a mode that survives being stored as JSON', async () => {
      const { home, folder, head } = await run({ 'k.pem': 'x' }, {}, ['k.pem'], (f) => chmodSync(join(f, 'k.pem'), 0o400));
      const r = landed(await landBranch(home, folder, head));
      expect(await undoLanding(home, folder, JSON.parse(JSON.stringify(r)))).toBe(true);
      expect(mode(folder, 'k.pem')).toBe(0o400);
    });

    it('records no modes for files git brings back as they were', async () => {
      const { home, folder, head } = await run({ 'a.txt': '1', 's.sh': '1', 'kept.txt': 'k' }, { 'kept.txt': 'k2' }, ['a.txt', 's.sh'], (f) => {
        chmodSync(join(f, 'a.txt'), 0o644);
        chmodSync(join(f, 's.sh'), 0o755);
      });
      const r = landed(await landBranch(home, folder, head));
      expect(r.modes).toBeUndefined();
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(mode(folder, 'a.txt')).toBe(0o644);
      expect(mode(folder, 's.sh')).toBe(0o755);
    });

    it('a private file the run swaps for a symlink comes back private on undo', async () => {
      const { home, folder, workdir } = await run({ '.env': 'A=1', 'shared.env': 'B=2' }, {}, [], (f) => chmodSync(join(f, '.env'), 0o600));
      rmSync(join(workdir, '.env'));
      symlinkSync('shared.env', join(workdir, '.env'));
      const r = landed(await landBranch(home, folder, (await commitAll(workdir, 'link'))!));
      expect(readlinkSync(join(folder, '.env'))).toBe('shared.env');
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(lstatSync(join(folder, '.env')).isFile()).toBe(true);
      expect(read(folder, '.env')).toBe('A=1');
      expect(mode(folder, '.env')).toBe(0o600);
    });

    it('a private file the run swaps for a folder comes back private on undo', async () => {
      const { home, folder, head } = await run({ key: 'x', 'a.txt': '1' }, { 'key/inner.txt': 'y' }, ['key'], (f) => chmodSync(join(f, 'key'), 0o600));
      const r = landed(await landBranch(home, folder, head));
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(read(folder, 'key')).toBe('x');
      expect(mode(folder, 'key')).toBe(0o600);
    });

    it('a private file the run deletes stays private when landing fails part way', async () => {
      const { home, folder, head } = await run({ '.env': 'A=1', 'sub/b.txt': '1' }, { 'sub/b.txt': '2' }, ['.env'], (f) => chmodSync(join(f, '.env'), 0o600));
      chmodSync(join(folder, 'sub'), 0o555);
      try {
        await expect(landBranch(home, folder, head)).rejects.toThrow(/put back as it was/);
      } finally {
        chmodSync(join(folder, 'sub'), 0o755);
      }
      expect(read(folder, '.env')).toBe('A=1');
      expect(mode(folder, '.env')).toBe(0o600);
    });

    it('stays private when landing fails part way', async () => {
      const { home, folder, head } = await run({ '.env': 'A=1', 'sub/b.txt': '1' }, { '.env': 'A=2', 'sub/b.txt': '2' }, [], (f) => chmodSync(join(f, '.env'), 0o600));
      chmodSync(join(folder, 'sub'), 0o555);
      try {
        await expect(landBranch(home, folder, head)).rejects.toThrow(/put back as it was/);
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
      const { home, folder, workdir } = await run({ '.gitattributes': attributes, 'keep.txt': 'k' }, {}, [], (f) => {
        writeFileSync(join(f, 'data.csv'), csv);
        writeFileSync(join(f, 'p.bin'), binary);
      });
      writeFileSync(join(workdir, 'data.csv'), 'x,y\r\n');
      writeFileSync(join(workdir, 'p.bin'), Buffer.from([0x0d, 0x0a]));
      const r = landed(await landBranch(home, folder, (await commitAll(workdir, 'work'))!));
      expect(bytes(folder, 'data.csv').equals(Buffer.from('x,y\r\n'))).toBe(true);
      expect(bytes(folder, 'p.bin').equals(Buffer.from([0x0d, 0x0a]))).toBe(true);
      expect(await undoLanding(home, folder, r)).toBe(true);
      expect(bytes(folder, 'data.csv').equals(csv)).toBe(true);
      expect(bytes(folder, 'p.bin').equals(binary)).toBe(true);
    });

    it('a run sees and keeps a folder\'s bytes', async () => {
      const { home, folder, head, workdir } = await run({ '.gitattributes': '* text\n', 'data.csv': 'a\r\n', 'b.txt': '1' }, { 'b.txt': '2' });
      expect(bytes(workdir, 'data.csv').equals(Buffer.from('a\r\n'))).toBe(true);
      landed(await landBranch(home, folder, head));
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
