import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { historyDir, insideGit, isHistory, linkLeftOut, MAX_FILE_BYTES, MAX_FOLDER_FILES, NOT_LANDED, snapshotDirty, snapshotFolder, workFiles } from './history.js';
import { join, resolve } from 'node:path';
import { runProcess } from './proc.js';

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'aorch',
  GIT_AUTHOR_EMAIL: 'aorch@localhost',
  GIT_COMMITTER_NAME: 'aorch',
  GIT_COMMITTER_EMAIL: 'aorch@localhost',
};

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** `git` with extra env (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE ...) on top of the default one. */
export async function gitEnv(cwd: string, args: string[], env: Record<string, string>, stdin?: string): Promise<GitResult> {
  const r = await runProcess({ cmd: 'git', args, cwd, env: { ...GIT_ENV, ...env }, stdin, maxBuffer: 20_000_000 });
  if (r.spawnError) throw new Error(`git failed to start: ${r.spawnError}`);
  return { code: r.code ?? 1, stdout: r.stdout, stderr: r.stderr };
}

export function git(cwd: string, args: string[]): Promise<GitResult> {
  return gitEnv(cwd, args, {});
}

export async function must(cwd: string, args: string[]): Promise<string> {
  const r = await git(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout.trim();
}

export interface Worktree {
  workdir: string;
  baseSha: string;
  branch: string;
  /** A plain folder's hidden history: where the branch and worktree live. */
  history?: string;
  leftOut?: string[];
  /** The snapshot it starts on, when that holds a real repo's uncommitted work. */
  dirty?: string;
}

/** The repo's own top, or the repo itself when it is bare (a plain folder's history has no work tree to ask for). */
export async function gitTop(repo: string): Promise<string> {
  const dir = resolve(repo);
  const r = await git(dir, ['rev-parse', '--show-toplevel']);
  if (r.code === 0) return r.stdout.trim();
  // only a bare repo is let through; anything else keeps the error
  return (await must(dir, ['rev-parse', '--is-bare-repository'])) === 'true' ? dir : must(dir, ['rev-parse', '--show-toplevel']);
}

/** Each run gets its own branch + worktree so agents never touch the user's checkout. */
export async function createWorktree(repo: string, home: string, runId: string, ref?: string): Promise<Worktree> {
  let top: string;
  let baseSha: string;
  let plain: { history: string; leftOut: string[] } | undefined;
  let dirty: string | undefined;
  if (insideGit(repo)) {
    top = await gitTop(repo);
    // uncommitted work comes along unless the run starts from a ref
    if (ref && ref !== 'HEAD') baseSha = await must(top, ['rev-parse', '--verify', `${ref}^{commit}`]);
    else {
      baseSha = await snapshotDirty(top);
      if (baseSha !== (await must(top, ['rev-parse', 'HEAD']))) dirty = baseSha;
    }
  } else {
    const snap = await snapshotFolder(home, repo);
    top = historyDir(home, repo);
    baseSha = ref && ref !== 'HEAD' ? await must(top, ['rev-parse', '--verify', `${ref}^{commit}`]) : snap.sha;
    plain = { history: top, leftOut: snap.leftOut };
  }
  const branch = `aorch/${runId}`;
  const workdir = join(home, 'worktrees', runId);
  mkdirSync(join(home, 'worktrees'), { recursive: true });
  await must(top, ['worktree', 'add', '-b', branch, workdir, baseSha]);
  if (plain) linkLeftOut(workdir, resolve(repo), plain.leftOut);
  return { workdir, baseSha, branch, ...plain, ...(dirty ? { dirty } : {}) };
}

/**
 * A throwaway clone of `repo` at `dest` that borrows the source's objects (`--shared`) and checks nothing out. Git only reads the
 * source to make it: no ref, branch, worktree or file of the source changes. Evolve probes run inside such a clone.
 */
export async function cloneShared(repo: string, dest: string): Promise<void> {
  const top = await gitTop(repo);
  await must(top, ['clone', '--quiet', '--shared', '--no-checkout', '--', top, dest]);
  // nothing that runs in the clone may push back into the user's repo (or anywhere): no origin, no push target, a pre-push hook that refuses
  await must(dest, ['remote', 'remove', 'origin']);
  await must(dest, ['config', 'push.default', 'nothing']);
  const hooks = join(dest, '.git', 'hooks');
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, 'pre-push'), '#!/bin/sh\necho "aorch: pushing from a probe clone is disabled" >&2\nexit 1\n', { mode: 0o755 });
}

export async function removeWorktree(repo: string, workdir: string): Promise<void> {
  const top = await gitTop(repo);
  await git(top, ['worktree', 'remove', '--force', workdir]);
}

export async function removeBranch(repo: string, branch: string): Promise<void> {
  const top = await gitTop(repo);
  await git(top, ['worktree', 'prune']);
  await git(top, ['branch', '-D', branch]);
}

/** Pathspec that selects the whole tree except `exclude` (e.g. artifacts the setup command produced). */
function specs(exclude: string[] = []): string[] {
  return ['--', '.', ...exclude.map((p) => `:(exclude,literal)${p.replace(/\/$/, '')}`)];
}

/** Raw `git status --porcelain` lines (`XY path`). Untracked directories are reported collapsed. */
export async function statusEntries(workdir: string): Promise<string[]> {
  const r = await git(workdir, ['status', '--porcelain']);
  return r.stdout.split('\n').filter(Boolean);
}

/** Paths from porcelain lines, for use as an exclusion list. */
export function entryPaths(entries: string[]): string[] {
  return entries.map((l) => l.slice(3).replace(/^"|"$/g, '').replace(/.* -> /, ''));
}

/** Undo exactly the given porcelain entries (and nothing else). */
export async function revertEntries(workdir: string, entries: string[]): Promise<void> {
  for (const line of entries) {
    const path = entryPaths([line])[0]!;
    if (line.startsWith('??')) await git(workdir, ['clean', '-fdq', '--', path]);
    else await git(workdir, ['restore', '--source=HEAD', '--staged', '--worktree', '--', path]);
  }
}

/**
 * Stage a plain folder run's files as its disk has them. `add -A` does the bulk; then, as the folder's snapshot does, what it
 * missed is added by force (files the folder's .gitignore names, and a case or Unicode-form rename git's case guess hides), and
 * what the disk no longer spells that way is dropped. Ignored files past the snapshot's limits stay out, and are recorded with
 * the left-out names the run made, so landing can say what it didn't put in the folder.
 */
async function stageAll(workdir: string, gitDir: string, exclude: string[]): Promise<void> {
  await must(workdir, ['add', '-A', ...specs(exclude)]);
  const outside = (p: string) => exclude.some((e) => p === e.replace(/\/$/, '') || p.startsWith(e.replace(/\/$/, '') + '/'));
  const { files, made } = workFiles(workdir);
  const ls = await git(workdir, ['ls-files', '-z']);
  if (ls.code !== 0) throw new Error(`git ls-files failed: ${ls.stderr.trim()}`);
  const had = new Set(ls.stdout.split('\0').filter(Boolean));
  const on = new Set(files);
  const gone = [...had].filter((p) => !on.has(p) && !outside(p));
  let extra = files.filter((p) => !had.has(p) && !outside(p));
  const big = extra.filter((p) => lstatSync(join(workdir, p)).size > MAX_FILE_BYTES);
  extra = extra.filter((p) => !big.includes(p));
  let over: string[] = [];
  if (had.size - gone.length + extra.length > MAX_FOLDER_FILES) {
    // named by the top folder that holds none of the work, as `target`, not each of its files
    const up = (p: string) => p.split('/').map((_, i, d) => d.slice(0, i + 1).join('/'));
    const kept = new Set([...had].filter((p) => on.has(p)).flatMap((p) => up(p).slice(0, -1)));
    over = [...new Set(extra.map((p) => up(p).find((a) => !kept.has(a))!))];
    extra = [];
  }
  // exact paths, not pathspecs: matching a long pathspec list is slow. Removals first, so a renamed name is added fresh
  for (const [flag, list] of [['--force-remove', gone], ['--add', extra]] as const) {
    if (!list.length) continue;
    const r = await gitEnv(workdir, ['update-index', '-z', flag, '--stdin'], {}, list.join('\0') + '\0');
    if (r.code !== 0) throw new Error(`git update-index failed: ${r.stderr.trim()}`);
  }
  writeFileSync(join(gitDir, NOT_LANDED), [...made, ...big, ...over].join('\0'));
}

/** A plain folder run's own git dir, or undefined in a real repo. */
async function plainGitDir(workdir: string): Promise<string | undefined> {
  const [own, common] = (await must(workdir, ['rev-parse', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir'])).split('\n');
  return isHistory(common!) ? own : undefined;
}

/** Commit everything in the worktree except `exclude`. Returns the new sha, or undefined if nothing changed. */
export async function commitAll(workdir: string, message: string, exclude: string[] = []): Promise<string | undefined> {
  const plain = await plainGitDir(workdir);
  if (plain) await stageAll(workdir, plain, exclude);
  else await must(workdir, ['add', '-A', ...specs(exclude)]);
  const quiet = await git(workdir, ['diff', '--cached', '--quiet']);
  if (quiet.code === 0) return undefined;
  await must(workdir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', message]);
  return must(workdir, ['rev-parse', 'HEAD']);
}

export async function headSha(workdir: string): Promise<string> {
  return must(workdir, ['rev-parse', 'HEAD']);
}

/** Unified diff of the worktree (including uncommitted + untracked) against `base`. */
export async function diffAgainst(workdir: string, base: string, exclude: string[] = []): Promise<string> {
  await must(workdir, ['add', '-A', ...specs(exclude)]);
  const r = await git(workdir, ['diff', '--cached', '--no-color', base, ...specs(exclude)]);
  return r.stdout;
}

/** Committed work only (base..HEAD). Read-only: safe to call while agents are running. */
export async function diffCommitted(workdir: string, base: string): Promise<string> {
  const r = await git(workdir, ['diff', '--no-color', base, 'HEAD']);
  return r.stdout;
}

/** Diff introduced by one commit. */
export async function commitDiff(workdir: string, sha: string): Promise<string> {
  const r = await git(workdir, ['show', '--no-color', '--format=', sha]);
  return r.stdout;
}

/** What one commit changed: files, lines added and removed (`git show --shortstat`). */
export async function commitStat(workdir: string, sha: string): Promise<{ files: number; added: number; deleted: number }> {
  return parseShortstat((await git(workdir, ['show', '--shortstat', '--format=', sha])).stdout);
}
export function parseShortstat(out: string): { files: number; added: number; deleted: number } {
  const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(out);
  return { files: Number(m?.[1] ?? 0), added: Number(m?.[2] ?? 0), deleted: Number(m?.[3] ?? 0) };
}

/** Files touched by one commit. */
export async function commitFiles(workdir: string, sha: string): Promise<string[]> {
  const r = await git(workdir, ['show', '--name-only', '--format=', sha]);
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

export async function changedFiles(workdir: string, from: string, to: string): Promise<string[]> {
  const r = await git(workdir, ['diff', '--name-only', from, to]);
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Put the worktree back at `sha`: tracked files reset and untracked ones removed, except `keep` (ignored files stay too). */
export async function resetTo(workdir: string, sha: string, keep: string[] = []): Promise<void> {
  await must(workdir, ['reset', '-q', '--hard', sha]);
  await must(workdir, ['clean', '-fdq', ...specs(keep)]);
}

/** Point `ref` (refs/...) at `sha`, or delete it when `sha` is undefined. */
export async function setRef(workdir: string, ref: string, sha?: string): Promise<void> {
  await must(workdir, sha ? ['update-ref', ref, sha] : ['update-ref', '-d', ref]);
}

/** The refs under `prefix` (e.g. refs/tether/rewind/<run>/). */
export async function refsUnder(workdir: string, prefix: string): Promise<string[]> {
  return (await git(workdir, ['for-each-ref', '--format=%(refname)', prefix])).stdout.split('\n').filter(Boolean);
}

/** `a` is `b` or an ancestor of it (false for an unknown commit). */
export async function isAncestor(workdir: string, a: string, b: string): Promise<boolean> {
  return (await git(workdir, ['merge-base', '--is-ancestor', a, b])).code === 0;
}
