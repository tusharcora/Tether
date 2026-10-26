import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveHome } from '../src/config.js';

describe('the Tether rename', () => {
  it('ships `tether` and keeps `aorch` as an alias of the same entry', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; bin: Record<string, string> };
    expect(pkg.name).toBe('tether');
    expect(pkg.bin.tether).toBe('dist/cli.js');
    expect(pkg.bin.aorch).toBe(pkg.bin.tether);
  });

  describe('home folder precedence (no data moves)', () => {
    afterEach(() => vi.unstubAllEnvs());
    it('--home beats TETHER_HOME beats AORCH_HOME beats ~/.aorch', () => {
      vi.stubEnv('TETHER_HOME', '/t');
      vi.stubEnv('AORCH_HOME', '/a');
      expect(resolveHome('/flag')).toBe('/flag');
      expect(resolveHome()).toBe('/t');
      vi.stubEnv('TETHER_HOME', '');
      expect(resolveHome()).toBe('/a');
      vi.stubEnv('AORCH_HOME', '');
      expect(resolveHome()).toBe(join(homedir(), '.aorch'));
    });
  });
});
