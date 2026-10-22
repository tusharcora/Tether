import { readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ link: undefined as undefined | ((a: string, b: string) => void) }));
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>();
  return { ...real, linkSync: (a: string, b: string) => (hooks.link ? hooks.link(a, b) : real.linkSync(a, b)) };
});

const { BUILTIN_BOTS } = await import('../src/crew.js');
const { currentHarness, harnessDir, HarnessConflict, listVersions, saveVersion } = await import('../src/harness.js');
const { tmp } = await import('./helpers.js');
const coder = BUILTIN_BOTS.find((b) => b.id === 'coder')!;

describe('harness publish edge cases', () => {
  it('falls back to an exclusive create where hard links are unsupported', () => {
    const home = tmp();
    hooks.link = () => {
      throw Object.assign(new Error('nope'), { code: 'EPERM' });
    };
    try {
      const v1 = currentHarness(home, coder);
      const v2 = saveVersion(home, coder, { persona: v1.persona, guidance: ['g'], skills: [] }, 1);
      expect(v2.version).toBe(2);
      expect(listVersions(home, coder).map((h) => h.version)).toEqual([1, 2]);
      expect(readdirSync(harnessDir(home, 'coder')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    } finally {
      hooks.link = undefined;
    }
  });

  it('reports a conflict when another writer takes the version number first (EEXIST)', () => {
    const home = tmp();
    const v1 = currentHarness(home, coder);
    hooks.link = (_tmp, final) => {
      writeFileSync(final, JSON.stringify({ ...v1, version: 2, guidance: ['theirs'], at: 'x' }));
      throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    };
    try {
      expect(() => saveVersion(home, coder, { persona: v1.persona, guidance: ['mine'], skills: [] }, 1)).toThrow(HarnessConflict);
    } finally {
      hooks.link = undefined;
    }
    expect(currentHarness(home, coder).guidance).toEqual(['theirs']);
    expect(readdirSync(harnessDir(home, 'coder')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
