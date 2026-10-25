/**
 * Turn a cURL command, an OpenAPI 3.0/3.1 document or a Postman v2.1 collection into request files. A preview first
 * (what would be created, what is skipped and why); writing is a second call that recomputes the preview and never
 * overwrites. Literal credentials are never written into the repo: they become {{variables}} with a warning.
 */
import { parse as parseYaml } from 'yaml';
import { MASKED_HEADERS } from './redact.js';
import { VAR_IN_TEXT } from './resolve.js';
import { checkPath, parseRequest, readCollection, requestExists, slugify, writeCollection, writeRequest } from './store.js';
import { isObj, VAR_RE, type Body, type CollectionFile, type ImportPreview, type KV } from './types.js';

export type ImportKind = 'curl' | 'openapi' | 'postman';
const MAX_ITEMS = 500;
const METHODS_LC = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const tryJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};
const isCredentialHeader = (key: string) => MASKED_HEADERS.has(key.toLowerCase());
/** The {{names}} a text refers to. */
const varRefs = (text: string): string[] => [...text.matchAll(VAR_IN_TEXT)].map((m) => m[1]!);

interface Parsed {
  requests: { folder: string[]; name: string; file: Record<string, unknown> }[];
  collections: { folder: string[]; file: CollectionFile }[];
  skip: { name: string; reason: string }[];
  warnings: string[];
}
const empty = (): Parsed => ({ requests: [], collections: [], skip: [], warnings: [] });

// ---------- cURL ----------
/** Split a command line like a POSIX shell would (quotes, backslash escapes, line continuations). */
export function shellWords(s: string): string[] {
  const src = s.replace(/\\\r?\n/g, ' ');
  const out: string[] = [];
  let cur = '';
  let has = false;
  for (let i = 0; i < src.length; ) {
    const c = src[i]!;
    if (c === "'") {
      const j = src.indexOf("'", i + 1);
      if (j < 0) throw new Error('unclosed single quote');
      cur += src.slice(i + 1, j);
      has = true;
      i = j + 1;
    } else if (c === '"') {
      i++;
      has = true;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length && '"\\$`'.includes(src[i + 1]!)) {
          cur += src[i + 1];
          i += 2;
        } else cur += src[i++];
      }
      if (i >= src.length) throw new Error('unclosed double quote');
      i++;
    } else if (c === '\\' && i + 1 < src.length) {
      cur += src[i + 1];
      has = true;
      i += 2;
    } else if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = '';
      has = false;
      i++;
    } else {
      cur += c;
      has = true;
      i++;
    }
  }
  if (has) out.push(cur);
  return out;
}

const CURL_VALUE_FLAGS = new Set(['-o', '--output', '-A', '--user-agent', '-e', '--referer', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '-b', '--cookie', '-c', '--cookie-jar', '-F', '--form', '-T', '--upload-file', '-w', '--write-out', '--retry', '-r', '--range']);

function fromCurl(text: string): Parsed {
  const w = shellWords(text.trim());
  if (w[0] !== 'curl') throw new Error('not a curl command (it must start with "curl")');
  let method: string | undefined;
  let url: string | undefined;
  const headers: KV[] = [];
  const data: string[] = [];
  for (let i = 1; i < w.length; i++) {
    const a = w[i]!;
    const next = () => {
      const v = w[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '-X' || a === '--request') method = next().toUpperCase();
    else if (a === '-H' || a === '--header') {
      const h = next();
      const k = h.indexOf(':');
      if (k > 0) headers.push({ key: h.slice(0, k).trim(), value: h.slice(k + 1).trim(), on: true });
    } else if (a === '-d' || a === '--data' || a === '--data-raw' || a === '--data-binary') data.push(next());
    else if (a === '-u' || a === '--user') headers.push({ key: 'Authorization', value: `Basic ${Buffer.from(next()).toString('base64')}`, on: true });
    else if (a === '--url') url = next();
    else if (a.startsWith('-')) {
      if (CURL_VALUE_FLAGS.has(a)) i++; // flags that do not change the request are skipped with their value
    } else url ??= a;
  }
  if (!url) throw new Error('no URL in the curl command');
  if (!URL.canParse(url)) throw new Error(`not a valid URL: ${url}`);
  const m = method ?? (data.length ? 'POST' : 'GET');
  const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value;
  let body: Body = { kind: 'none' };
  if (data.length) {
    const raw = data.join('&');
    const j = tryJson(raw);
    body = j !== undefined && typeof j === 'object' && (!ct || /json/i.test(ct)) ? { kind: 'json', value: j } : { kind: 'text', value: raw };
  }
  const name = `${m} ${new URL(url).pathname}`;
  return { ...empty(), requests: [{ folder: [], name, file: { v: 1, name, method: m, url, headers, body } }] };
}

// ---------- OpenAPI ----------
const varName = (n: string) => {
  const s = n.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(s) ? s : `_${s}`;
};
function exampleOf(p: Record<string, unknown>): string | undefined {
  const schema = isObj(p.schema) ? p.schema : {};
  const v = p.example ?? schema.example ?? schema.default;
  return v === undefined ? undefined : typeof v === 'string' ? v : JSON.stringify(v);
}
function openapiBody(op: Record<string, unknown>): Body {
  const content = isObj(op.requestBody) && isObj(op.requestBody.content) ? op.requestBody.content : undefined;
  if (!content) return { kind: 'none' };
  const json = Object.entries(content).find(([t]) => /json/i.test(t))?.[1];
  if (isObj(json)) {
    const ex = json.example ?? (isObj(json.examples) ? Object.values(json.examples).map((e) => (isObj(e) ? e.value : undefined)).find((v) => v !== undefined) : undefined) ?? (isObj(json.schema) ? json.schema.example : undefined);
    return { kind: 'json', value: ex ?? {} };
  }
  if (content['application/x-www-form-urlencoded']) return { kind: 'form', fields: [] };
  return { kind: 'none' };
}
function fromOpenApi(text: string): Parsed {
  const doc = tryJson(text) ?? parseYaml(text);
  if (!isObj(doc) || typeof doc.openapi !== 'string' || !/^3\.[01]\./.test(doc.openapi)) throw new Error('not an OpenAPI 3.0 or 3.1 document');
  const out = empty();
  const server = Array.isArray(doc.servers) && isObj(doc.servers[0]) && typeof doc.servers[0].url === 'string' ? doc.servers[0].url : undefined;
  if (server) out.collections.push({ folder: [], file: { vars: { base: server }, headers: [] } });
  else out.warnings.push('the document has no servers: set the "base" variable in an environment');
  for (const [path, item] of Object.entries(isObj(doc.paths) ? doc.paths : {})) {
    if (!isObj(item)) continue;
    for (const m of METHODS_LC) {
      const op = item[m];
      if (!isObj(op)) continue;
      const fallback = `${m.toUpperCase()} ${path}`;
      if (out.requests.length >= MAX_ITEMS) {
        out.skip.push({ name: fallback, reason: `more than ${MAX_ITEMS} operations` });
        continue;
      }
      const name = (typeof op.summary === 'string' && op.summary.trim()) || (typeof op.operationId === 'string' && op.operationId) || fallback;
      const tag = Array.isArray(op.tags) && typeof op.tags[0] === 'string' ? op.tags[0] : undefined;
      const params = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(op.parameters) ? op.parameters : [])].filter(isObj).filter((p) => typeof p.name === 'string' && !('$ref' in p));
      const vars: Record<string, string> = {};
      for (const p of params) if (p.in === 'path') vars[varName(p.name as string)] = exampleOf(p) ?? '';
      const kv = (where: string) => params.filter((p) => p.in === where).map((p) => ({ key: p.name as string, value: exampleOf(p) ?? '', on: p.required === true }));
      out.requests.push({
        folder: tag ? [slugify(tag)] : [],
        name,
        file: {
          v: 1,
          name,
          method: m.toUpperCase(),
          url: `{{base}}${path.replace(/\{([^}]+)\}/g, (_, n: string) => `{{${varName(n)}}}`)}`,
          query: kv('query'),
          headers: kv('header'),
          body: openapiBody(op),
          vars,
          ...(typeof op.description === 'string' && op.description.trim() ? { notes: op.description.trim().slice(0, 4000) } : {}),
        },
      });
    }
  }
  return out;
}

// ---------- Postman v2.1 ----------
const authField = (list: unknown, key: string) => (Array.isArray(list) ? list.find((x) => isObj(x) && x.key === key) : undefined) as Record<string, unknown> | undefined;
/** The values of a bearer or basic auth block (where a credential or a {{variable}} holding one would sit). */
function authValues(auth: unknown): string[] {
  if (!isObj(auth)) return [];
  if (auth.type === 'bearer') return [String(authField(auth.bearer, 'token')?.value ?? '')];
  if (auth.type === 'basic') return ['username', 'password'].map((k) => String(authField(auth.basic, k)?.value ?? ''));
  return [];
}
function postmanAuth(auth: unknown, name: string, out: Parsed): KV | undefined | null {
  if (!isObj(auth) || auth.type === 'noauth' || auth.type === undefined) return undefined;
  if (auth.type === 'bearer') return { key: 'Authorization', value: `Bearer ${authValues(auth)[0]}`, on: true };
  if (auth.type === 'basic') {
    const [u, p] = authValues(auth);
    // base64 of the pair is a literal credential whatever it holds: the scrub step turns it into {{authorization}}
    return { key: 'Authorization', value: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`, on: true };
  }
  out.skip.push({ name, reason: `auth type "${String(auth.type)}" is not supported (bearer and basic only)` });
  return null;
}
function postmanBody(b: unknown, name: string, out: Parsed): Body | null {
  if (!isObj(b) || !b.mode || b.mode === 'none') return { kind: 'none' };
  if (b.mode === 'raw') {
    const raw = typeof b.raw === 'string' ? b.raw : '';
    const lang = isObj(b.options) && isObj(b.options.raw) ? b.options.raw.language : undefined;
    const j = lang === 'json' ? tryJson(raw) : undefined;
    return j !== undefined ? { kind: 'json', value: j } : { kind: 'text', value: raw };
  }
  if (b.mode === 'urlencoded') return { kind: 'form', fields: (Array.isArray(b.urlencoded) ? b.urlencoded : []).filter(isObj).filter((f) => typeof f.key === 'string').map((f) => ({ key: f.key as string, value: String(f.value ?? ''), on: f.disabled !== true })) };
  const reason = b.mode === 'formdata' || b.mode === 'file' ? 'form-data bodies (file upload) are not supported' : b.mode === 'graphql' ? 'GraphQL is not supported' : `body mode "${String(b.mode)}" is not supported`;
  out.skip.push({ name, reason });
  return null;
}
function fromPostman(text: string): Parsed {
  const doc = tryJson(text);
  if (!isObj(doc) || !isObj(doc.info) || typeof doc.info.schema !== 'string' || !doc.info.schema.includes('v2.1')) throw new Error('not a Postman v2.1 collection');
  const out = empty();
  /** Variables a credential header or a bearer/basic auth block refers to: their values must not reach _collection.json. */
  const credentialVars = new Set<string>();
  const noteAuth = (auth: unknown) => authValues(auth).forEach((v) => varRefs(v).forEach((n) => credentialVars.add(n)));
  noteAuth(doc.auth);
  const walk = (items: unknown[], folder: string[], inherited: unknown) => {
    for (const it of items) {
      if (!isObj(it)) continue;
      const name = typeof it.name === 'string' && it.name.trim() ? it.name.trim() : 'untitled';
      if (Array.isArray(it.item)) {
        noteAuth(it.auth);
        if (folder.length >= 4) out.skip.push({ name, reason: 'folders nest deeper than 4' });
        else walk(it.item, [...folder, slugify(name)], it.auth ?? inherited);
        continue;
      }
      if (out.requests.length >= MAX_ITEMS) {
        out.skip.push({ name, reason: `more than ${MAX_ITEMS} requests` });
        continue;
      }
      const r = it.request;
      if (!isObj(r)) {
        out.skip.push({ name, reason: 'no request' });
        continue;
      }
      noteAuth(r.auth);
      const headers: KV[] = (Array.isArray(r.header) ? r.header : []).filter(isObj).filter((h) => typeof h.key === 'string').map((h) => ({ key: h.key as string, value: String(h.value ?? ''), on: h.disabled !== true }));
      for (const h of headers) if (isCredentialHeader(h.key)) varRefs(h.value).forEach((n) => credentialVars.add(n));
      const url = typeof r.url === 'string' ? r.url : isObj(r.url) && typeof r.url.raw === 'string' ? r.url.raw : undefined;
      if (!url) {
        out.skip.push({ name, reason: 'no URL' });
        continue;
      }
      const auth = postmanAuth(r.auth ?? inherited, name, out);
      if (auth === null) continue;
      const body = postmanBody(r.body, name, out);
      if (body === null) continue;
      if (auth) headers.push(auth);
      out.requests.push({ folder, name, file: { v: 1, name, method: String(r.method ?? 'GET').toUpperCase(), url, headers, body, ...(typeof r.description === 'string' ? { notes: r.description } : {}) } });
    }
  };
  walk(Array.isArray(doc.item) ? doc.item : [], [], doc.auth);
  const vars: Record<string, string> = {};
  for (const v of Array.isArray(doc.variable) ? doc.variable : []) {
    if (!isObj(v) || typeof v.key !== 'string' || !VAR_RE.test(v.key)) continue;
    const value = String(v.value ?? '');
    if (value && credentialVars.has(v.key)) {
      // left out entirely: collection vars resolve before secrets, so even a blank entry would hide the secret
      out.warnings.push(`collection variable "${v.key}" holds a credential and was not imported (files are committed); store it with: aorch http secret set ${v.key}`);
    } else vars[v.key] = value;
  }
  if (Object.keys(vars).length) out.collections.unshift({ folder: [], file: { vars, headers: [] } });
  return out;
}

// ---------- shared ----------
/** A literal value in a credential header becomes {{<header name>}}; the person stores the real value as a secret. */
function scrubCredentials(file: Record<string, unknown>, name: string, warnings: string[]): Record<string, unknown> {
  const headers = (Array.isArray(file.headers) ? file.headers : []) as KV[];
  return {
    ...file,
    headers: headers.map((h) => {
      if (!isCredentialHeader(h.key) || varRefs(h.value).length || !h.value) return h;
      const v = h.key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      warnings.push(`"${name}": the ${h.key} value was not imported (files are committed); store it with: aorch http secret set ${v}`);
      return { ...h, value: `{{${v}}}` };
    }),
  };
}

export function previewImport(kind: ImportKind, text: string, o: { into?: string; exists?: (id: string) => boolean } = {}): ImportPreview {
  try {
    const prefix = checkPath(o.into ?? '', 'collection');
    const p = kind === 'curl' ? fromCurl(text) : kind === 'openapi' ? fromOpenApi(text) : fromPostman(text);
    const taken = new Set<string>();
    const create: ImportPreview['create'] = [];
    const skip = [...p.skip];
    const warnings = [...p.warnings];
    for (const r of p.requests) {
      const folder = [...prefix, ...r.folder].slice(0, 4);
      const base = slugify(r.name);
      let id = [...folder, base].join('/');
      for (let n = 2; taken.has(id) || o.exists?.(id); n++) id = [...folder, `${base.slice(0, 60)}-${n}`].join('/');
      try {
        create.push({ id, file: parseRequest(scrubCredentials(r.file, r.name, warnings)) });
        taken.add(id);
      } catch (e) {
        skip.push({ name: r.name, reason: (e as Error).message });
      }
    }
    return { create, collections: p.collections.map((c) => ({ path: [...prefix, ...c.folder].join('/'), file: c.file })), skip, warnings };
  } catch (e) {
    return { create: [], collections: [], skip: [], warnings: [], error: (e as Error).message };
  }
}

/**
 * Write a preview. Never overwrites: a request id that already exists is not written and is added to `preview.skip`
 * with reason "exists". Collection vars and headers are merged, existing values win. Returns the ids written.
 */
export function applyImport(dir: string, preview: ImportPreview): string[] {
  for (const c of preview.collections) {
    const cur = readCollection(dir, c.path);
    const names = new Set(cur.headers.map((h) => h.key.toLowerCase()));
    writeCollection(dir, c.path, { vars: { ...c.file.vars, ...cur.vars }, headers: [...cur.headers, ...c.file.headers.filter((h) => !names.has(h.key.toLowerCase()))] });
  }
  const created: string[] = [];
  for (const r of preview.create) {
    if (requestExists(dir, r.id)) {
      preview.skip.push({ name: r.id, reason: 'exists' });
      continue;
    }
    writeRequest(dir, r.id, r.file);
    created.push(r.id);
  }
  return created;
}
