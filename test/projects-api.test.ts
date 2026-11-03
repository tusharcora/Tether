import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_PINS } from '../src/pins.js';
import { startHttpTestServer } from './http-helpers.js';
import { makeRepo, tmp } from './helpers.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});
const start = async () => {
  const s = await startHttpTestServer({ register: false });
  close = s.close;
  return s;
};

describe('projects: register and remove folders', () => {
  it('registers a folder without writing into it, and again gives the same project', async () => {
    const { api } = await start();
    const dir = makeRepo();
    const r = await api('POST', '/api/workspaces', { path: dir });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ path: realpathSync(dir), exists: true, isDefault: true });
    expect(Object.keys(r.json).sort()).toEqual(['exists', 'id', 'isDefault', 'name', 'path', 'repos']);
    expect(existsSync(join(dir, '.aorch'))).toBe(false);
    const again = await api('POST', '/api/workspaces', { path: dir });
    expect(again.status).toBe(200);
    expect(again.json.id).toBe(r.json.id);
    expect((await api('GET', '/api/workspaces')).json).toHaveLength(1);
  });

  it('refuses a relative path, a missing folder, a file and the folder holding the home', async () => {
    const { api } = await start();
    expect((await api('POST', '/api/workspaces', { path: 'code/app' })).status).toBe(400);
    expect((await api('POST', '/api/workspaces', {})).status).toBe(400);
    expect((await api('POST', '/api/workspaces', { path: join(tmp(), 'gone') })).json.error).toMatch(/does not exist/);
    const file = join(tmp(), 'f.txt');
    writeFileSync(file, 'x');
    expect((await api('POST', '/api/workspaces', { path: file })).json.error).toMatch(/not a folder/);
    const base = realpathSync(tmp('user-'));
    mkdirSync(join(base, '.aorch'));
    const s2 = await startHttpTestServer({ register: false, home: join(base, '.aorch') });
    try {
      const r = await s2.api('POST', '/api/workspaces', { path: base });
      expect(r.status).toBe(400);
      expect(r.json.error).toMatch(/aorch home/);
    } finally {
      await s2.close();
    }
  });

  it('removes a project from the registry and leaves its folder alone', async () => {
    const { api } = await start();
    const dir = makeRepo();
    const { json } = await api('POST', '/api/workspaces', { path: dir });
    expect((await api('DELETE', `/api/workspaces/${json.id}`)).status).toBe(200);
    expect((await api('GET', '/api/workspaces')).json).toEqual([]);
    expect(existsSync(join(dir, 'README.md'))).toBe(true);
    expect((await api('DELETE', `/api/workspaces/${json.id}`)).status).toBe(404);
  });
});

describe('pins', () => {
  it('starts empty, saves to pins.json and reads back', async () => {
    const { api, home } = await start();
    expect((await api('GET', '/api/pins')).json).toEqual({ pins: [] });
    const pins = [
      { kind: 'run', id: 'r-1', label: 'Add rate limiting' },
      { kind: 'request', id: 'crew/list', label: 'List crew', ws: 'api' },
      { kind: 'workflow', id: 'plan-code-review', label: 'plan-code-review' },
      { kind: 'file', id: 'README.md', label: 'README.md', ws: 'api' },
    ];
    expect((await api('PUT', '/api/pins', { pins })).json).toEqual({ pins });
    expect((await api('GET', '/api/pins')).json).toEqual({ pins });
    expect(JSON.parse(readFileSync(join(home, 'pins.json'), 'utf8'))).toEqual({ pins });
  });

  it('refuses malformed pins and too many of them', async () => {
    const { api } = await start();
    for (const bad of [{}, { pins: 'x' }, { pins: [{ kind: 'note', id: 'a', label: 'a' }] }, { pins: [{ kind: 'run', id: '', label: 'a' }] }, { pins: [{ kind: 'run', id: 'a', label: 'x'.repeat(201) }] }])
      expect((await api('PUT', '/api/pins', bad)).status, JSON.stringify(bad)).toBe(400);
    const many = Array.from({ length: MAX_PINS + 1 }, (_, i) => ({ kind: 'run', id: `r${i}`, label: 'r' }));
    expect((await api('PUT', '/api/pins', { pins: many })).status).toBe(400);
  });
});

describe('tools', () => {
  it('lists each agent CLI with found or not (never the mock adapter), and ripgrep', async () => {
    const { api } = await start();
    const r = await api('GET', '/api/tools');
    expect(r.status).toBe(200);
    expect(r.json.agents).toEqual([]);
    expect(typeof r.json.rg.ok).toBe('boolean');
  });
});

describe('trust routes', () => {
  it('lists the projects not yet answered, by real path, until they are', async () => {
    const { api, base } = await start();
    const dir = mkdtempSync(join(tmpdir(), 'aorch-trustask-'));
    const gone = mkdtempSync(join(tmpdir(), 'aorch-trustgone-'));
    const name = (await api('POST', '/api/workspaces', { path: dir })).json.name;
    await api('POST', '/api/workspaces', { path: gone });
    rmSync(gone, { recursive: true });
    const row = [{ folder: realpathSync(dir), name }];
    expect((await api('GET', '/api/trust')).json.unanswered).toEqual(row);
    expect((await api('PUT', '/api/trust', { folder: realpathSync(dir), trusted: true })).json.unanswered).toEqual([]);
    const del = await fetch(`${base}/api/trust`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: dir }) });
    expect((await del.json()).unanswered).toEqual(row);
    expect((await api('PUT', '/api/trust', { folder: dir, trusted: false })).json.unanswered).toEqual([]);
  });

  it('trusts a real folder, lists it, withdraws it, and refuses bad input', async () => {
    const { api, base } = await start();
    const dir = mkdtempSync(join(tmpdir(), 'aorch-trustapi-'));
    expect((await api('PUT', '/api/trust', { folder: dir, trusted: true })).status).toBe(200);
    expect((await api('GET', '/api/trust')).json.folders).toEqual([{ folder: realpathSync(dir), trusted: true, exists: true }]);
    expect((await api('PUT', '/api/trust', { folder: join(dir, 'nope'), trusted: true })).status).toBe(400);
    expect((await api('PUT', '/api/trust', { folder: 5, trusted: true })).status).toBe(400);
    expect((await api('PUT', '/api/trust', { folder: dir, trusted: 'yes' })).status).toBe(400);
    // the http helper sends a DELETE body without a length, so use fetch
    const del = await fetch(`${base}/api/trust`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder: dir }) });
    expect(del.status).toBe(200);
    expect((await api('GET', '/api/trust')).json.folders).toEqual([]);
  });
});
