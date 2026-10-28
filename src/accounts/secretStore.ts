/**
 * Where account tokens live: the macOS Keychain (service `dev.tether.app`, one item per provider) through the `security`
 * CLI, or elsewhere a 0600 file per provider in <home>/secrets/ (the same rule as the API client's secrets file). Values
 * reach `security` over stdin (`security -i`), never on argv where `ps` would show them, and never leave this module
 * except to the caller that asked for them.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runProcess } from '../proc.js';

export const KEYCHAIN_SERVICE = 'dev.tether.app';
/** `security` exits 44 when the item does not exist. */
const NOT_FOUND = 44;
const ACCOUNT_RE = /^[a-z][a-z0-9_-]{0,31}$/;
/** Token characters `security -i` takes inside double quotes without escaping (OAuth tokens are far narrower). */
const VALUE_RE = /^[\x21\x23-\x5b\x5d-\x7e]{1,4096}$/;

export interface SecretStore {
  kind: 'keychain' | 'file';
  get(account: string): Promise<string | undefined>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
}

const checkAccount = (a: string) => {
  if (!ACCOUNT_RE.test(a)) throw new Error(`invalid secret account "${a}"`);
};

/** The Keychain through `security` (`bin` is a fake in tests). Errors never carry the command's output. */
export function keychainStore(bin = 'security'): SecretStore {
  const run = (args: string[], stdin?: string) => runProcess({ cmd: bin, args, cwd: process.cwd(), stdin, signal: AbortSignal.timeout(15_000) });
  const fail = (what: string, r: { code: number | null; spawnError?: string }) => new Error(`Keychain ${what} failed (${r.spawnError ? 'security not found' : `exit ${r.code}`})`);
  return {
    kind: 'keychain',
    async get(account) {
      checkAccount(account);
      const r = await run(['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w']);
      if (r.code === NOT_FOUND) return undefined;
      if (r.code !== 0) throw fail('read', r);
      return r.stdout.replace(/\r?\n$/, '') || undefined;
    },
    async set(account, value) {
      checkAccount(account);
      if (!VALUE_RE.test(value)) throw new Error('this token has characters the Keychain store does not take');
      // -U updates an existing item; the line goes over stdin so the value is never on a command line
      const r = await run(['-i'], `add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${account} -w "${value}"\n`);
      if (r.code !== 0) throw fail('write', r);
    },
    async delete(account) {
      checkAccount(account);
      const r = await run(['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account]);
      if (r.code !== 0 && r.code !== NOT_FOUND) throw fail('delete', r);
    },
  };
}

/** A 0600 file per account in <home>/secrets/ (folder 0700); refuses a file other users can read. */
export function fileStore(home: string): SecretStore {
  const dir = join(home, 'secrets');
  const file = (a: string) => (checkAccount(a), join(dir, a));
  return {
    kind: 'file',
    async get(account) {
      const f = file(account);
      if (!existsSync(f)) return undefined;
      if (process.platform !== 'win32' && (statSync(f).mode & 0o077) !== 0) throw new Error(`${f} can be read by other users; fix it with: chmod 600 ${f}`);
      return readFileSync(f, 'utf8').trim() || undefined;
    },
    async set(account, value) {
      const f = file(account);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(f, value, { mode: 0o600 });
      chmodSync(f, 0o600); // the mode option is filtered by the umask
    },
    async delete(account) {
      rmSync(file(account), { force: true });
    },
  };
}

/** The Keychain on a Mac, the 0600 file elsewhere. */
export const defaultStore = (home: string, platform: NodeJS.Platform = process.platform): SecretStore => (platform === 'darwin' ? keychainStore() : fileStore(home));
