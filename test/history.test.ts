import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FolderRefused, historyDir, insideGit, MAX_FILE_BYTES, snapshotDirty, snapshotFolder } from '../src/history.js';
import { makeRepo, tmp } from './helpers.js';

const out = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' });

function plain(files: Record<string, string>) {
  const home = tmp('home-');
  const folder = tmp('plain-');
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, f)), { recursive: true });
    writeFileSync(join(folder, f), c);
  }
  return { home, folder };
}
const gitDir = (home: string, folder: string) => ['--git-dir', historyDir(home, folder)];
const showH = (home: string, folder: string, sha: string, file: string) => out(folder, ...gitDir(home, folder), 'show', `${sha}:${file}`);
const names = (home: string, folder: string, sha: string) => out(folder, ...gitDir(home, folder), 'ls-tree', '-r', '--name-only', sha).split('\n').filter(Boolean);
const showR = (repo: string, sha: string, file: string) => out(repo, 'show', `${sha}:${file}`);
const status = (repo: string) => out(repo, 'status', '--porcelain');
const head = (repo: string) => out(repo, 'rev-parse', 'HEAD').trim();

describe('history', () => {
  it('snapshots a plain folder without touching it', async () => {
    const { home, folder } = plain({ 'a b.txt': 'one\n' });
    const s = await snapshotFolder(home, folder);
    expect(showH(home, folder, s.sha, 'a b.txt')).toBe('one\n');
    expect(readdirSync(folder)).toEqual(['a b.txt']);
  });
  it('reuses the last commit when nothing changed', async () => {
    const { home, folder } = plain({ 'a.txt': '1' });
    expect((await snapshotFolder(home, folder)).sha).toBe((await snapshotFolder(home, folder)).sha);
  });
  it('leaves out dependencies, large files and nested repos, and says so', async () => {
    const { home, folder } = plain({ 'a.txt': '1', 'node_modules/x/i.js': '1', 'sub/.venv/y': '1' });
    writeFileSync(join(folder, 'big.bin'), Buffer.alloc(MAX_FILE_BYTES + 1));
    mkdirSync(join(folder, 'inner'));
    execFileSync('git', ['init', '-q'], { cwd: join(folder, 'inner') });
    const s = await snapshotFolder(home, folder);
    expect(s.leftOut.sort()).toEqual(['big.bin', 'inner', 'node_modules', 'sub/.venv']);
    expect(names(home, folder, s.sha)).toEqual(['a.txt']);
  });
  it('refuses the home folder and the root', async () => {
    await expect(snapshotFolder(tmp(), homedir())).rejects.toBeInstanceOf(FolderRefused);
    await expect(snapshotFolder(tmp(), '/')).rejects.toThrow(/too big|whole/);
  });
  it('refuses a folder with too many files, naming the limit', async () => {
    const { home, folder } = plain({ 'a.txt': '1', 'b.txt': '1', 'c.txt': '1' });
    await expect(snapshotFolder(home, folder, { maxFiles: 2 })).rejects.toThrow(/more than 2 files/);
  });
  it('insideGit sees a parent repo', () => {
    const repo = makeRepo();
    mkdirSync(join(repo, 'sub'));
    expect(insideGit(join(repo, 'sub'))).toBe(true);
    expect(insideGit(tmp())).toBe(false);
  });
  it('snapshotDirty includes uncommitted and untracked work and leaves the repo alone', async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, 'README.md'), 'changed\n');
    writeFileSync(join(repo, 'new.txt'), 'new\n');
    const before = status(repo);
    const sha = await snapshotDirty(repo);
    expect(showR(repo, sha, 'new.txt')).toBe('new\n');
    expect(showR(repo, sha, 'README.md')).toBe('changed\n');
    expect(status(repo)).toBe(before);
    expect(head(repo)).not.toBe(sha);
  });
  it('snapshotDirty returns HEAD for a clean repo', async () => {
    const repo = makeRepo();
    expect(await snapshotDirty(repo)).toBe(head(repo));
  });
});
