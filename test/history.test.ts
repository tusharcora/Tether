import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { gitInfo } from '../src/code.js';
import { repoConnector } from '../src/codemode/connectors/repo.js';
import { createWorktree } from '../src/git.js';
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
  it('keeps files a .gitignore would hide, and still leaves a nested repo out', async () => {
    const { home, folder } = plain({ '.gitignore': '*.csv\n', 'data.csv': 'x', 'a.txt': '1' });
    mkdirSync(join(folder, 'inner'));
    execFileSync('git', ['init', '-q'], { cwd: join(folder, 'inner') });
    const s = await snapshotFolder(home, folder);
    expect(names(home, folder, s.sha)).toEqual(['.gitignore', 'a.txt', 'data.csv']);
    expect(s.leftOut).toEqual(['inner']);
  });
  it('overlapping snapshots of one folder both stay reachable from main', async () => {
    const { home, folder } = plain({ 'a.txt': '1' });
    await snapshotFolder(home, folder);
    writeFileSync(join(folder, 'b.txt'), '2');
    const p1 = snapshotFolder(home, folder);
    const p2 = new Promise((r) => setTimeout(r, 15)).then(() => (writeFileSync(join(folder, 'c.txt'), '3'), snapshotFolder(home, folder)));
    const shas = [(await p1).sha, (await p2).sha];
    for (const sha of shas) expect(() => out(folder, ...gitDir(home, folder), 'merge-base', '--is-ancestor', sha, 'refs/heads/main')).not.toThrow();
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
  it('a repo at the home folder does not make the folders in it repos', async () => {
    const fake = makeRepo();
    const folder = join(fake, 'Documents', 'Masters HW');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'hw.py'), '1\n');
    writeFileSync(join(fake, 'private.txt'), 'not this\n');
    const inner = join(fake, 'code', 'app');
    mkdirSync(join(inner, '.git'), { recursive: true });
    vi.stubEnv('HOME', fake);
    try {
      expect(insideGit(folder)).toBe(false);
      expect(insideGit(inner)).toBe(true);
      expect(await gitInfo(folder)).toEqual({ git: false, prefix: '' });
      writeFileSync(join(fake, 'README.md'), 'a change of the home repo\n');
      const diff = (await repoConnector({ workdir: folder, writable: false }).methods()).find((x) => x.name === 'diff')!;
      expect(await diff.run([])).toBe('(no changes)');
      const home = tmp('aorch-home-');
      const wt = await createWorktree(folder, home, 'r1');
      expect(wt.history).toBe(historyDir(home, folder));
      expect(readdirSync(wt.workdir).sort()).toEqual(['.git', 'hw.py']);
      expect(out(fake, 'status', '--porcelain')).not.toContain('A ');
      expect(out(fake, 'log', '--all', '--format=%s').trim()).toBe('init');
      await expect(snapshotFolder(home, fake)).rejects.toBeInstanceOf(FolderRefused);
    } finally {
      vi.unstubAllEnvs();
    }
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
