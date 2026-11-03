/** Folders a person has said yes or no to, keyed by real path so a symlink and its target are one folder. */
import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** dev, ino and birth pin the folder itself: a new folder at the same path is not the one that was trusted, even when Linux hands it the old inode. */
type Entry = { trusted: boolean; dev: number; ino: number; birth?: number };
type Book = Record<string, Entry>;

export { NOT_TRUSTED } from './runLabels.js';
const file = (home: string) => join(home, 'trust.json');

const isEntry = (v: unknown): v is Entry => !!v && typeof v === 'object' && typeof (v as Entry).trusted === 'boolean' && typeof (v as Entry).dev === 'number' && typeof (v as Entry).ino === 'number';

function load(home: string): Book {
  try {
    const j: unknown = JSON.parse(readFileSync(file(home), 'utf8'));
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    return Object.fromEntries(Object.entries(j).filter(([, v]) => isEntry(v))) as Book;
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

const same = (folder: string, e: Entry) => {
  try {
    const st = statSync(folder);
    // shortcut: birth ticks every few ms, so a folder deleted and remade within one tick of its own creation passes; nobody says yes that fast, and commandRule stops mistakes, not a hostile project
    // birth is 0 on a filesystem without one, so there dev and ino decide. Only a yes needs proving: a no must outlive anything that moves birth, like setting an older mtime on macOS, and a record from before birth was kept can't prove a yes.
    return st.dev === e.dev && st.ino === e.ino && (!e.trusted || st.birthtimeMs === e.birth);
  } catch {
    return false;
  }
};

/** A folder that is gone (deleted, renamed or replaced by another) is unknown, whatever was said about its old path. */
export function trustState(home: string, folder: string): 'trusted' | 'refused' | 'unknown' {
  const r = real(folder);
  const e = r === undefined ? undefined : load(home)[r];
  return !e || !same(r!, e) ? 'unknown' : e.trusted ? 'trusted' : 'refused';
}

/** A run's commands stay off: its folder said no, or the person said Not now for this run and has not said yes since. */
export function commandsOff(home: string, run: { repo: string; noCommands?: true }): boolean {
  const t = trustState(home, run.repo);
  return t === 'refused' || (!!run.noCommands && t !== 'trusted');
}

export function setTrust(home: string, folder: string, trusted: boolean): void {
  const r = realpathSync(folder);
  const { dev, ino, birthtimeMs: birth } = statSync(r);
  save(home, { ...load(home), [r]: { trusted, dev, ino, birth } });
}

export function clearTrust(home: string, folder: string): void {
  const book = load(home);
  delete book[real(folder) ?? resolve(folder)];
  save(home, book);
}

export function listTrust(home: string): { folder: string; trusted: boolean; exists: boolean }[] {
  return Object.entries(load(home)).map(([folder, e]) => ({ folder, trusted: e.trusted, exists: same(folder, e) }));
}
