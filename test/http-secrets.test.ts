import { chmodSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { HttpClientError } from '../src/http/errors.js';
import { activeEnv, setActiveEnv } from '../src/http/index.js';
import { deleteScope, deleteSecret, loadSecrets, secretKeys, secretsPath, setSecret } from '../src/http/secrets.js';
import { initWorkspace, removeWorkspace } from '../src/workspace.js';
import { tmp } from './helpers.js';

// pass-through, so one test can make the atomic rename fail
vi.mock('node:fs', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs')>();
  return { ...m, renameSync: vi.fn(m.renameSync) };
});

describe('secrets', () => {
  it('stores values per scope in a 0600 file and lists keys only', () => {
    const home = tmp('home-');
    setSecret(home, 'api', 'aorch_token', 't0k');
    setSecret(home, 'default', 'aorch_token', 'other');
    expect(statSync(secretsPath(home)).mode & 0o777).toBe(0o600);
    expect(secretKeys(home, 'api')).toEqual(['aorch_token']);
    expect(loadSecrets(home, 'api')).toEqual({ aorch_token: 't0k' });
    expect(JSON.parse(readFileSync(secretsPath(home), 'utf8'))).toEqual({ v: 1, scopes: { api: { aorch_token: 't0k' }, default: { aorch_token: 'other' } } });
    expect(deleteSecret(home, 'api', 'aorch_token')).toBe(true);
    expect(deleteSecret(home, 'api', 'aorch_token')).toBe(false);
    expect(secretKeys(home, 'api')).toEqual([]);
  });

  it('refuses a file other users can read, with the chmod fix', () => {
    const home = tmp('home-');
    setSecret(home, 'api', 'k', 'v');
    chmodSync(secretsPath(home), 0o644);
    try {
      loadSecrets(home, 'api');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpClientError);
      expect((e as HttpClientError).code).toBe('secrets_file');
      expect((e as Error).message).toContain(`chmod 600 ${secretsPath(home)}`);
    }
  });

  it('refuses bad keys, scopes and empty values, and reports a corrupt file', () => {
    const home = tmp('home-');
    expect(() => setSecret(home, 'api', '1bad', 'v')).toThrow(/invalid secret key/);
    expect(() => setSecret(home, '../x', 'k', 'v')).toThrow(/invalid secrets scope/);
    expect(() => setSecret(home, 'api', 'k', '')).toThrow(/1–8192/);
    writeFileSync(secretsPath(home), '{ nope', { mode: 0o600 });
    expect(() => loadSecrets(home, 'api')).toThrow(/not a valid secrets file/);
  });

  it('does not treat Object.prototype members as stored keys, and does not rewrite the file for them', () => {
    const home = tmp('home-');
    setSecret(home, 'api', 'k', 'v');
    const before = statSync(secretsPath(home)).ino;
    expect(deleteSecret(home, 'api', 'constructor')).toBe(false);
    expect(deleteSecret(home, 'api', 'toString')).toBe(false);
    expect(deleteSecret(home, 'constructor', 'k')).toBe(false);
    expect(statSync(secretsPath(home)).ino).toBe(before);
    expect(loadSecrets(home, 'api')).toEqual({ k: 'v' });
  });

  it('removes its temp file when the atomic write fails', () => {
    const home = tmp('home-');
    setSecret(home, 'api', 'k', 'v');
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error('disk on fire');
    });
    expect(() => setSecret(home, 'api', 'k2', 'v2')).toThrow('disk on fire');
    expect(readdirSync(home).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(loadSecrets(home, 'api')).toEqual({ k: 'v' });
  });

  it('never quotes the file contents (which hold secret values) when it is corrupt', () => {
    const home = tmp('home-');
    writeFileSync(secretsPath(home), '{"scopes":{"api":{"k":hunter2}}}', { mode: 0o600 });
    let m = '';
    try {
      loadSecrets(home, 'api');
    } catch (e) {
      m = (e as Error).message;
    }
    expect(m).toMatch(/not a valid secrets file/);
    expect(m).not.toContain('hunter2');
  });

  it('deleteScope drops one scope and leaves the others', () => {
    const home = tmp('home-');
    setSecret(home, 'api', 'a', '1');
    setSecret(home, 'web', 'b', '2');
    expect(deleteScope(home, 'api')).toBe(true);
    expect(deleteScope(home, 'api')).toBe(false);
    expect(loadSecrets(home, 'api')).toEqual({});
    expect(loadSecrets(home, 'web')).toEqual({ b: '2' });
    expect(statSync(secretsPath(home)).mode & 0o777).toBe(0o600);
  });

  it('removing a workspace deletes its secrets and its active environment', () => {
    const home = tmp('home-');
    initWorkspace(home, tmp('a-'), { id: 'api', write: false });
    initWorkspace(home, tmp('b-'), { id: 'web', write: false });
    setSecret(home, 'api', 'tok', 'S3CRET-gone');
    setSecret(home, 'web', 'tok', 'S3CRET-kept');
    setActiveEnv(home, 'api', 'local');
    setActiveEnv(home, 'web', 'prod');
    expect(removeWorkspace(home, 'api')).toBe(true);
    expect(loadSecrets(home, 'api')).toEqual({});
    expect(readFileSync(secretsPath(home), 'utf8')).not.toContain('S3CRET-gone');
    expect(activeEnv(home, 'api')).toBeNull();
    expect(loadSecrets(home, 'web')).toEqual({ tok: 'S3CRET-kept' });
    expect(activeEnv(home, 'web')).toBe('prod');
  });
});
