/** Folders a person has said yes or no to, keyed by real path so a symlink and its target are one folder. */
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Book = Record<string, boolean>;
const file = (home: string) => join(home, 'trust.json');

function load(home: string): Book {
  try {
    const j: unknown = JSON.parse(readFileSync(file(home), 'utf8'));
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    return Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === 'boolean'));
  } catch {
    return {}; // missing or corrupt: nothing is trusted
  }
}

function save(home: string, book: Book) {
  mkdirSync(home, { recursive: true });
  const tmp = `${file(home)}.tmp`;
  writeFileSync(tmp, JSON.stringify(book, null, 2) + '\n', { mode: 0o600 });
  chmodSync(tmp, 0o600); // a leftover temp file keeps its old mode otherwise
  renameSync(tmp, file(home));
}

const real = (folder: string): string | undefined => {
  try {
    return realpathSync(folder);
  } catch {
    return undefined;
  }
};

/** A folder that is gone (deleted or renamed) is unknown, whatever was said about its old path. */
export function trustState(home: string, folder: string): 'trusted' | 'refused' | 'unknown' {
  const r = real(folder);
  const v = r === undefined ? undefined : load(home)[r];
  return v === undefined ? 'unknown' : v ? 'trusted' : 'refused';
}

export function setTrust(home: string, folder: string, trusted: boolean): void {
  save(home, { ...load(home), [realpathSync(folder)]: trusted });
}

export function clearTrust(home: string, folder: string): void {
  const book = load(home);
  delete book[real(folder) ?? resolve(folder)];
  save(home, book);
}

export function listTrust(home: string): { folder: string; trusted: boolean; exists: boolean }[] {
  return Object.entries(load(home)).map(([folder, trusted]) => ({ folder, trusted, exists: existsSync(folder) }));
}
