import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyImport, previewImport, shellWords } from '../src/http/import.js';
import { httpRoot, readCollection, readRequest, requestExists, writeCollection, writeRequest } from '../src/http/store.js';
import { tmp } from './helpers.js';

const fx = (f: string) => readFileSync(new URL(`./fixtures/http/${f}`, import.meta.url), 'utf8');
/** Every file under .aorch/http, as text. */
const writtenFiles = (dir: string) =>
  readdirSync(httpRoot(dir), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'));

describe('cURL import', () => {
  it('splits shell words with quotes, escapes and line continuations', () => {
    expect(shellWords(`curl -H 'A: b c' "x\\"y" a\\ b \\\n --url u`)).toEqual(['curl', '-H', 'A: b c', 'x"y', 'a b', '--url', 'u']);
  });

  it('reads method, headers, JSON data and the URL', () => {
    const p = previewImport('curl', `curl -X PUT 'http://h/api/x?y=1' -H 'Content-Type: application/json' --data-raw '{"a":1}' --compressed`);
    expect(p.error).toBeUndefined();
    expect(p.create).toHaveLength(1);
    expect(p.create[0]).toMatchObject({ id: 'put-api-x', file: { name: 'PUT /api/x', method: 'PUT', url: 'http://h/api/x?y=1', body: { kind: 'json', value: { a: 1 } }, headers: [{ key: 'Content-Type', value: 'application/json', on: true }] } });
    expect(previewImport('curl', 'curl http://h/a -d x=1 -d y=2').create[0]!.file).toMatchObject({ method: 'POST', body: { kind: 'text', value: 'x=1&y=2' } });
  });

  it('never writes a literal credential: it becomes a variable and a warning', () => {
    const p = previewImport('curl', `curl https://api.example/me -H 'X-Api-Key: k123' -u me:pw`);
    const f = p.create[0]!.file;
    expect(JSON.stringify(f)).not.toMatch(/k123|bWU6cHc=/);
    expect(f.headers).toEqual([
      { key: 'X-Api-Key', value: '{{x_api_key}}', on: true },
      { key: 'Authorization', value: '{{authorization}}', on: true },
    ]);
    expect(p.warnings.join('\n')).toMatch(/aorch http secret set authorization/);
    expect(p.warnings.join('\n')).toMatch(/aorch http secret set x_api_key/);
    const bearer = previewImport('curl', `curl https://api.example/me -H 'Authorization: Bearer abc.def'`).create[0]!.file;
    expect(JSON.stringify(bearer)).not.toContain('abc.def');
  });

  it('Cookie and Proxy-Authorization literals become variables too', () => {
    const p = previewImport('curl', `curl https://api.example/me -H 'Cookie: sid=s3cr3t' -H 'Proxy-Authorization: Basic cHJveHk='`);
    expect(JSON.stringify(p.create[0]!.file)).not.toMatch(/s3cr3t|cHJveHk=/);
    expect(p.create[0]!.file.headers).toEqual([
      { key: 'Cookie', value: '{{cookie}}', on: true },
      { key: 'Proxy-Authorization', value: '{{proxy_authorization}}', on: true },
    ]);
    expect(p.warnings.join('\n')).toMatch(/aorch http secret set cookie/);
    expect(p.warnings.join('\n')).toMatch(/aorch http secret set proxy_authorization/);
  });

  it('reports a parse failure and creates nothing', () => {
    expect(previewImport('curl', 'wget http://h')).toMatchObject({ create: [], error: 'not a curl command (it must start with "curl")' });
    expect(previewImport('curl', `curl 'http://h`).error).toBe('unclosed single quote');
    expect(previewImport('curl', 'curl -H "A: b"').error).toBe('no URL in the curl command');
  });
});

describe('OpenAPI import', () => {
  it('3.0 YAML: one request per operation, folders by first tag, {{base}} from servers[0]', () => {
    const p = previewImport('openapi', fx('openapi-3.0.yaml'));
    expect(p.error).toBeUndefined();
    expect(p.collections).toEqual([{ path: '', file: { vars: { base: 'http://127.0.0.1:4177' }, headers: [] } }]);
    expect(p.create.map((c) => [c.id, c.file.method, c.file.url])).toEqual([
      ['runs/list-runs', 'GET', '{{base}}/api/runs'],
      ['runs/start-a-team-run', 'POST', '{{base}}/api/runs'],
      ['runs/getrun', 'GET', '{{base}}/api/runs/{{id}}'],
      ['get-health', 'GET', '{{base}}/health'],
    ]);
    const list = p.create[0]!.file;
    expect(list.query).toEqual([{ key: 'limit', value: '20', on: false }]);
    expect(list.notes).toBe('All runs, newest first.');
    expect(p.create[1]!.file.body).toEqual({ kind: 'json', value: { kind: 'team', task: 'Add caching', repo: '/code/app' } });
    expect(p.create[2]!.file).toMatchObject({ vars: { id: 'r1' }, headers: [{ key: 'X-Trace', value: '', on: true }] });
  });

  it('3.1 JSON with examples, a missing servers list warns, and junk is an error', () => {
    const p = previewImport('openapi', fx('openapi-3.1.json'), { into: 'mini' });
    expect(p.create[0]).toMatchObject({ id: 'mini/create-item', file: { body: { kind: 'json', value: { name: 'a' } } } });
    expect(p.warnings).toContain('the document has no servers: set the "base" variable in an environment');
    expect(previewImport('openapi', 'swagger: "2.0"').error).toBe('not an OpenAPI 3.0 or 3.1 document');
    expect(previewImport('openapi', ': : :').error).toMatch(/.+/);
  });
});

describe('Postman import', () => {
  it('folders, requests, collection variables, bearer auth kept as a var, basic auth left out, unsupported skipped', () => {
    const p = previewImport('postman', fx('postman-2.1.json'));
    expect(p.error).toBeUndefined();
    expect(p.collections).toEqual([{ path: '', file: { vars: { base: 'https://shop.example', token: '' }, headers: [] } }]);
    const byId = Object.fromEntries(p.create.map((c) => [c.id, c.file]));
    expect(Object.keys(byId)).toEqual(['orders/list-orders', 'orders/create-order', 'login']);
    expect(byId['orders/list-orders']).toMatchObject({ url: '{{base}}/orders?limit=5', headers: [{ key: 'Accept', value: 'application/json', on: true }, { key: 'Authorization', value: 'Bearer {{token}}', on: true }] });
    expect(byId['orders/create-order']!.body).toEqual({ kind: 'json', value: { sku: 'a1' } });
    expect(byId.login!.body).toEqual({ kind: 'form', fields: [{ key: 'remember', value: '1', on: true }] });
    expect(JSON.stringify(byId.login)).not.toContain('hunter2');
    expect(byId.login!.headers).toContainEqual({ key: 'Authorization', value: '{{authorization}}', on: true });
    expect(p.skip).toEqual([
      { name: 'Upload', reason: 'form-data bodies (file upload) are not supported' },
      { name: 'OAuth thing', reason: 'auth type "oauth2" is not supported (bearer and basic only)' },
    ]);
  });

  it('a collection variable used by auth is written blank, with a warning, and its value lands in no file', () => {
    const p = previewImport('postman', fx('postman-2.1.json'));
    expect(p.warnings.join('\n')).toMatch(/variable "token".*aorch http secret set token/);
    expect(p.warnings.join('\n')).not.toMatch(/variable "base"/);
    const dir = tmp('proj-');
    expect(applyImport(dir, p)).toEqual(['orders/list-orders', 'orders/create-order', 'login']);
    const files = writtenFiles(dir);
    expect(files).toHaveLength(4); // _collection.json + 3 requests
    for (const text of files) {
      expect(text).not.toContain('tok-live-9f8e7d');
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain(Buffer.from('me:hunter2').toString('base64'));
    }
    expect(readCollection(dir, '').vars).toEqual({ base: 'https://shop.example', token: '' });
  });

  it('refuses a document that is not Postman v2.1', () => {
    expect(previewImport('postman', JSON.stringify({ info: { schema: 'v2.0' } })).error).toBe('not a Postman v2.1 collection');
  });
});

describe('apply', () => {
  it('never overwrites: ids avoid existing files, and existing collection vars win', () => {
    const dir = tmp('proj-');
    writeRequest(dir, 'runs/list-runs', { name: 'mine', method: 'GET', url: 'http://keep' });
    writeCollection(dir, '', { vars: { base: 'http://mine' } });
    const p = previewImport('openapi', fx('openapi-3.0.yaml'), { exists: (id) => requestExists(dir, id) });
    expect(p.create[0]!.id).toBe('runs/list-runs-2');
    const created = applyImport(dir, p);
    expect(created).toHaveLength(4);
    expect(readRequest(dir, 'runs/list-runs').file?.url).toBe('http://keep');
    expect(readCollection(dir, '').vars.base).toBe('http://mine');
  });

  it('an id that exists at apply time is skipped with reason "exists" and not written', () => {
    const dir = tmp('proj-');
    const p = previewImport('openapi', fx('openapi-3.0.yaml'));
    expect(p.create[0]!.id).toBe('runs/list-runs');
    writeRequest(dir, 'runs/list-runs', { name: 'mine', method: 'GET', url: 'http://keep' });
    const created = applyImport(dir, p);
    expect(created).toEqual(['runs/start-a-team-run', 'runs/getrun', 'get-health']);
    expect(p.skip).toContainEqual({ name: 'runs/list-runs', reason: 'exists' });
    expect(readRequest(dir, 'runs/list-runs').file).toMatchObject({ name: 'mine', url: 'http://keep' });
  });
});
