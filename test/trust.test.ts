import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearTrust, listTrust, setTrust, trustState } from '../src/trust.js';

// folders live in the system temp folder, outside any git repo
function rig() {
  const root = mkdtempSync(join(tmpdir(), 'aorch-trust-'));
  const home = join(root, 'home');
  const folder = join(root, 'proj');
  mkdirSync(home);
  mkdirSync(folder);
  return { root, home, folder };
}

describe('trust', () => {
  it('starts unknown, remembers yes and no, and withdraws', () => {
    const { home, folder } = rig();
    expect(trustState(home, folder)).toBe('unknown');
    setTrust(home, folder, true);
    expect(trustState(home, folder)).toBe('trusted');
    setTrust(home, folder, false);
    expect(trustState(home, folder)).toBe('refused');
    clearTrust(home, folder);
    expect(trustState(home, folder)).toBe('unknown');
  });
  it('a symlink trusts the real folder', () => {
    const { root, home, folder } = rig();
    const link = join(root, 'link');
    symlinkSync(folder, link);
    setTrust(home, link, true);
    expect(trustState(home, folder)).toBe('trusted');
    expect(listTrust(home).map((t) => t.folder)).toEqual([realpathSync(folder)]);
  });
  it('a deleted or renamed folder is not trusted', () => {
    const { root, home, folder } = rig();
    setTrust(home, folder, true);
    renameSync(folder, join(root, 'moved'));
    expect(trustState(home, folder)).toBe('unknown');
    expect(listTrust(home)[0]?.exists).toBe(false);
  });
  it('a folder recreated at the old path is not the trusted one', () => {
    const { root, home, folder } = rig();
    setTrust(home, folder, true);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); // birth times tick coarsely: a folder reborn inside one tick of the first can't be told apart
    rmSync(folder, { recursive: true });
    mkdirSync(folder); // asserted while it exists
    expect(trustState(home, folder)).toBe('unknown');
    expect(listTrust(home)[0]?.exists).toBe(false);
    const { home: h2, folder: f2 } = rig();
    setTrust(h2, f2, true);
    renameSync(f2, join(root, 'away'));
    mkdirSync(f2);
    expect(trustState(h2, f2)).toBe('unknown');
  });
  it('a folder reborn with the old inode is not the trusted one', () => {
    const { home, folder } = rig();
    setTrust(home, folder, true);
    const path = join(home, 'trust.json');
    const book = JSON.parse(readFileSync(path, 'utf8'));
    book[realpathSync(folder)].birth -= 1; // what inode reuse leaves: same dev and ino, another birth
    writeFileSync(path, JSON.stringify(book));
    expect(trustState(home, folder)).toBe('unknown');
    expect(listTrust(home)[0]?.exists).toBe(false);
  });
  it('an edited folder stays trusted, and so does one renamed away and back', () => {
    const { root, home, folder } = rig();
    setTrust(home, folder, true);
    writeFileSync(join(folder, 'a.txt'), '1');
    mkdirSync(join(folder, 'sub'));
    rmSync(join(folder, 'a.txt'));
    chmodSync(folder, 0o700);
    utimesSync(folder, new Date(), new Date());
    expect(trustState(home, folder)).toBe('trusted');
    renameSync(folder, join(root, 'away'));
    renameSync(join(root, 'away'), folder);
    expect(trustState(home, folder)).toBe('trusted');
  });
  it('a record from before birth times can prove no yes, and keeps its no', () => {
    const { home, folder } = rig();
    const old = (trusted: boolean) => {
      const { dev, ino } = statSync(folder);
      writeFileSync(join(home, 'trust.json'), JSON.stringify({ [realpathSync(folder)]: { trusted, dev, ino } }));
    };
    old(true);
    expect(trustState(home, folder)).toBe('unknown');
    old(false);
    expect(trustState(home, folder)).toBe('refused');
  });
  it('a corrupt file trusts nothing', () => {
    const { home, folder } = rig();
    writeFileSync(join(home, 'trust.json'), '{nope');
    expect(trustState(home, folder)).toBe('unknown');
    expect(listTrust(home)).toEqual([]);
  });
  it('writes the file owner-only', () => {
    const { home, folder } = rig();
    writeFileSync(join(home, 'trust.json.tmp'), 'old', { mode: 0o644 });
    setTrust(home, folder, true);
    expect(statSync(join(home, 'trust.json')).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(home, 'trust.json'), 'utf8'))).toBeTypeOf('object');
  });
});
