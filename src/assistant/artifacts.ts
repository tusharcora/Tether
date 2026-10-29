/**
 * The artifacts chats make (an HTML page, a Markdown doc), kept in the project next to the code:
 * `<project>/.aorch/artifacts/<id>/meta.json` and one file per version, `v1.html`, `v2.html` (or `v1.md` …). A chat with
 * no project keeps them in Tether's own folder, `<home>/artifacts/`. Ids are slugs made from the title. A symlink on the
 * way (.aorch, artifacts, the artifact's folder, a file in it) is refused, so nothing is read or written outside that
 * folder; files are written to a fresh temp name and renamed.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from '../serverkit.js';
import { wordCount, type ArtifactBlock } from './artifactBlocks.js';
import type { ArtifactMeta, ArtifactRef, ArtifactView } from './types.js';

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Characters per version: a big single-file page fits, a runaway reply does not. */
export const ARTIFACT_MAX = 500_000;
const FILE_RE = /^v(\d{1,4})\.(html|md)$/;

const isLink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** The artifacts folder: the project's, or with no project Tether's home's. */
export function artifactsDir(home: string, root?: string): string {
  const dir = root ? join(root, '.aorch', 'artifacts') : join(home, 'artifacts');
  if ((root && isLink(join(root, '.aorch'))) || isLink(dir)) throw new HttpError(400, 'refusing a symlinked artifacts folder');
  return dir;
}

function folder(dir: string, id: unknown): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'not an artifact id');
  const f = join(dir, id);
  if (isLink(f)) throw new HttpError(400, 'refusing a symlinked artifact');
  return f;
}
function fileIn(f: string, name: string): string {
  const p = join(f, name);
  if (isLink(p)) throw new HttpError(400, `refusing ${name}: it is a symlink`);
  return p;
}

/** A fresh temp name opened exclusively, then a rename: a planted symlink is never followed, a reader never sees half a file. */
function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, text, { flag: 'wx' });
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** meta.json from disk, checked: a version's file must be its own `v<n>.html|md`. Anything off: undefined. */
function parseMeta(raw: unknown, id: string): ArtifactMeta | undefined {
  const x = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof x.title !== 'string' || (x.kind !== 'html' && x.kind !== 'markdown') || !num(x.createdAt) || !num(x.updatedAt) || !Array.isArray(x.versions)) return undefined;
  const versions = x.versions.flatMap((v) => {
    const y = (v ?? {}) as Record<string, unknown>;
    const m = typeof y.file === 'string' ? FILE_RE.exec(y.file) : null;
    return m && Number(m[1]) === y.n && num(y.at) ? [{ n: y.n, at: y.at, file: y.file as string, ...(num(y.words) ? { words: y.words } : {}), ...(num(y.bytes) ? { bytes: y.bytes } : {}) }] : [];
  });
  if (!versions.length) return undefined;
  return { id, title: x.title.slice(0, 80), kind: x.kind, ...(typeof x.chatId === 'string' ? { chatId: x.chatId } : {}), createdAt: x.createdAt, updatedAt: x.updatedAt, versions };
}

export function readMeta(dir: string, id: string): ArtifactMeta | undefined {
  const p = fileIn(folder(dir, id), 'meta.json');
  if (!existsSync(p)) return undefined;
  try {
    return parseMeta(JSON.parse(readFileSync(p, 'utf8')), id);
  } catch {
    return undefined;
  }
}

/** Every artifact in the folder, last changed first; broken ones and symlinks are skipped. */
export function listArtifacts(dir: string): ArtifactMeta[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => ID_RE.test(n) && !isLink(join(dir, n)))
    .flatMap((n) => readMeta(dir, n) ?? [])
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** An artifact and one version's content: the latest, unless `v` names another. */
export function readArtifact(dir: string, id: string, v?: number): ArtifactView {
  const meta = readMeta(dir, id);
  if (!meta) throw new HttpError(404, 'no such artifact');
  const ver = v === undefined ? meta.versions.at(-1)! : meta.versions.find((x) => x.n === v);
  if (!ver) throw new HttpError(404, `no version ${v}`);
  const path = fileIn(folder(dir, id), ver.file);
  if (!existsSync(path)) throw new HttpError(404, `version ${ver.n} is missing on disk`);
  // a file edited by hand can be anything: read at most what a save could have written (4 bytes a character)
  if (statSync(path).size > ARTIFACT_MAX * 4) throw new HttpError(400, `version ${ver.n} is too large to show`);
  return { meta, version: ver.n, content: readFileSync(path, 'utf8'), path };
}

/** A slug of the title that no artifact here uses yet. */
function freeId(dir: string, title: string): string {
  const base =
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, 56)
      .replace(/-+$/, '') || 'artifact';
  let id = base;
  for (let n = 2; existsSync(join(dir, id)) || isLink(join(dir, id)); n++) id = `${base}-${n}`;
  return id;
}

/** Save a reply's artifact: its id names one here → a new version of it; otherwise a new artifact. */
export function saveArtifact(dir: string, b: ArtifactBlock, chatId?: string, now = Date.now()): ArtifactRef {
  if (!b.content.trim()) throw new HttpError(400, 'the artifact is empty');
  if (b.content.length > ARTIFACT_MAX) throw new HttpError(400, `the artifact is too large (max ${ARTIFACT_MAX / 1000}k characters)`);
  const prev = b.id && ID_RE.test(b.id) ? readMeta(dir, b.id) : undefined;
  const id = prev?.id ?? freeId(dir, b.title);
  const f = folder(dir, id);
  mkdirSync(f, { recursive: true });
  const n = (prev?.versions.at(-1)?.n ?? 0) + 1;
  const file = `v${n}.${b.kind === 'html' ? 'html' : 'md'}`;
  writeAtomic(fileIn(f, file), b.content);
  const owner = prev?.chatId ?? chatId;
  const meta: ArtifactMeta = {
    id,
    title: prev && b.title === 'Untitled' ? prev.title : b.title,
    kind: b.kind,
    ...(owner ? { chatId: owner } : {}),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    versions: [...(prev?.versions ?? []), { n, at: now, file, ...(b.kind === 'markdown' ? { words: wordCount(b.content) } : { bytes: Buffer.byteLength(b.content) }) }],
  };
  writeAtomic(fileIn(f, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return { id, version: n, title: meta.title, kind: meta.kind };
}

/** Delete an artifact and all its versions; false when there is none. */
export function deleteArtifact(dir: string, id: string): boolean {
  const f = folder(dir, id);
  if (!existsSync(f)) return false;
  // a real folder: rmSync removes links inside it, it never follows them
  rmSync(f, { recursive: true, force: true });
  return true;
}
