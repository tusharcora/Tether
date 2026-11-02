import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
