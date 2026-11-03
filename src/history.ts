import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { git, gitEnv, gitTop, isAncestor, must } from './git.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FOLDER_FILES = 100_000;
const SKIP_NAMES = ['node_modules', '.venv', 'venv', '__pycache__', '.DS_Store'];

// shortcut: history grows without pruning, add a sweep (git gc, old refs) when a folder's history passes a size people notice

/** Marks a commit that holds a person's uncommitted work, so shipping can tell it from real history. */
export const DIRTY_MESSAGE = 'tether: uncommitted work';

export { NOTHING_TO_LAND } from './runLabels.js';
const REWRITTEN = "This run's history was changed, so it can't be shipped safely. Nothing was pushed.";
const UNREADABLE = "Could not read this run's history, so nothing was shipped.";

export class FolderRefused extends Error {}

/** Runs being put in their folder right now, however many landings at once: a rewind would pull the work out from under them. */
const landings = new Map<string, number>();
export const isLanding = (runId: string): boolean => landings.has(runId);
export async function whileLanding<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  landings.set(runId, (landings.get(runId) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const left = landings.get(runId)! - 1;
    if (left) landings.set(runId, left);
    else landings.delete(runId);
  }
}

export interface Snapshot {
  sha: string;
  leftOut: string[];
}

/** Work put into a folder: the snapshots either side of it and the files it covered, which is what undo needs. */
export interface Landed {
  pre: string;
  post: string;
  files: string[];
  /** Files the landing deleted whose permissions git can't bring back, as it records only the exec bit. */
  modes?: Record<string, number>;
}

/** `p` with its symlinks resolved, or just absolute when it can't be read. Native: only that gives the disk's own case, so a case-only spelling is one folder. */
export function realOr(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
}

/**
 * True when `dir` or a parent holds `.git` (a folder, or a file for worktrees and submodules). One at the home folder or `/` doesn't
 * count: a dotfiles repo doesn't make every folder under it a project, and treating one as such would snapshot the whole home.
 */
export function insideGit(dir: string): boolean {
  const home = realOr(homedir());
  for (let d = realOr(dir); dirname(d) !== d; d = dirname(d)) {
    if (d !== home && existsSync(join(d, '.git'))) return true;
  }
  return false;
}

const folderId = (folder: string): string => createHash('sha256').update(realpathSync(folder)).digest('hex').slice(0, 16);

export function historyDir(home: string, folder: string): string {
  return join(home, 'history', `${folderId(folder)}.git`);
}

/** Where Tether keeps a plain folder's own files (chat artifacts, saved prompts), so the folder gets none. */
export function folderState(home: string, root: string): string {
  return join(home, 'folders', folderId(root));
}

/** Refuse before walking: these would scan the whole disk or Tether's own state. */
function refuse(home: string, real: string): void {
  if (real === '/' || real === realOr(homedir())) {
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

/**
 * A plain folder run's files, as its disk spells them, so a case or Unicode-form rename is seen and a .gitignore hides nothing.
 * Links to what the folder left out are skipped. `made`: left-out names the run made itself, which never land.
 */
export function workFiles(root: string): { files: string[]; made: string[] } {
  const files: string[] = [];
  const made: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const p = join(dir, e.name);
      if (r === '.git') continue;
      if (SKIP_NAMES.includes(e.name)) {
        if (e.name !== '.DS_Store' && !e.isSymbolicLink()) made.push(r);
        continue;
      }
      // how linkLeftOut makes them: an absolute link to the same path in the folder
      if (e.isSymbolicLink()) {
        const to = readlinkSync(p);
        if (to.startsWith('/') && to.endsWith(`/${r}`)) continue;
      }
      // a project inside stays one entry, as `add -A` keeps it, so landing can refuse it by name
      if (e.isDirectory() && !existsSync(join(p, '.git'))) walk(p, r);
      else files.push(r);
    }
  };
  walk(root, '');
  return { files, made };
}

/** In a plain folder run's own git dir: what its last step left out of the work, as JSON. */
export const NOT_LANDED = 'tether-not-landed';

/** What a step left out: left-out names it made (dependencies, caches), ignored files too big or too many to keep, and projects inside. */
export interface NotLanded {
  made: string[];
  tooMuch: string[];
  nested: string[];
}

/** True when `common` is a plain folder's hidden history: where historyDir puts one, set up by keepExact. Real repos never look like this. */
export function isHistory(common: string): boolean {
  if (!/[\\/]history[\\/][0-9a-f]{16}\.git$/.test(common)) return false;
  try {
    return readFileSync(join(common, 'info', 'attributes'), 'utf8') === EXACT;
  } catch {
    return false;
  }
}

/** What a plain folder run's last step left out of its work, or nothing. */
export async function notLanded(workdir: string): Promise<NotLanded> {
  try {
    return JSON.parse(readFileSync(join(await must(workdir, ['rev-parse', '--absolute-git-dir']), NOT_LANDED), 'utf8')) as NotLanded;
  } catch {
    return { made: [], tooMuch: [], nested: [] };
  }
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

const EXACT = '* -text -filter -ident -eol -working-tree-encoding\n';

/** Store a folder's names and bytes untouched. Without this a folder's .gitattributes rewrites line endings, and undo restores the altered bytes. */
async function keepExact(history: string): Promise<void> {
  // macOS sets precompose on, then `add` from stdin silently drops decomposed names (é as e + accent)
  await must(history, ['config', 'core.precomposeunicode', 'false']);
  await must(history, ['config', 'core.autocrlf', 'false']);
  mkdirSync(join(history, 'info'), { recursive: true });
  // written last: its presence means this history is done
  writeFileSync(join(history, 'info', 'attributes'), EXACT);
}

/** Commit the folder's current files into its hidden history. Nothing is written inside the folder. */
export async function snapshotFolder(home: string, folder: string, limits: { maxFiles?: number } = {}): Promise<Snapshot> {
  const real = realpathSync(folder);
  refuse(home, real);
  const { files, leftOut } = survey(real, limits.maxFiles ?? MAX_FOLDER_FILES);
  const history = historyDir(home, real);
  if (!existsSync(join(history, 'HEAD'))) {
    mkdirSync(dirname(history), { recursive: true });
    // made beside its place and renamed in: overlapping first snapshots of a folder would otherwise trip over a half-made history
    const fresh = `${history}.${randomBytes(4).toString('hex')}`;
    await must(dirname(history), ['init', '-q', '--bare', '-b', 'main', fresh]);
    await keepExact(fresh);
    try {
      renameSync(fresh, history);
    } catch {
      rmSync(fresh, { recursive: true, force: true });
    }
  } else if (!existsSync(join(history, 'info', 'attributes'))) {
    await keepExact(history);
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

/** The folder, resolved, or a plain error: `realpathSync` would put the path in its message. */
function here(folder: string): string {
  if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new Error('This folder is no longer there, so nothing was changed.');
  return realpathSync(folder);
}

/** A NUL-separated list from git. Not `out`: its trim would eat a name's leading space. A commit it can't find means the history is not this folder's any more. */
async function listed(history: string, args: string[]): Promise<string[]> {
  const r = await git(history, args);
  if (r.code !== 0) throw new Error("Tether's undo history for this folder is gone, so nothing was changed.", { cause: new Error(`git ${args[0]} failed: ${r.stderr.trim()}`) });
  // gitEnv keeps only the tail past this size: a shortened list could hide a conflict
  if (r.stdout.length >= 20_000_000) throw new Error('Too many files changed at once to do this safely.');
  return r.stdout.split('\0').filter(Boolean);
}

/** Paths that differ between two commits. */
const changed = (history: string, from: string, to: string) => listed(history, ['diff', '--no-renames', '--name-only', '-z', from, to]);

/** One spelling for all the names APFS treats as one file (see `clashes`). */
export const fold = (p: string) => p.normalize('NFC').toLowerCase().toUpperCase().toLowerCase().normalize('NFC');

/** The `others` that sit on, above or below one of `paths`. Above and below count: git replaces a file or folder in a landed path's way. */
function clashes(paths: string[], others: string[]): string[] {
  // APFS treats many spellings as one file: each step catches some (ẞ, ß, ς, ﬁ, accented Greek capitals). Swept against APFS for every code point to U+31FFF with no miss; elsewhere this only stops more often.
  const lineage = (p: string) => fold(p).split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'));
  const exact = new Set(paths.map(fold));
  const within = new Set(paths.flatMap(lineage));
  return [...new Set(others)].filter((o) => within.has(fold(o)) || lineage(o).some((a) => exact.has(a)));
}

/** Remove one file and any folders that leaves empty, refusing a path that resolves outside `real`. */
function removeFile(real: string, rel: string): void {
  const dir = dirname(join(real, rel));
  if (!existsSync(dir)) return;
  const parent = realpathSync(dir);
  if (parent !== real && !parent.startsWith(real + sep)) throw new Error(`${rel} is outside this folder.`);
  rmSync(join(parent, basename(rel)), { force: true });
  for (let d = parent; d !== real; d = dirname(d)) {
    try {
      rmdirSync(d);
    } catch {
      return;
    }
  }
}

/** Give a file git just wrote its old permissions back. Git records only the exec bit, so that alone comes from what was written. */
function keepMode(path: string, before: number): void {
  const after = lstatSync(path, { throwIfNoEntry: false });
  if (!after?.isFile()) return;
  const plain = before & 0o666;
  chmodSync(path, plain | (after.mode & 0o100 ? before & 0o111 || (plain & 0o444) >> 2 : 0));
}

/** Mode of the regular file at `path`: nothing for a folder, a link, or a path that can't be reached, as under a file. */
function fileMode(path: string): number | undefined {
  try {
    const s = lstatSync(path);
    return s.isFile() ? s.mode : undefined;
  } catch {
    return undefined;
  }
}

/** Permissions of the regular files among `files` that aren't git's own 0644 or 0755. */
function unusualModes(real: string, files: string[]): Record<string, number> {
  return Object.fromEntries(
    files.flatMap((p): [string, number][] => {
      try {
        const s = lstatSync(join(real, p));
        const mode = s.mode & 0o777;
        return s.isFile() && mode !== 0o644 && mode !== 0o755 ? [[p, mode]] : [];
      } catch {
        return [];
      }
    }),
  );
}

/** Set `modes` on the regular files they name. Returns the ones that could not be set, as a thrown path would carry the folder's. */
function setModes(real: string, modes: Record<string, number>): string[] {
  return Object.entries(modes).flatMap(([p, mode]) => {
    try {
      if (lstatSync(join(real, p)).isFile()) chmodSync(join(real, p), mode);
      return [];
    } catch {
      return [p];
    }
  });
}

/** Make `files` in the folder match commit `to`: what it holds is written, what it doesn't is removed. Tries every file before reporting a failure, so a put-back does all it can. */
async function matchFiles(history: string, real: string, since: string, to: string, files: string[]): Promise<void> {
  const [before, after] = await Promise.all([blobs(history, since), blobs(history, to)]);
  const held = new Set(after.keys());
  const present = files.filter((p) => held.has(p));
  // shortcut: a file keeps a mode only from the same content or a rename git can see, so these come out at their own or git's mode: one rewritten past about half under a new name, an edited swap of two similar files, a private file two runs each moved, and past the cap any rename that isn't exact; upgrade if a run's private files ever need more
  // from `since`, not the folder, and only among `files`, so a person's own files lend no mode; -B finds a rename onto a file that stays, or off one a new file then took the name of (git calls that a copy), but never for a file under 400 bytes, so the same content is matched by blob below; -l2000 outranks git config, and caps a quadratic search that runs with the folder at risk of a person's save
  const moved = await listed(history, ['diff-tree', '-r', '-z', '-B', '-M', '-l2000', '--diff-filter=RC', '--name-status', since, to]);
  const touched = new Set(files);
  const was = new Map(moved.flatMap((_, i): [string, string][] => (i % 3 === 0 && touched.has(moved[i + 1]!) ? [[moved[i + 2]!, moved[i + 1]!]] : [])));
  // read before removals: old content's path may be gone after them. One entry per blob, not per path, so many files with the same content stay cheap
  const heldBy = new Map<string, number>();
  for (const p of files) {
    const blob = before.get(p);
    const mode = fileMode(join(real, p));
    if (blob !== undefined && mode !== undefined) heldBy.set(blob, (heldBy.get(blob) ?? 0o777) & mode);
  }
  // everything this file's content or name had takes part, so an ambiguous match lands the narrowest; where the filesystem ignores case its two names can be one file
  const modes = present.flatMap((p): [string, number][] => {
    const own = fileMode(join(real, p));
    const seen = [own, heldBy.get(after.get(p)!), fileMode(join(real, was.get(p) ?? p))].filter((m) => m !== undefined);
    if (!seen.length) return [];
    const mode = seen.reduce((a, b) => a & b);
    return [[p, own === undefined ? mode & 0o755 : mode]]; // a new name drops group and world write, so a similar scratch file can't hand it those
  });
  let failure: unknown;
  // removals first: a case-only rename or a file swapped for a folder needs the old path gone before the new one is written
  for (const f of files.filter((p) => !held.has(p))) {
    try {
      removeFile(real, f);
    } catch (e) {
      failure ??= e;
    }
  }
  if (present.length) {
    await withFolder(history, real, async (env) => {
      await out(real, env, ['read-tree', to]);
      // no hooks: a global core.hooksPath must not run inside a person's folder
      const r = await gitEnv(real, ['-c', 'core.hooksPath=/dev/null', 'checkout', to, '--pathspec-from-file=-', '--pathspec-file-nul'], { ...env, GIT_LITERAL_PATHSPECS: '1' }, present.join('\0'));
      if (r.code !== 0) failure ??= new Error(`git checkout failed: ${r.stderr.trim()}`);
    });
    // after a failed checkout too: a private file it did rewrite must not stay wider than it was
    for (const [p, mode] of modes) {
      try {
        keepMode(join(real, p), mode);
      } catch (e) {
        failure ??= e;
      }
    }
  }
  if (failure) throw failure;
}

/**
 * Take `files` from `from` to `to`, give `modes` back, and return a snapshot of the result. `since`: the commit the renames to `to` are read from.
 * On failure put them back and throw, saying what could not be.
 */
async function move(home: string, real: string, from: string, to: string, files: string[], since: string, modes: Record<string, number> = {}): Promise<string> {
  const history = historyDir(home, real);
  // a put-back recreates what this removes, and only this remembers how private it was
  const before = unusualModes(real, files);
  try {
    await matchFiles(history, real, since, to, files);
    const unset = setModes(real, modes);
    if (unset.length) throw new Error(`Could not set permissions on: ${unset.join(', ')}`);
    return (await snapshotFolder(home, real)).sha;
  } catch (cause) {
    let left: string[];
    try {
      // checkout reports a file it could not rewrite even if that file never changed: judge by what is there now
      await matchFiles(history, real, to, from, files).catch(() => {});
      const unset = setModes(real, before);
      const check = await snapshotFolder(home, real);
      left = [...new Set([...clashes(files, [...(await changed(history, from, check.sha)), ...check.leftOut]), ...unset])];
    } catch {
      throw new Error('This stopped part way and Tether could not check your folder. Some files may have changed.', { cause });
    }
    throw new Error(left.length ? `This stopped part way, and these files could not be put back: ${left.join(', ')}` : 'This could not be finished, so your folder was put back as it was.', { cause });
  }
}

/**
 * Put a run's work into the folder, or name the files a person changed in the meantime and change nothing.
 * `base`: where the work to land starts, when a run it came from is in the folder already; only what changed since it is touched.
 */
export async function landBranch(home: string, folder: string, head: string, base?: string): Promise<Landed | { conflicts: string[] }> {
  const real = here(folder);
  const pre = await snapshotFolder(home, real);
  const history = historyDir(home, real);
  // from the snapshot the work grew from, its last commit on main: a fork starts on its parent's commit, which the folder may never have held
  // merge-base with `base` too: a fork of a fork from a step they share doesn't descend from it, and the parent's later steps aren't this work
  const root = (await listed(history, ['merge-base', head, base ?? 'refs/heads/main']))[0]!.trim();
  // a file already as the work has it needs nothing, and isn't a clash: a fork of landed work carries its parent's files
  const differ = new Set(await changed(history, pre.sha, head));
  const files = (await changed(history, root, head)).filter((p) => differ.has(p));
  // a project the run made inside its work is stored as a bare pointer: it would land as an empty folder
  const tree = await listed(history, ['ls-tree', '-r', '-z', head]);
  const inner = tree.filter((e) => e.startsWith('160000 ')).map((e) => e.slice(e.indexOf('\t') + 1)).filter((p) => files.includes(p));
  if (inner.length) throw new Error(`The work made a separate project in ${inner.map((p) => `"${p}"`).join(', ')}, which can't be brought into your folder yet, so nothing was changed.`);
  // left-out files are in no snapshot, so a diff can't see them: they count as the person's
  const conflicts = clashes(files, [...(await changed(history, root, pre.sha)), ...pre.leftOut]);
  if (conflicts.length) return { conflicts };
  // regular entries only: git brings a file the work swapped for a symlink back without its permissions, as it does a deleted one
  const held = new Set(tree.filter((e) => e.startsWith('100')).map((e) => e.slice(e.indexOf('\t') + 1)));
  const modes = unusualModes(real, files.filter((p) => !held.has(p)));
  const post = await move(home, real, pre.sha, head, files, root);
  return { pre: pre.sha, post, files, ...(Object.keys(modes).length ? { modes } : {}) };
}

/** Take landed work back out, or name the landed files that changed since and change nothing. Other files are left alone. */
export async function undoLanding(home: string, folder: string, l: Landed): Promise<true | { conflicts: string[] }> {
  const real = here(folder);
  const now = await snapshotFolder(home, real);
  // a landed file now too big for the history can't be compared, so it can't be called unchanged
  const conflicts = clashes(l.files, [...(await changed(historyDir(home, real), l.post, now.sha)), ...now.leftOut]);
  if (conflicts.length) return { conflicts };
  await move(home, real, now.sha, l.pre, l.files, l.post, l.modes);
  return true;
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

/** The blob at each path of `commit`. */
async function blobs(top: string, commit: string): Promise<Map<string, string>> {
  const entries = await listed(top, ['ls-tree', '-r', '-z', commit]);
  return new Map(entries.map((e) => [e.slice(e.indexOf('\t') + 1), e.slice(0, e.indexOf('\t')).split(' ')[2]!]));
}

/** `pushed` holds a file as the snapshot `dirty` added or changed it. A replay can bring one back: one commit took it out, a later one put it back. */
async function holdsUncommitted(top: string, dirty: string, pushed: string): Promise<boolean> {
  const [had, wip, out] = await Promise.all([blobs(top, `${dirty}^`), blobs(top, dirty), blobs(top, pushed)]);
  return [...wip].some(([p, b]) => b !== had.get(p) && b === out.get(p));
}

/**
 * What may be pushed for a run in a real repo. A run that descends from a snapshot of uncommitted work, by starting on one or by
 * forking from a run that did, must not take it to the remote: replay what came after on the snapshot's parent as `<branch>-pr`.
 * A fork's PR so carries its parent run's commits too. The run's branch is never rewritten. `dirty` is the snapshot recorded on the
 * run: an agent can rewrite a commit's message, so the scan by message below is all there is only for a branch with none recorded.
 */
export async function shippable(top: string, home: string, runId: string, branch: string, base: string, recorded?: string): Promise<{ branch: string; base: string } | { error: string }> {
  if (recorded && !(await isAncestor(top, recorded, branch))) return { error: REWRITTEN };
  const found = await git(top, ['log', '--topo-order', '--format=%H %s', '--fixed-strings', `--grep=${DIRTY_MESSAGE}`, branch]);
  if (found.code !== 0) return { error: UNREADABLE };
  // every match, not the newest: a commit quoting the words can sit above a snapshot, and a branch taken from a run's checkout can hold two
  const dirty = found.stdout.split('\n').filter((l) => l.slice(l.indexOf(' ') + 1) === DIRTY_MESSAGE).map((l) => l.slice(0, l.indexOf(' ')));
  const first = dirty.at(-1);
  if (!first) return { branch, base };
  const parent = await must(top, ['rev-parse', `${first}^`]);
  const pr = `aorch/${runId}-pr`;
  const dir = join(home, 'worktrees', `${runId}-pr`);
  const drop = async () => {
    await git(top, ['worktree', 'remove', '--force', dir]);
    await git(top, ['worktree', 'prune']);
    await git(top, ['branch', '-D', pr]);
  };
  await drop();
  await must(top, ['worktree', 'add', '-b', pr, dir, parent]);
  const picks = (await must(top, ['rev-list', '--reverse', '--topo-order', `${first}..${branch}`])).split('\n').filter((c) => c && !dirty.includes(c));
  const pick = picks.length ? await git(dir, ['cherry-pick', '--allow-empty', ...picks]) : { code: 0 };
  if (pick.code !== 0) {
    await git(dir, ['cherry-pick', '--abort']);
    await drop();
    return { error: "This work depends on changes you haven't committed. Commit them first, then ship again." };
  }
  if (recorded) {
    const back = await holdsUncommitted(top, recorded, pr).catch(() => undefined);
    if (back !== false) {
      await drop();
      return { error: back ? REWRITTEN : UNREADABLE };
    }
  }
  await git(top, ['worktree', 'remove', '--force', dir]);
  return { branch: pr, base: parent };
}
