import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
