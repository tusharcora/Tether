import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookPixels, refreshCrew, CREW, crewFor } from '../src/bots.js';
import { BUILTIN_IDS, loadCrew, saveBot } from '../src/crew.js';
import { PACKS, findPack, parseBots, reid } from '../src/packs.js';
import { makeStep } from '../src/composer.js';

describe('crew packs', () => {
  it('every pack bot is valid, uniquely identified and never shadows a built-in', () => {
    const ids = new Set<string>();
    for (const p of PACKS) {
      const { bots, errors } = parseBots(p.bots);
      expect(errors).toEqual([]);
      expect(bots).toHaveLength(p.bots.length);
      for (const b of bots) {
        expect(BUILTIN_IDS.has(b.id)).toBe(false);
        expect(ids.has(b.id)).toBe(false);
        ids.add(b.id);
      }
    }
    expect(findPack('Trading')?.bots.map((b) => b.name)).toContain('Skeptic');
  });

  it('parseBots reports bad entries and accepts one bot, a list, or {bots}', () => {
    const ok = PACKS[0]!.bots[0]!;
    expect(parseBots(ok).bots).toHaveLength(1);
    expect(parseBots({ bots: [ok, { id: 'Bad Id' }, ok] })).toMatchObject({ errors: [expect.stringMatching(/bot 2/), expect.stringMatching(/duplicate/)] });
    expect(parseBots('nope').errors).toHaveLength(1);
  });

  it('reid renames imports that collide with built-ins or existing bots', () => {
    const b = { ...PACKS[0]!.bots[0]!, id: 'coder' };
    const out = reid([b, { ...b, id: 'quant' }, { ...b, id: 'quant' }], new Set(['quant']));
    expect(new Set(out.map((x) => x.id)).size).toBe(3);
    expect(out.some((x) => BUILTIN_IDS.has(x.id))).toBe(false);
  });

  it('an installed pack becomes steps, with the persona as the instructions', () => {
    const home = mkdtempSync(join(tmpdir(), 'aorch-pk-'));
    for (const b of findPack('trading')!.bots) saveBot(home, b);
    refreshCrew(home);
    expect(loadCrew(home)).toHaveLength(7 + 6);
    expect(CREW.skeptic?.name).toBe('Skeptic');
    expect(crewFor({ kind: 'agent', role: 'skeptic' })).toBe('skeptic');
    const step = makeStep('skeptic', { name: 'x', nodes: [], edges: [] } as never, 'claude', 'npm test');
    expect(step.prompt).toMatch(/skeptic/i);
    expect(step.readOnly).toBe(true);
    refreshCrew(mkdtempSync(join(tmpdir(), 'aorch-pk-')));
  });

  it('lookPixels gives 8 rows of 10 with a colour for every code used', () => {
    const { grid, colors } = lookPixels(PACKS[1]!.bots[0]!.look);
    expect(grid).toHaveLength(8);
    for (const r of grid) {
      expect(r).toHaveLength(10);
      for (const c of r) if (c !== '.') expect(colors[c]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
