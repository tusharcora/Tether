import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HttpClientError } from '../src/http/errors.js';
import { deleteSecret, loadSecrets, secretKeys, secretsPath, setSecret } from '../src/http/secrets.js';
import { tmp } from './helpers.js';

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
});
