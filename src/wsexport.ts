/**
 * One JSON file that carries a workspace: .aorch/workspace.json, .aorch/project.md, every .aorch/http file and (only
 * when asked, from the CLI) its secrets. Importing writes every file through the store's guarded paths: a crafted
 * bundle cannot leave the project, and nothing is written unless every target path passes.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadSecrets, setSecret } from './http/secrets.js';
import { MAX_FILE, SEG_RE, httpRoot, isStorePath, refuseLinkedRoot, safeAorchFile, safeHttpFile, slugify } from './http/store.js';
import { SECRET_KEY_RE, isObj } from './http/types.js';
import { META_FILE, NOTES_FILE, WS_DIR, initWorkspace, registeredAt, type Workspace } from './workspace.js';

export interface Bundle {
  v: 1;
  workspace: Record<string, unknown>;
  notes: string;
  http: { files: Record<string, unknown> };
  secrets?: Record<string, string>;
}
/** A file under .aorch/http that the export could not include, and why (project-relative path). */
export interface Skipped {
  path: string;
  reason: string;
}
export interface BundlePlan {
  dir: string;
  create: string[];
  overwrite: string[];
  /** every secret key the bundle carries */
  secrets: string[];
  /** the keys among `secrets` the target workspace already holds: importing replaces their values (names only, never values) */
  overwriteSecrets: string[];
}

/** A bundle or a target the caller got wrong (400); anything else thrown here is unexpected. */
export class BundleError extends Error {}

const MAX_FILES = 2000;
const HTTP_PREFIX = `${WS_DIR}/http/`;
const serialize = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const tooBig = (text: string) => Buffer.byteLength(text) > MAX_FILE;

export const bundleFileName = (w: Workspace): string => `${slugify(w.name || w.id)}.aorch.json`;

/** Read a workspace into a bundle. Files that cannot travel are listed in `skipped`, never dropped silently. */
export function exportWorkspace(home: string, w: Workspace, o: { withSecrets?: boolean } = {}): { bundle: Bundle; skipped: Skipped[] } {
  if (!w.exists) throw new BundleError(`the folder ${w.path} is missing`);
  refuseLinkedRoot(w.path);
  const skipped: Skipped[] = [];
  const readText = (name: string): string | undefined => {
    const f = safeAorchFile(w.path, name);
    if (!existsSync(f)) return undefined;
    // the import refuses anything over the store's 1 MB cap, so the export never carries it
    if (statSync(f).size > MAX_FILE) return void skipped.push({ path: `${WS_DIR}/${name}`, reason: 'larger than 1 MB' });
    return readFileSync(f, 'utf8');
  };
  let meta: Record<string, unknown> = {};
  const metaText = readText(META_FILE);
  if (metaText !== undefined) {
    try {
      const j: unknown = JSON.parse(metaText);
      if (!isObj(j)) throw new Error('not an object');
      meta = j;
    } catch {
      skipped.push({ path: `${WS_DIR}/${META_FILE}`, reason: 'not a valid JSON object' });
    }
  }
  const notes = readText(NOTES_FILE) ?? '';
  const files: Record<string, unknown> = {};
  let count = 0;
  const root = httpRoot(w.path);
  const skip = (rel: string, reason: string) => skipped.push({ path: HTTP_PREFIX + rel, reason });
  const walk = (rel: string) => {
    let names: string[];
    try {
      names = readdirSync(rel ? join(root, rel) : root).sort();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') skip(rel ? `${rel}/` : '', `could not list it (${(e as NodeJS.ErrnoException).code})`);
      return;
    }
    for (const n of names) {
      const r = rel ? `${rel}/${n}` : n;
      const st = lstatSync(join(root, r));
      if (st.isSymbolicLink()) skip(r, 'a symlink (not followed)');
      else if (st.isDirectory()) {
        // symlinks are never followed, so this ends; files nested deeper than the store reads are listed below
        if (!SEG_RE.test(n)) skip(`${r}/`, 'a folder name the store does not allow');
        else walk(r);
      } else if (!st.isFile()) skip(r, 'not a regular file');
      else if (!isStorePath(r)) skip(r, 'not a request, collection or environment file');
      else if (st.size > MAX_FILE) skip(r, 'larger than 1 MB');
      else if (count >= MAX_FILES) skip(r, `over the ${MAX_FILES}-file limit`);
      else {
        let text: string;
        try {
          text = readFileSync(join(root, r), 'utf8');
        } catch (e) {
          skip(r, `could not read it (${(e as NodeJS.ErrnoException).code})`);
          continue;
        }
        try {
          files[r] = JSON.parse(text);
          count++;
        } catch {
          skip(r, 'not valid JSON');
        }
      }
    }
  };
  walk('');
  const bundle: Bundle = { v: 1, workspace: meta, notes, http: { files }, ...(o.withSecrets ? { secrets: loadSecrets(home, w.id) } : {}) };
  return { bundle, skipped };
}

/** Write a bundle atomically; mode 0600 when it carries secrets (set explicitly: the mode option is filtered by the umask). */
export function writeBundle(file: string, b: Bundle): void {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, serialize(b), { mode: b.secrets ? 0o600 : 0o644, flag: 'wx' });
    if (b.secrets) chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true }); // never leave a stray copy of the secrets behind
    throw e;
  }
}

/** Untrusted JSON → a bundle, or throw with a precise message. Paths and sizes follow the store's rules. */
export function parseBundle(raw: unknown): Bundle {
  if (!isObj(raw) || raw.v !== 1 || !isObj(raw.workspace) || !isObj(raw.http) || !isObj(raw.http.files)) throw new BundleError('not an aorch workspace export (v1)');
  if (raw.notes !== undefined && typeof raw.notes !== 'string') throw new BundleError('"notes" must be text');
  const files = raw.http.files;
  if (Object.keys(files).length > MAX_FILES) throw new BundleError(`too many files in the export (max ${MAX_FILES})`);
  for (const [p, content] of Object.entries(files)) {
    if (!isStorePath(p)) throw new BundleError(`refusing a file path in the export: ${p}`);
    if (tooBig(serialize(content))) throw new BundleError(`${p} is larger than 1 MB`);
  }
  if (tooBig(serialize(raw.workspace))) throw new BundleError(`${META_FILE} is larger than 1 MB`);
  if (typeof raw.notes === 'string' && tooBig(raw.notes)) throw new BundleError(`${NOTES_FILE} is larger than 1 MB`);
  if (raw.secrets !== undefined) {
    if (!isObj(raw.secrets)) throw new BundleError('"secrets" must be an object');
    for (const [k, v] of Object.entries(raw.secrets)) if (!SECRET_KEY_RE.test(k) || typeof v !== 'string') throw new BundleError(`invalid secret key or value: ${k}`);
  }
  return { v: 1, workspace: raw.workspace, notes: (raw.notes as string | undefined) ?? '', http: { files }, ...(raw.secrets ? { secrets: raw.secrets as Record<string, string> } : {}) };
}

/** Every file the bundle would write, each through a guarded path. Throws before anything is written. */
function targets(b: Bundle, dir: string): { rel: string; abs: string; text: string }[] {
  let st;
  try {
    st = statSync(dir);
  } catch {
    throw new BundleError(`${dir} does not exist`);
  }
  if (!st.isDirectory()) throw new BundleError(`${dir} is not a folder`);
  return [
    { rel: `${WS_DIR}/${META_FILE}`, abs: safeAorchFile(dir, META_FILE), text: serialize(b.workspace) },
    ...(b.notes ? [{ rel: `${WS_DIR}/${NOTES_FILE}`, abs: safeAorchFile(dir, NOTES_FILE), text: b.notes }] : []),
    ...Object.entries(b.http.files).map(([p, content]) => ({ rel: HTTP_PREFIX + p, abs: safeHttpFile(dir, p), text: serialize(content) })),
  ];
}

/**
 * What an import into `dir` would create and overwrite (project-relative paths), which secret keys it carries, and
 * which of those the workspace already registered for `dir` in `home` holds (applyBundle writes into that same scope,
 * so their values would be replaced). Key names only: no secret value is ever read into the plan.
 */
export function planBundleImport(raw: Bundle, dir: string, home?: string): BundlePlan {
  const b = parseBundle(raw);
  const create: string[] = [];
  const overwrite: string[] = [];
  for (const t of targets(b, dir)) (existsSync(t.abs) ? overwrite : create).push(t.rel);
  const secrets = Object.keys(b.secrets ?? {});
  const reg = home && secrets.length ? registeredAt(home, dir) : undefined;
  const held = reg ? new Set(Object.keys(loadSecrets(home!, reg.id))) : new Set<string>();
  return { dir, create, overwrite, secrets, overwriteSecrets: secrets.filter((k) => held.has(k)) };
}

/** Write the bundle into `dir`, register it as a workspace in `home`, and put its secrets in that workspace's scope. */
export function applyBundle(home: string, raw: Bundle, dir: string): { workspace: Workspace; written: string[] } {
  const b = parseBundle(raw); // a caller may hand over an object that never went through parseBundle
  const list = targets(b, dir);
  if (b.secrets && Object.keys(b.secrets).length) loadSecrets(home, 'default'); // a secrets file that is too open fails before any write
  const written: string[] = [];
  for (const t of list) {
    mkdirSync(dirname(t.abs), { recursive: true });
    // a fresh temp name opened exclusively: a planted symlink at the temp path is never followed
    const tmp = `${t.abs}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, t.text, { flag: 'wx' });
      renameSync(tmp, t.abs);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    written.push(t.rel);
  }
  const reg = initWorkspace(home, dir, { write: false, name: typeof b.workspace.name === 'string' ? b.workspace.name : undefined });
  for (const [k, v] of Object.entries(b.secrets ?? {})) setSecret(home, reg.workspace.id, k, v);
  return { workspace: reg.workspace, written };
}
