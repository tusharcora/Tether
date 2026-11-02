import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { git, gitEnv, gitTop, must } from './git.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FOLDER_FILES = 100_000;
const SKIP_NAMES = ['node_modules', '.venv', 'venv', '__pycache__', '.DS_Store'];

// shortcut: history grows without pruning, add a sweep (git gc, old refs) when a folder's history passes a size people notice

/** Marks a commit that holds a person's uncommitted work, so shipping can tell it from real history. */
export const DIRTY_MESSAGE = 'tether: uncommitted work';

export class FolderRefused extends Error {}

export interface Snapshot {
  sha: string;
  leftOut: string[];
}

/** True when `dir` or a parent holds `.git` (a folder, or a file for worktrees and submodules). */
export function insideGit(dir: string): boolean {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return true;
    if (dirname(d) === d) return false;
  }
}

export function historyDir(home: string, folder: string): string {
  const id = createHash('sha256').update(realpathSync(folder)).digest('hex').slice(0, 16);
  return join(home, 'history', `${id}.git`);
}

/** Refuse before walking: these would scan the whole disk or Tether's own state. */
function refuse(home: string, real: string): void {
  if (real === '/' || real === homedir()) {
    throw new FolderRefused('This folder is too big to work in: it is your whole home folder. Pick a project folder inside it.');
  }
  const rel = relative(real, resolve(home));
  if (rel === '' || !rel.startsWith('..')) throw new FolderRefused('This folder is too big to work in: it holds Tether itself. Pick a project folder inside it.');
}

/** Walk without following symlinks. Returns the files to keep and what to skip, as paths relative to `root`. */
function survey(root: string, maxFiles: number): { files: string[]; leftOut: string[] } {
  const leftOut: string[] = [];
  const kept: string[] = [];
  let files = 0;
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const p = join(dir, e.name);
      if (SKIP_NAMES.includes(e.name)) {
        if (e.name !== '.DS_Store') leftOut.push(r);
        continue;
      }
      if (e.isDirectory()) {
        if (existsSync(join(p, '.git'))) leftOut.push(r);
        else walk(p, r);
        continue;
      }
      if (++files > maxFiles) {
        throw new FolderRefused(`This folder has more than ${maxFiles.toLocaleString('en-US')} files, so Tether can't keep an undo history for it.`);
      }
      if (e.isFile() && lstatSync(p).size > MAX_FILE_BYTES) leftOut.push(r);
      else kept.push(r);
    }
  };
  walk(root, '');
  return { files: kept, leftOut };
}

const anchored = (p: string) => '/' + p.replace(/[\\*?[]/g, '\\$&');

/** Run `fn` with git env pointing the history at `folder` through a throwaway index. */
export async function withFolder<T>(history: string, folder: string, fn: (env: Record<string, string>) => Promise<T>): Promise<T> {
  const index = join(history, `tmp-${randomBytes(6).toString('hex')}`);
  try {
    return await fn({ GIT_DIR: history, GIT_WORK_TREE: folder, GIT_INDEX_FILE: index });
  } finally {
    rmSync(index, { force: true });
  }
}

async function out(cwd: string, env: Record<string, string>, args: string[], stdin?: string): Promise<string> {
  const r = await gitEnv(cwd, args, env, stdin);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout.trim();
}

/**
 * Tree of `env`'s index as a commit on `parent`, or `parent` itself when the tree is the same. `files` are added by force, exactly,
 * so a .gitignore or global excludes in the folder cannot drop them; without `files` it is `add -A` (real repos, which keep their ignores).
 */
async function commitTree(cwd: string, env: Record<string, string>, parent: string | null, files?: string[], message = 'snapshot'): Promise<string> {
  if (!files) await out(cwd, env, ['add', '-A']);
  else if (files.length) await out(cwd, { ...env, GIT_LITERAL_PATHSPECS: '1' }, ['add', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'], files.join('\0'));
  const tree = await out(cwd, env, ['write-tree']);
  if (parent && (await out(cwd, env, ['rev-parse', `${parent}^{tree}`])) === tree) return parent;
  return out(cwd, env, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message]);
}

/** Commit the folder's current files into its hidden history. Nothing is written inside the folder. */
export async function snapshotFolder(home: string, folder: string, limits: { maxFiles?: number } = {}): Promise<Snapshot> {
  const real = realpathSync(folder);
  refuse(home, real);
  const { files, leftOut } = survey(real, limits.maxFiles ?? MAX_FOLDER_FILES);
  const history = historyDir(home, real);
  if (!existsSync(join(history, 'HEAD'))) {
    mkdirSync(dirname(history), { recursive: true });
    await must(dirname(history), ['init', '-q', '--bare', '-b', 'main', history]);
  }
  mkdirSync(join(history, 'info'), { recursive: true });
  // rename so a concurrent snapshot never reads a half-written file
  const exclude = join(history, 'info', `exclude-${randomBytes(4).toString('hex')}`);
  writeFileSync(exclude, [...SKIP_NAMES, ...leftOut.map(anchored)].join('\n') + '\n');
  renameSync(exclude, join(history, 'info', 'exclude'));
  const ZERO = '0'.repeat(40);
  const sha = await withFolder(history, real, async (env) => {
    // two snapshots of one folder may overlap: update-ref only if main is still the parent we read, else read again and rebuild on it
    for (let attempt = 0; ; attempt++) {
      const r = await gitEnv(real, ['rev-parse', '--verify', '-q', 'refs/heads/main'], env);
      const parent = r.code === 0 ? r.stdout.trim() : null;
      const commit = await commitTree(real, env, parent, files);
      if (commit === parent) return commit;
      const u = await gitEnv(real, ['update-ref', 'refs/heads/main', commit, parent ?? ZERO], env);
      if (u.code === 0) return commit;
      if (attempt >= 5) throw new Error(`git update-ref failed: ${u.stderr.trim()}`);
    }
  });
  return { sha, leftOut };
}

/** A real repo's working tree (uncommitted and untracked work included) as a commit on HEAD, touching no ref or real index. */
export async function snapshotDirty(top: string): Promise<string> {
  const gitDirPath = resolve(top, await must(top, ['rev-parse', '--git-dir']));
  const head = await must(top, ['rev-parse', '--verify', 'HEAD^{commit}']);
  // a clean repo is the common case: skip the throwaway index
  if (!(await must(top, ['status', '--porcelain']))) return head;
  return withFolder(gitDirPath, top, async (env) => {
    // GIT_DIR stays the repo's own: worktrees and submodules keep their .git file
    await out(top, env, ['read-tree', head]);
    return commitTree(top, env, head, undefined, DIRTY_MESSAGE);
  });
}

/** The repo's top, or a plain folder's history after a snapshot of it. */
export async function gitRoot(repo: string, home: string): Promise<string> {
  if (insideGit(repo)) return gitTop(repo);
  await snapshotFolder(home, repo);
  return historyDir(home, repo);
}

/** Link files the history leaves out (dependencies, big files, nested repos) into a run's worktree so the project still works there. */
export function linkLeftOut(workdir: string, folder: string, leftOut: string[]): void {
  for (const p of leftOut) {
    mkdirSync(dirname(join(workdir, p)), { recursive: true });
    symlinkSync(join(folder, p), join(workdir, p));
  }
}

/**
 * What may be pushed for a run in a real repo. A run started on uncommitted work descends from a snapshot of it, which must not
 * reach the remote: replay the run's own commits on the snapshot's parent as `<branch>-pr`. The run's branch is never rewritten.
 */
export async function shippable(top: string, home: string, runId: string, branch: string, base: string): Promise<{ branch: string; base: string } | { error: string }> {
  if ((await git(top, ['log', '-1', '--format=%s', base])).stdout.trim() !== DIRTY_MESSAGE) return { branch, base };
  const parent = await must(top, ['rev-parse', `${base}^`]);
  const pr = `aorch/${runId}-pr`;
  const dir = join(home, 'worktrees', `${runId}-pr`);
  const drop = async () => {
    await git(top, ['worktree', 'remove', '--force', dir]);
    await git(top, ['worktree', 'prune']);
    await git(top, ['branch', '-D', pr]);
  };
  await drop();
  await must(top, ['worktree', 'add', '-b', pr, dir, parent]);
  const count = Number((await must(top, ['rev-list', '--count', `${base}..${branch}`])));
  const pick = count ? await git(dir, ['cherry-pick', '--allow-empty', `${base}..${branch}`]) : { code: 0 };
  if (pick.code !== 0) {
    await git(dir, ['cherry-pick', '--abort']);
    await drop();
    return { error: "This work depends on changes you haven't committed. Commit them first, then ship again." };
  }
  await git(top, ['worktree', 'remove', '--force', dir]);
  return { branch: pr, base: parent };
}
