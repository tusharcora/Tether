/**
 * The Code screen's file access: one path gate for every route (resolveInWorkspace), a lazy tree that follows git, and
 * file reads and atomic saves with their limits. Every path here is relative to a registered project's folder.
 */
import { accessSync, chmodSync, closeSync, constants, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import { git } from './git.js';
import { HttpError } from './serverkit.js';
import type { CodeFile, CodeLang, GitBadge, TreeEntry } from './types.js';

/** Text files up to this size open in the editor; bigger ones get a panel instead. */
export const MAX_TEXT = 2 * 1024 * 1024;
/** A NUL byte in this much of the start marks a file as binary. */
const SNIFF = 8192;
export const looksBinary = (buf: Buffer): boolean => buf.subarray(0, SNIFF).includes(0);

const within = (p: string, base: string) => p === base || p.startsWith(base.endsWith(sep) ? base : base + sep);
/** The real path of `p`, or, when it does not exist (yet), its nearest existing parent's real path plus the rest. */
function realOf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    const parent = dirname(p);
    return parent === p ? p : join(realOf(parent), basename(p));
  }
}

/**
 * The one gate for paths sent to /api/code/*: resolve against the project folder, follow symlinks, and refuse a NUL
 * byte, an absolute path, any `..` (400), anything inside a .git folder or anything a symlink leads outside the project
 * (403). Returns the real path and the clean project-relative path ('' is the folder itself).
 */
export function resolveInWorkspace(root: string, rel: string): { abs: string; rel: string } {
  if (typeof rel !== 'string') throw new HttpError(400, 'the path must be text');
  if (rel.includes('\0')) throw new HttpError(400, 'the path holds a NUL byte');
  if (isAbsolute(rel)) throw new HttpError(400, 'the path must be relative to the project folder');
  const parts = rel.split('/').filter((s) => s && s !== '.');
  if (parts.includes('..')) throw new HttpError(400, 'the path leaves the project folder');
  if (parts.includes('.git')) throw new HttpError(403, 'files inside .git are not shown');
  const base = realpathSync(root);
  const abs = realOf(join(base, ...parts));
  if (!within(abs, base)) throw new HttpError(403, 'the path leads outside the project folder');
  const clean = relative(base, abs).split(sep).join('/');
  if (clean.split('/').includes('.git')) throw new HttpError(403, 'files inside .git are not shown');
  return { abs, rel: clean };
}

const SECRET = [/^\.env(\..*)?$/, /\.pem$/i, /\.key$/i, /^id_/];
/** Secrets files open read-only, are left out of search and never go into an agent's prompt. */
export const isSecretPath = (rel: string): boolean => SECRET.some((re) => re.test(rel.split('/').pop() ?? ''));

const LANG: Record<string, CodeLang> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'jsx',
  '.json': 'json', '.jsonc': 'json', '.md': 'markdown', '.markdown': 'markdown',
  '.css': 'css', '.scss': 'css', '.less': 'css', '.html': 'html', '.htm': 'html', '.py': 'python',
};
export const langOf = (rel: string): CodeLang => LANG[extname(rel).toLowerCase()] ?? 'text';

/** Whether the folder is in a git work tree, and where it sits under the repo's top ('' or 'sub/dir/'). */
export async function gitInfo(root: string): Promise<{ git: boolean; prefix: string }> {
  const r = await git(root, ['rev-parse', '--show-prefix']).catch(() => undefined);
  return r?.code === 0 ? { git: true, prefix: r.stdout.trim() } : { git: false, prefix: '' };
}

/** Files git shows under `dir` (tracked, plus untracked that are not ignored), relative to the project folder. */
export async function gitFiles(root: string, dir = ''): Promise<string[]> {
  const r = await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', dir || '.']);
  return [...new Set(r.stdout.split('\0').filter(Boolean))];
}

const badgeOf = (xy: string): GitBadge | undefined =>
  xy === '??' ? '?' : xy.includes('D') ? 'D' : xy[0] === 'A' ? 'A' : xy[0] === 'R' || xy[0] === 'C' ? 'R' : /[MTU]/.test(xy) ? 'M' : undefined;

/** `git status` badges under `dir`, keyed by project-relative path (porcelain paths are relative to the repo top). */
async function gitBadges(root: string, prefix: string, dir: string): Promise<Map<string, GitBadge>> {
  const r = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', dir || '.']);
  const out = new Map<string, GitBadge>();
  const parts = r.stdout.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]!;
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // the next field is the old path
    const b = badgeOf(xy);
    const path = line.slice(3);
    if (b && path.startsWith(prefix)) out.set(path.slice(prefix.length), b);
  }
  return out;
}

const byKindThenName = (a: TreeEntry, b: TreeEntry) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1);

/**
 * One level of the tree under `dir`, folders first. In a git repo it is what git shows (ignored files stay hidden, deleted
 * tracked files stay listed with a D) with status badges; elsewhere the folder's own listing. `.git` never appears.
 * `files` (the project's file count) comes with the top level of a git project.
 */
export async function listDir(root: string, dir: string): Promise<{ entries: TreeEntry[]; git: boolean; files?: number }> {
  const at = resolveInWorkspace(root, dir);
  let st;
  try {
    st = statSync(at.abs);
  } catch {
    throw new HttpError(404, `no folder ${at.rel || '.'}`);
  }
  if (!st.isDirectory()) throw new HttpError(400, `${at.rel} is not a folder`);
  const g = await gitInfo(root);
  const under = at.rel ? `${at.rel}/` : '';
  if (!g.git) {
    const entries = readdirSync(at.abs, { withFileTypes: true })
      .filter((d) => d.name !== '.git')
      .flatMap((d): TreeEntry[] => {
        try {
          return [{ name: d.name, path: under + d.name, kind: statSync(join(at.abs, d.name)).isDirectory() ? 'dir' : 'file' }];
        } catch {
          return []; // a broken symlink
        }
      });
    return { entries: entries.sort(byKindThenName), git: false };
  }
  const [files, badges] = await Promise.all([gitFiles(root, at.rel), gitBadges(root, g.prefix, at.rel)]);
  const seen = new Map<string, TreeEntry>();
  for (const f of files) {
    if (!f.startsWith(under)) continue;
    const rest = f.slice(under.length);
    const name = rest.split('/')[0]!;
    if (seen.has(name)) continue;
    const isDir = rest.includes('/');
    const git = isDir ? undefined : badges.get(f);
    seen.set(name, { name, path: under + name, kind: isDir ? 'dir' : 'file', ...(git ? { git } : {}) });
  }
  return { entries: [...seen.values()].sort(byKindThenName), git: true, ...(at.rel ? {} : { files: files.length }) };
}

function sniffBinary(abs: string): boolean {
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(SNIFF);
    return looksBinary(buf.subarray(0, readSync(fd, buf, 0, SNIFF, 0)));
  } finally {
    closeSync(fd);
  }
}

function fileAt(root: string, rel: string) {
  const at = resolveInWorkspace(root, rel);
  let st;
  try {
    st = statSync(at.abs);
  } catch {
    throw new HttpError(404, `no file ${at.rel}`);
  }
  if (!st.isFile()) throw new HttpError(400, `${at.rel || '.'} is not a file`);
  return { ...at, st };
}

const writable = (abs: string) => {
  try {
    accessSync(abs, constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

/** A file for the editor: its text (none when over 2 MB or binary), size, mtime and language; secrets and unwritable files are read-only. */
export function readCode(root: string, rel: string): CodeFile {
  const { abs, rel: path, st } = fileAt(root, rel);
  const secret = isSecretPath(path);
  const head = { path, size: st.size, mtimeMs: st.mtimeMs, lang: langOf(path), ...(secret ? { secret: true as const } : {}), ...(secret || !writable(abs) ? { readOnly: true as const } : {}) };
  if (st.size > MAX_TEXT) return { ...head, text: '', tooLarge: true };
  if (sniffBinary(abs)) return { ...head, text: '', binary: true };
  return { ...head, text: readFileSync(abs, 'utf8') };
}

/**
 * Save the editor's text: a temp file in the same folder renamed over the original (same mode), so a reader never sees half
 * a file. `baseMtimeMs` is the mtime the text was read at: if the file has changed since, 409 changed-on-disk (leave it out
 * to overwrite). Secrets and unwritable files are 403; only existing text files up to 2 MB are saved.
 */
export function saveCode(root: string, rel: string, text: string, baseMtimeMs?: number): { mtimeMs: number; size: number } {
  const { abs, rel: path, st } = fileAt(root, rel);
  if (isSecretPath(path)) throw new HttpError(403, 'secrets files are read-only here');
  if (!writable(abs)) throw new HttpError(403, `${path} is read-only`);
  if (st.size > MAX_TEXT || Buffer.byteLength(text) > MAX_TEXT) throw new HttpError(413, 'files over 2 MB are not edited here');
  if (sniffBinary(abs)) throw new HttpError(400, `${path} is a binary file`);
  if (baseMtimeMs !== undefined && st.mtimeMs !== baseMtimeMs) throw new HttpError(409, 'changed-on-disk', { mtimeMs: st.mtimeMs });
  const tmp = join(dirname(abs), `.${basename(abs)}.${process.pid}-${Date.now().toString(36)}.tether-tmp`);
  try {
    writeFileSync(tmp, text);
    chmodSync(tmp, st.mode & 0o7777);
    renameSync(tmp, abs);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* never written */
    }
    throw e;
  }
  const now = statSync(abs);
  return { mtimeMs: now.mtimeMs, size: now.size };
}
