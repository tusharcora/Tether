import { lstatSync, mkdirSync, writeFileSync, type Stats } from 'node:fs';
import { fold, historyDir, insideGit, isHistory, linkLeftOut, MAX_FILE_BYTES, MAX_FOLDER_FILES, NOT_LANDED, snapshotDirty, snapshotFolder, workFiles, type NotLanded } from './history.js';
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

/** NUL-separated `git` output, untrimmed: a name may start with a space. */
async function zList(workdir: string, args: string[]): Promise<string[]> {
  const r = await git(workdir, args);
  if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim()}`);
  return r.stdout.split('\0').filter(Boolean);
}

/** `path -> blob` from `ls-tree` or `ls-files -s` lines. */
const entries = (lines: string[], blobAt: number) => new Map(lines.map((l) => [l.slice(l.indexOf('\t') + 1), l.slice(0, l.indexOf('\t')).split(' ')[blobAt]!] as const));

/** Which of `paths` the folder's .gitignore names, tracked or not. */
async function ignored(workdir: string, paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  const r = await gitEnv(workdir, ['check-ignore', '--no-index', '-z', '--stdin'], {}, paths.map((p) => './' + p).join('\0') + '\0');
  if (r.code > 1) throw new Error(`git check-ignore failed: ${r.stderr.trim()}`);
  // './' keeps a name like ':(x)y' from being read as a pathspec
  return r.stdout.split('\0').filter(Boolean).map((p) => p.replace(/^\.\//, ''));
}

/**
 * Stage a plain folder run's files as its disk has them. `add -A` does the bulk; then, as the folder's snapshot does, what it
 * missed is added by force (files the folder's .gitignore names, and a case or Unicode-form rename git's case guess hides), and
 * what the disk no longer spells that way is dropped. The step's changes under ignored paths land whole, or, when one is too
 * big or they are too many, not at all: the files there keep their base entries, and the folders are named. Elsewhere a file
 * too big stays out, and a file the step removed stays as it was when a left-out file could be where it went, so the limits
 * never take a person's file away. What stays out is recorded with the left-out names the run made, for landing to say.
 */
async function stageAll(workdir: string, gitDir: string, exclude: string[]): Promise<void> {
  // the step's base, read before `add -A` drops what is gone from disk
  const base = entries(await zList(workdir, ['ls-tree', '-r', '-z', 'HEAD']), 2);
  await must(workdir, ['add', '-A', ...specs(exclude)]);
  const outside = (p: string) => exclude.some((e) => p === e.replace(/\/$/, '') || p.startsWith(e.replace(/\/$/, '') + '/'));
  const { files, made } = workFiles(workdir);
  const idx = entries(await zList(workdir, ['ls-files', '-s', '-z']), 1);
  const on = new Set(files);
  const gone = [...base.keys()].filter((p) => !on.has(p) && !outside(p));
  const forced = files.filter((p) => !idx.has(p) && !outside(p));
  // one lstat per path: each pass below asks again, and a hundred thousand build files make that the slow part
  const stats = new Map<string, Stats | undefined>();
  const stat = (p: string) => (stats.has(p) ? stats : stats.set(p, lstatSync(join(workdir, p), { throwIfNoEntry: false }))).get(p);
  // new or changed by the step: what the size limit applies to
  const changed = new Set([...forced, ...files.filter((p) => idx.has(p) && idx.get(p) !== base.get(p))]);
  // a project inside, under an ignored path, is skipped as `add -A` skips it; a file deleted since the walk is just gone
  const nested = forced.filter((p) => stat(p)?.isDirectory());
  const tooBig = [...changed].filter((p) => !stat(p)?.isDirectory() && (stat(p)?.size ?? 0) > MAX_FILE_BYTES);
  const out = new Set([...nested, ...tooBig]);
  let extra = forced.filter((p) => !out.has(p) && stat(p));
  const over = base.size - gone.length + extra.length > MAX_FOLDER_FILES;
  // the step's changes under ignored paths, with their folders, so each is named by the top one the folder ignores
  const up = (p: string) => p.split('/').map((_, i, d) => d.slice(0, i + 1).join('/'));
  const touched = [...changed, ...gone];
  const ign = new Set(await ignored(workdir, [...new Set(touched.flatMap(up))]));
  // one too big there, or too many in all: none of them lands, and what the step started with under them stays as it was
  const held = over || tooBig.some((p) => ign.has(p)) ? touched.filter((p) => ign.has(p)) : [];
  const heldSet = new Set(held);
  if (held.length) extra = extra.filter((p) => !ign.has(p));
  // elsewhere, a file the step removed stays as it was when a left-out file could be where it went: the same size, or the same name in another case or
  // form; unless its re-spelling goes in, which is the one move that is certain
  const leftOut = [...out, ...held.filter((p) => on.has(p))];
  const name = (p: string) => fold(p.slice(p.lastIndexOf('/') + 1));
  const leftSizes = new Set(leftOut.filter((p) => stat(p)?.isFile()).map((p) => stat(p)!.size));
  const leftNames = new Set(leftOut.map(name));
  const going = new Set([...changed].filter((p) => !heldSet.has(p) && !out.has(p)).map(fold));
  const unsure = gone.filter((g) => !heldSet.has(g) && !going.has(fold(g)) && leftOut.length);
  const sized = unsure.length ? await gitEnv(workdir, ['cat-file', '--batch-check=%(objectsize)'], {}, unsure.map((g) => base.get(g)).join('\n') + '\n') : { code: 0, stdout: '', stderr: '' };
  if (sized.code !== 0) throw new Error(`git cat-file failed: ${sized.stderr.trim()}`);
  const sizes = sized.stdout.split('\n').map(Number);
  const stays = unsure.filter((g, i) => (sizes[i]! > 0 && leftSizes.has(sizes[i]!)) || leftNames.has(name(g)));
  const staying = new Set(stays);
  const leaves = gone.filter((g) => !heldSet.has(g) && !staying.has(g));
  // what `add -A` took that stays out: new ones come out, changed ones go back to how the step began
  const drop = [...leaves, ...[...held, ...tooBig].filter((p) => idx.has(p) && !base.has(p))];
  const restore = [...held.filter((p) => base.has(p)), ...stays, ...tooBig.filter((p) => base.has(p) && !heldSet.has(p))];
  const tooMuch = [...new Set([...held.map((p) => up(p).find((a) => ign.has(a))!), ...tooBig.filter((p) => !ign.has(p))])].sort();
  // exact paths, not pathspecs: matching a long pathspec list is slow. Removals first, so a renamed name is added fresh
  const update = async (flag: string, list: string[]) => {
    if (!list.length) return;
    const r = await gitEnv(workdir, ['update-index', '-z', flag, '--stdin'], {}, list.join('\0') + '\0');
    if (r.code !== 0) throw new Error(`git update-index failed: ${r.stderr.trim()}`);
  };
  await update('--force-remove', drop);
  // back as the step began: where case is ignored, `add -A` may have read a new spelling's content into an old one
  if (restore.length) {
    const r = await gitEnv(workdir, ['reset', '-q', 'HEAD', '--pathspec-from-file=-', '--pathspec-file-nul'], { GIT_LITERAL_PATHSPECS: '1' }, restore.join('\0'));
    if (r.code !== 0) throw new Error(`git reset failed: ${r.stderr.trim()}`);
  }
  await update('--add', extra);
  const left: NotLanded = { made, tooMuch, nested, kept: stays };
  writeFileSync(join(gitDir, NOT_LANDED), JSON.stringify(left));
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
