import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { gitEnv, must } from './git.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FOLDER_FILES = 100_000;
const SKIP_NAMES = ['node_modules', '.venv', 'venv', '__pycache__', '.DS_Store'];

// shortcut: history grows without pruning, add a sweep (git gc, old refs) when a folder's history passes a size people notice

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

/** Walk without following symlinks. Returns what the history must skip, as paths relative to `root`. */
function survey(root: string, maxFiles: number): string[] {
  const leftOut: string[] = [];
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
    }
  };
  walk(root, '');
  return leftOut;
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

async function out(cwd: string, env: Record<string, string>, args: string[]): Promise<string> {
  const r = await gitEnv(cwd, args, env);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout.trim();
}

/** Tree of `env`'s index (after `add -A`) as a commit on `parent`, or `parent` itself when the tree is the same. */
async function commitTree(cwd: string, env: Record<string, string>, parent: string | null): Promise<string> {
  await out(cwd, env, ['add', '-A']);
  const tree = await out(cwd, env, ['write-tree']);
  if (parent && (await out(cwd, env, ['rev-parse', `${parent}^{tree}`])) === tree) return parent;
  return out(cwd, env, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', 'snapshot']);
}

/** Commit the folder's current files into its hidden history. Nothing is written inside the folder. */
export async function snapshotFolder(home: string, folder: string, limits: { maxFiles?: number } = {}): Promise<Snapshot> {
  const real = realpathSync(folder);
  refuse(home, real);
  const leftOut = survey(real, limits.maxFiles ?? MAX_FOLDER_FILES);
  const history = historyDir(home, real);
  if (!existsSync(join(history, 'HEAD'))) {
    mkdirSync(dirname(history), { recursive: true });
    await must(dirname(history), ['init', '-q', '--bare', '-b', 'main', history]);
  }
  mkdirSync(join(history, 'info'), { recursive: true });
  writeFileSync(join(history, 'info', 'exclude'), [...SKIP_NAMES, ...leftOut.map(anchored)].join('\n') + '\n');
  const sha = await withFolder(history, real, async (env) => {
    const r = await gitEnv(real, ['rev-parse', '--verify', '-q', 'refs/heads/main'], env);
    const parent = r.code === 0 ? r.stdout.trim() : null;
    const commit = await commitTree(real, env, parent);
    if (commit !== parent) await out(real, env, ['update-ref', 'refs/heads/main', commit]);
    return commit;
  });
  return { sha, leftOut };
}

/** A real repo's working tree (uncommitted and untracked work included) as a commit on HEAD, touching no ref or real index. */
export async function snapshotDirty(top: string): Promise<string> {
  const gitDirPath = resolve(top, await must(top, ['rev-parse', '--git-dir']));
  const head = await must(top, ['rev-parse', '--verify', 'HEAD^{commit}']);
  return withFolder(gitDirPath, top, async (env) => {
    // GIT_DIR stays the repo's own: worktrees and submodules keep their .git file
    await out(top, env, ['read-tree', head]);
    return commitTree(top, env, head);
  });
}
