import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CREW } from '../src/bots.js';
import { BUILTIN_BOTS, canonicalBotId } from '../src/crew.js';
import { resolveHome } from '../src/config.js';

describe('Maestro is now Tether (spec §4)', () => {
  it('names the orchestrator bot Tether in the crew', () => {
    expect(BUILTIN_BOTS.find((b) => b.id === 'orchestrator')!.name).toBe('Tether');
    expect(CREW.orchestrator!.name).toBe('Tether');
  });
  it('resolves "tether" and the old "maestro" to the orchestrator, any case, and leaves other ids alone', () => {
    for (const id of ['tether', 'maestro', 'Maestro', ' TETHER ']) expect(canonicalBotId(id), id).toBe('orchestrator');
    for (const id of ['coder', 'orchestrator', 'my-bot']) expect(canonicalBotId(id)).toBe(id);
  });
});

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
