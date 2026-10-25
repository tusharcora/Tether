/**
 * Secrets for saved requests: <home>/secrets.json, mode 0600, written atomically. Values never leave this module except
 * to resolve a request; everything else gets key names only.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpClientError } from './errors.js';
import { SECRET_KEY_RE, isObj } from './types.js';

export const SCOPE_RE = /^(default|[a-z][a-z0-9_-]{0,31})$/;
interface SecretsFile {
  v: 1;
  scopes: Record<string, Record<string, string>>;
}

export const secretsPath = (home: string): string => join(home, 'secrets.json');

function load(home: string): SecretsFile {
  const f = secretsPath(home);
  if (!existsSync(f)) return { v: 1, scopes: {} };
  if (process.platform !== 'win32' && (statSync(f).mode & 0o077) !== 0) throw new HttpClientError('secrets_file', `${f} can be read by other users; fix it with: chmod 600 ${f}`);
  let j: { scopes?: unknown };
  try {
    j = JSON.parse(readFileSync(f, 'utf8')) as { scopes?: unknown };
  } catch {
    // never pass on the parser's message: it quotes the file, and the file holds secret values
    throw new HttpClientError('secrets_file', `${f} is not a valid secrets file (not valid JSON)`);
  }
  if (!j || typeof j.scopes !== 'object' || j.scopes === null || Array.isArray(j.scopes)) throw new HttpClientError('secrets_file', `${f} is not a valid secrets file (no "scopes" object)`);
  return { v: 1, scopes: j.scopes as SecretsFile['scopes'] };
}

function save(home: string, s: SecretsFile): void {
  mkdirSync(home, { recursive: true });
  const f = secretsPath(home);
  const tmp = `${f}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
    chmodSync(tmp, 0o600); // the mode option is filtered by the umask
    renameSync(tmp, f);
  } catch (e) {
    rmSync(tmp, { force: true }); // never leave a stray copy of the secrets behind
    throw e;
  }
}

const scopeOk = (scope: string) => {
  if (!SCOPE_RE.test(scope)) throw new HttpClientError('invalid', `invalid secrets scope "${scope}"`);
};
const keyOk = (key: string) => {
  if (!SECRET_KEY_RE.test(key)) throw new HttpClientError('invalid', 'invalid secret key (letters, digits and _, at most 64, not starting with a digit)');
};

export function loadSecrets(home: string, scope: string): Record<string, string> {
  scopeOk(scope);
  const s = load(home).scopes[scope];
  if (!s || typeof s !== 'object') return {};
  return Object.fromEntries(Object.entries(s).filter(([k, v]) => SECRET_KEY_RE.test(k) && typeof v === 'string'));
}

export const secretKeys = (home: string, scope: string): string[] => Object.keys(loadSecrets(home, scope)).sort();

export function setSecret(home: string, scope: string, key: string, value: string): void {
  scopeOk(scope);
  keyOk(key);
  if (typeof value !== 'string' || !value || value.length > 8192) throw new HttpClientError('invalid', 'a secret value must be 1–8192 characters');
  const s = load(home);
  s.scopes[scope] = { ...(s.scopes[scope] ?? {}), [key]: value };
  save(home, s);
}

export function deleteSecret(home: string, scope: string, key: string): boolean {
  scopeOk(scope);
  keyOk(key);
  const s = load(home);
  const cur = Object.hasOwn(s.scopes, scope) ? s.scopes[scope] : undefined;
  if (!isObj(cur) || !Object.hasOwn(cur, key)) return false;
  const { [key]: _gone, ...rest } = cur;
  void _gone;
  s.scopes[scope] = rest;
  save(home, s);
  return true;
}
