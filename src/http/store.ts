/**
 * Saved requests live in the project, next to the code: <project>/.aorch/http/. A folder is a collection (max 4 deep),
 * `*.req.json` is a request, `_collection.json` holds a collection's vars and default headers, `environments/<name>.json`
 * an environment. Everything read from disk is validated; an invalid request is reported with its error, never thrown.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { HttpClientError } from './errors.js';
import { compileRegex } from './regex.js';
import { isObj, METHODS, SECRET_KEY_RE, VAR_RE, type Body, type Check, type CollectionFile, type Environment, type EnvValue, type HttpRequestFile, type KV, type Method, type TreeCollection, type TreeRequest } from './types.js';

export const SEG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_DEPTH = 4;
const REQ_EXT = '.req.json';
const COLL_FILE = '_collection.json';
const ENV_DIR = 'environments';
const MAX_FILE = 1_000_000;

export const httpRoot = (dir: string): string => join(dir, '.aorch', 'http');

const invalid = (m: string) => new HttpClientError('invalid', m);
const isLink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
/** `.aorch` or `.aorch/http` is itself a symlink: everything under it could live outside the project. */
const rootIsLinked = (dir: string): boolean => isLink(join(dir, '.aorch')) || isLink(httpRoot(dir));

/** A request id or collection path: lowercase segments, at most 4 folders deep, never under environments/. */
export function checkPath(p: string, kind: 'request' | 'collection'): string[] {
  if (kind === 'collection' && p === '') return [];
  const segs = p.split('/');
  const folders = kind === 'request' ? segs.length - 1 : segs.length;
  if (!p || segs.some((s) => !SEG_RE.test(s)) || folders > MAX_DEPTH || segs[0] === ENV_DIR) throw invalid(kind === 'request' ? 'invalid request id' : 'invalid collection path');
  return segs;
}

/** The absolute path for `rel` under .aorch/http, refusing anything that would leave it through a symlink. */
export function safeHttpFile(dir: string, rel: string): string {
  const root = httpRoot(dir);
  const target = join(root, rel);
  if (rootIsLinked(dir)) throw invalid('invalid request id');
  const realRoot = existsSync(root) ? realpathSync(root) : resolve(root);
  let probe = target;
  while (!existsSync(probe) && probe.startsWith(root + sep)) {
    // a dangling symlink reads as missing through existsSync; lstat sees it, and it is refused like any other link
    if (isLink(probe)) throw invalid('invalid request id');
    probe = dirname(probe);
  }
  if (existsSync(probe) && probe.startsWith(root)) {
    const real = realpathSync(probe);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) throw invalid('invalid request id');
  }
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw invalid('invalid request id');
  return target;
}

function readJsonFile(file: string): unknown {
  if (statSync(file).size > MAX_FILE) throw new Error('file is larger than 1 MB');
  return JSON.parse(readFileSync(file, 'utf8'));
}
/** Temp file + rename. Refuses content over the same 1 MB cap the readers enforce, before touching the disk. */
function writeAtomic(file: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2) + '\n';
  if (Buffer.byteLength(text) > MAX_FILE) throw new HttpClientError('too_large', 'file too large');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
}

// ---------- validation ----------
function kvs(v: unknown, what: string): KV[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 100) throw new Error(`${what} must be a list (max 100)`);
  return v.map((x, i) => {
    if (!isObj(x) || typeof x.key !== 'string' || typeof x.value !== 'string') throw new Error(`${what}[${i}] needs "key" and "value" strings`);
    if (/[\r\n]/.test(x.key + x.value)) throw new Error(`${what}[${i}] must be one line`);
    return { key: x.key, value: x.value, on: x.on !== false };
  });
}
function vars(v: unknown, what: string): Record<string, string> {
  if (v === undefined) return {};
  if (!isObj(v)) throw new Error(`${what} must be an object`);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!VAR_RE.test(k)) throw new Error(`${what}: bad variable name "${k}"`);
    if (typeof val !== 'string') throw new Error(`${what}.${k} must be a string`);
    out[k] = val;
  }
  return out;
}
function body(v: unknown): Body {
  if (v === undefined) return { kind: 'none' };
  if (!isObj(v)) throw new Error('body must be an object');
  switch (v.kind) {
    case 'none':
      return { kind: 'none' };
    case 'json':
      return { kind: 'json', value: v.value ?? null };
    case 'text':
      if (typeof v.value !== 'string') throw new Error('a text body needs a string "value"');
      if (v.contentType !== undefined && (typeof v.contentType !== 'string' || /[\r\n]/.test(v.contentType))) throw new Error('body.contentType must be one line');
      return { kind: 'text', value: v.value, ...(v.contentType ? { contentType: v.contentType as string } : {}) };
    case 'form':
      return { kind: 'form', fields: kvs(v.fields, 'body.fields') };
    default:
      throw new Error('body.kind must be none, json, text or form');
  }
}
const regexOk = (src: unknown, i: number) => {
  try {
    compileRegex(src);
  } catch (e) {
    throw new Error(`checks[${i}]: ${(e as Error).message}`);
  }
};

export function parseCheck(c: unknown, i: number): Check {
  if (!isObj(c)) throw new Error(`checks[${i}] must be an object`);
  const op = String(c.op);
  const bad = () => new Error(`checks[${i}]: unsupported ${String(c.kind)} check "${op}"`);
  switch (c.kind) {
    case 'status':
      if (op === 'in') {
        if (!Array.isArray(c.value) || !c.value.every((x) => Number.isInteger(x))) throw new Error(`checks[${i}]: "in" takes a list of status codes`);
        return { kind: 'status', op, value: c.value as number[] };
      }
      if (!['eq', 'ne', 'lt', 'gte'].includes(op)) throw bad();
      if (!Number.isInteger(c.value)) throw new Error(`checks[${i}]: a status value must be a whole number`);
      return { kind: 'status', op: op as 'eq', value: c.value as number };
    case 'header':
      if (typeof c.name !== 'string' || !c.name) throw new Error(`checks[${i}]: a header check needs "name"`);
      if (op === 'exists') return { kind: 'header', name: c.name, op };
      if (!['eq', 'contains', 'matches'].includes(op) || typeof c.value !== 'string') throw bad();
      if (op === 'matches') regexOk(c.value, i);
      return { kind: 'header', name: c.name, op: op as 'eq', value: c.value };
    case 'json':
      if (typeof c.path !== 'string' || !c.path.startsWith('$')) throw new Error(`checks[${i}]: a json check needs a "path" starting with $`);
      if (op === 'exists') return { kind: 'json', path: c.path, op };
      if (!['eq', 'ne', 'contains', 'matches', 'lt', 'gt'].includes(op)) throw bad();
      if (op === 'matches') regexOk(c.value, i);
      return { kind: 'json', path: c.path, op: op as 'eq', value: c.value };
    case 'time':
      if (op !== 'lt' || typeof c.value !== 'number' || c.value <= 0) throw new Error(`checks[${i}]: a time check is { "op": "lt", "value": <ms> }`);
      return { kind: 'time', op, value: c.value };
    case 'body':
      if (!['contains', 'matches'].includes(op) || typeof c.value !== 'string') throw bad();
      if (op === 'matches') regexOk(c.value, i);
      return { kind: 'body', op: op as 'contains', value: c.value };
    default:
      throw new Error(`checks[${i}]: unknown check kind "${String(c.kind)}"`);
  }
}

/** Untrusted JSON → a well-formed request file, or throw with a precise message. */
export function parseRequest(raw: unknown): HttpRequestFile {
  if (!isObj(raw)) throw new Error('a request file must be a JSON object');
  if (raw.v !== undefined && raw.v !== 1) throw new Error(`unsupported request file version ${String(raw.v)}`);
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 120 || /[\r\n]/.test(raw.name)) throw new Error('"name" must be one line, 1–120 characters');
  const method = String(raw.method ?? 'GET').toUpperCase();
  if (!(METHODS as readonly string[]).includes(method)) throw new Error(`unknown method "${method}"`);
  if (typeof raw.url !== 'string' || !raw.url.trim() || raw.url.length > 4000 || /[\r\n]/.test(raw.url)) throw new Error('"url" must be one line, 1–4000 characters');
  if (raw.checks !== undefined && (!Array.isArray(raw.checks) || raw.checks.length > 50)) throw new Error('"checks" must be a list (max 50)');
  if (raw.notes !== undefined && (typeof raw.notes !== 'string' || raw.notes.length > 4000)) throw new Error('"notes" must be a string (max 4000)');
  return {
    v: 1,
    name: raw.name.trim(),
    method: method as Method,
    url: raw.url.trim(),
    query: kvs(raw.query, 'query'),
    headers: kvs(raw.headers, 'headers'),
    body: body(raw.body),
    vars: vars(raw.vars, 'vars'),
    checks: ((raw.checks as unknown[] | undefined) ?? []).map(parseCheck),
    ...(raw.notes ? { notes: raw.notes as string } : {}),
  };
}

// ---------- requests ----------
export function requestExists(dir: string, id: string): boolean {
  checkPath(id, 'request');
  return existsSync(safeHttpFile(dir, id + REQ_EXT));
}

export function readRequest(dir: string, id: string): { id: string; file?: HttpRequestFile; error?: string } {
  checkPath(id, 'request');
  const f = safeHttpFile(dir, id + REQ_EXT);
  if (!existsSync(f)) throw new HttpClientError('not_found', `no request "${id}"`);
  try {
    return { id, file: parseRequest(readJsonFile(f)) };
  } catch (e) {
    return { id, error: (e as Error).message };
  }
}

/** The file's text (first 64 KB), for showing an invalid request read-only. */
export function readRawRequest(dir: string, id: string): string {
  checkPath(id, 'request');
  const f = safeHttpFile(dir, id + REQ_EXT);
  if (!existsSync(f)) throw new HttpClientError('not_found', `no request "${id}"`);
  return readFileSync(f, 'utf8').slice(0, 65_536);
}

export function writeRequest(dir: string, id: string, raw: unknown): HttpRequestFile {
  checkPath(id, 'request');
  let file: HttpRequestFile;
  try {
    file = parseRequest(raw);
  } catch (e) {
    throw invalid((e as Error).message);
  }
  writeAtomic(safeHttpFile(dir, id + REQ_EXT), file);
  return file;
}

/** A name → a file name: lowercase [a-z0-9._-], at most 64 characters. */
export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 64)
    .replace(/[-.]+$/, '');
  return SEG_RE.test(s) ? s : 'request';
}

/** Create a request in `collection` with an id derived from its name (never overwrites). Returns the id. */
export function createRequest(dir: string, collection: string, raw: unknown): string {
  const folder = checkPath(collection, 'collection');
  let file: HttpRequestFile;
  try {
    file = parseRequest(raw);
  } catch (e) {
    throw invalid((e as Error).message);
  }
  const base = slugify(file.name);
  let id = [...folder, base].join('/');
  for (let n = 2; requestExists(dir, id); n++) id = [...folder, `${base.slice(0, 60)}-${n}`].join('/');
  writeRequest(dir, id, file);
  return id;
}

export function deleteRequest(dir: string, id: string): boolean {
  checkPath(id, 'request');
  const f = safeHttpFile(dir, id + REQ_EXT);
  if (!existsSync(f)) return false;
  rmSync(f);
  return true;
}

export function moveRequest(dir: string, id: string, to: string): void {
  checkPath(id, 'request');
  checkPath(to, 'request');
  const from = safeHttpFile(dir, id + REQ_EXT);
  if (!existsSync(from)) throw new HttpClientError('not_found', `no request "${id}"`);
  const dest = safeHttpFile(dir, to + REQ_EXT);
  if (existsSync(dest)) throw new HttpClientError('conflict', `"${to}" already exists`);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(from, dest);
}

// ---------- collections ----------
export function parseCollection(raw: unknown): CollectionFile {
  if (!isObj(raw)) throw new Error('a collection file must be a JSON object');
  return { vars: vars(raw.vars, 'vars'), headers: kvs(raw.headers, 'headers') };
}

export function readCollection(dir: string, path: string): CollectionFile {
  const segs = checkPath(path, 'collection');
  const f = safeHttpFile(dir, [...segs, COLL_FILE].join('/'));
  if (!existsSync(f)) return { vars: {}, headers: [] };
  try {
    return parseCollection(readJsonFile(f));
  } catch (e) {
    throw invalid(`${path || '(root)'}/${COLL_FILE}: ${(e as Error).message}`);
  }
}

export function writeCollection(dir: string, path: string, raw: unknown): CollectionFile {
  const segs = checkPath(path, 'collection');
  let file: CollectionFile;
  try {
    file = parseCollection(raw);
  } catch (e) {
    throw invalid((e as Error).message);
  }
  writeAtomic(safeHttpFile(dir, [...segs, COLL_FILE].join('/')), file);
  return file;
}

/** The collection files that apply to a request, innermost first: its own folder, each parent, then the root. */
export function collectionChain(dir: string, id: string): { path: string; file: CollectionFile }[] {
  const folders = checkPath(id, 'request').slice(0, -1);
  const out: { path: string; file: CollectionFile }[] = [];
  for (let n = folders.length; n >= 0; n--) {
    const p = folders.slice(0, n).join('/');
    out.push({ path: p, file: readCollection(dir, p) });
  }
  return out;
}

// ---------- environments ----------
/** Refuses a symlinked .aorch or .aorch/http outright, so a listing reports it instead of showing an empty tree. */
const refuseLinkedRoot = (dir: string): void => {
  if (rootIsLinked(dir)) throw invalid('symlinked .aorch');
};

export function listEnvironments(dir: string): string[] {
  refuseLinkedRoot(dir);
  if (isLink(join(httpRoot(dir), ENV_DIR))) return [];
  try {
    return readdirSync(join(httpRoot(dir), ENV_DIR))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .filter((n) => SEG_RE.test(n))
      .sort();
  } catch {
    return [];
  }
}

export function parseEnvironment(raw: unknown): Environment {
  if (!isObj(raw)) throw new Error('an environment file must be a JSON object');
  if (raw.v !== undefined && raw.v !== 1) throw new Error(`unsupported environment version ${String(raw.v)}`);
  const vs = raw.vars ?? {};
  if (!isObj(vs)) throw new Error('"vars" must be an object');
  const out: Record<string, EnvValue> = {};
  for (const [k, v] of Object.entries(vs)) {
    if (!VAR_RE.test(k)) throw new Error(`bad variable name "${k}"`);
    if (typeof v === 'string') out[k] = v;
    else if (isObj(v) && typeof v.secret === 'string' && SECRET_KEY_RE.test(v.secret)) out[k] = { secret: v.secret };
    else throw new Error(`"${k}" must be a string or { "secret": "<key>" } with a valid secret key`);
  }
  return { v: 1, vars: out };
}

const envFile = (dir: string, name: string) => {
  if (!SEG_RE.test(name)) throw invalid('invalid environment name');
  return safeHttpFile(dir, `${ENV_DIR}/${name}.json`);
};

export function readEnvironment(dir: string, name: string): Environment {
  const f = envFile(dir, name);
  if (!existsSync(f)) throw new HttpClientError('not_found', `no environment "${name}"`);
  try {
    return parseEnvironment(readJsonFile(f));
  } catch (e) {
    throw invalid(`${name}.json: ${(e as Error).message}`);
  }
}

export function writeEnvironment(dir: string, name: string, raw: unknown): Environment {
  const f = envFile(dir, name);
  let env: Environment;
  try {
    env = parseEnvironment(raw);
  } catch (e) {
    throw invalid((e as Error).message);
  }
  writeAtomic(f, env);
  return env;
}

export function deleteEnvironment(dir: string, name: string): boolean {
  const f = envFile(dir, name);
  if (!existsSync(f)) return false;
  rmSync(f);
  return true;
}

// ---------- tree ----------
export function readTree(dir: string): { root: TreeCollection; environments: string[] } {
  refuseLinkedRoot(dir);
  const walk = (rel: string[], depth: number): TreeCollection => {
    const node: TreeCollection = { path: rel.join('/'), name: rel.at(-1) ?? '', collections: [], requests: [] };
    let names: string[] = [];
    try {
      names = readdirSync(join(httpRoot(dir), ...rel)).sort();
    } catch {
      return node;
    }
    for (const n of names) {
      let st;
      try {
        st = lstatSync(join(httpRoot(dir), ...rel, n));
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (depth < MAX_DEPTH && SEG_RE.test(n) && !(depth === 0 && n === ENV_DIR)) node.collections.push(walk([...rel, n], depth + 1));
        continue;
      }
      if (!n.endsWith(REQ_EXT)) continue;
      const base = n.slice(0, -REQ_EXT.length);
      if (!SEG_RE.test(base)) continue;
      const id = [...rel, base].join('/');
      const r = readRequest(dir, id);
      const note = r.file?.notes?.split('\n')[0]?.trim().slice(0, 80);
      node.requests.push(r.file ? { id, name: r.file.name, method: r.file.method, url: r.file.url, ...(note ? { note } : {}) } : { id, name: base, method: '?', url: '', invalid: r.error });
    }
    return node;
  };
  return { root: walk([], 0), environments: listEnvironments(dir) };
}

/** Every request in the tree, depth first, in name order. */
export function listRequests(dir: string): TreeRequest[] {
  const out: TreeRequest[] = [];
  const flat = (c: TreeCollection) => {
    out.push(...c.requests);
    c.collections.forEach(flat);
  };
  flat(readTree(dir).root);
  return out;
}
