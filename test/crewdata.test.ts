import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CREW, crewFor, lookSprite, refreshCrew, renderLook } from '../src/bots.js';
import { BUILTIN_BOTS, LOOK_PARTS, freshId, loadCrew, removeBot, sanitizeBot, saveBot } from '../src/crew.js';
import { blurbFor, makeStep, relink, stepChoices, blankPipeline, addStep } from '../src/composer.js';
import { normalizePipeline, preflight } from '../src/pipeline.js';
import { vlen } from '../src/ui.js';

const quant = { id: 'quant', name: 'Quant', title: 'quant researcher', kind: 'agent', readOnly: true, persona: 'Backtests ideas.', look: { body: 'wide', eyes: 'visor', mouth: 'flat', top: 'antenna', side: 'none', pattern: 'none', color: '#f08a4b', accent: 'auto' } };
const risk = { id: 'risk', name: 'Risk', title: 'risk gate', kind: 'gate', persona: 'Checks limits.', look: { ...quant.look, body: 'square' } };
const skeptic = { id: 'skeptic', name: 'Skeptic', title: 'devil\'s advocate', kind: 'verdict', persona: 'Argues against.', look: { ...quant.look, eyes: 'wink' } };
const trader = { id: 'trader', name: 'Trader', title: 'sign-off', kind: 'approval', persona: 'A person.', look: quant.look };

describe('crew data', () => {
  it('validates untrusted bot files', () => {
    expect(sanitizeBot({ ...quant }).bot?.id).toBe('quant');
    expect(sanitizeBot({ ...quant, id: '../etc' }).error).toMatch(/id/);
    expect(sanitizeBot({ ...quant, id: 'Bad Id' }).error).toBeTruthy();
    expect(sanitizeBot({ ...quant, kind: 'wizard' }).error).toMatch(/kind/);
    expect(sanitizeBot({ ...quant, name: '  ' }).error).toMatch(/name/);
    expect(sanitizeBot(null).error).toBeTruthy();
    const odd = sanitizeBot({ ...quant, name: 'A\u001b[31mB', look: { body: 'cube', eyes: 5, color: 'red', accent: 'javascript:' } }).bot!;
    expect(odd.name).not.toMatch(/\u001b/);
    expect(odd.look.body).toBe(LOOK_PARTS.body[0]);
    expect(odd.look.color).toBe('#9aa6b8');
    expect(odd.look.accent).toBe('auto');
    expect(sanitizeBot({ ...skeptic }).bot!.readOnly).toBe(true);
  });

  it('round-trips custom bots, edits built-ins as overrides, and cannot delete built-ins', () => {
    const home = mkdtempSync(join(tmpdir(), 'crew-'));
    expect(loadCrew(home).map((b) => b.id)).toEqual(BUILTIN_BOTS.map((b) => b.id));
    saveBot(home, sanitizeBot(quant).bot!);
    const edited = { ...BUILTIN_BOTS[3]!, name: 'Hammer', kind: 'gate' as const };
    saveBot(home, edited);
    const crew = loadCrew(home);
    expect(crew.at(-1)!.id).toBe('quant');
    const coder = crew.find((b) => b.id === 'coder')!;
    expect(coder.name).toBe('Hammer');
    expect(coder.kind).toBe('agent'); // a built-in keeps its role
    expect(coder.edited).toBe(true);
    expect(removeBot(home, 'quant')).toBe('deleted');
    expect(removeBot(home, 'coder')).toBe('reset');
    expect(removeBot(home, 'coder')).toBe('none');
    expect(loadCrew(home).find((b) => b.id === 'coder')!.name).toBe('Bolt');
    mkdirSync(join(home, 'crew'), { recursive: true });
    writeFileSync(join(home, 'crew', 'junk.json'), '{nope');
    writeFileSync(join(home, 'crew', 'mismatch.json'), JSON.stringify({ ...quant, id: 'other' }));
    expect(loadCrew(home)).toHaveLength(BUILTIN_BOTS.length);
    expect(freshId('Quant Researcher!', ['quant-researcher'])).toBe('quant-researcher2');
  });

  it('custom bots render in every mood and run as steps', () => {
    const home = mkdtempSync(join(tmpdir(), 'crew-'));
    for (const b of [quant, risk, skeptic, trader]) saveBot(home, sanitizeBot(b).bot!);
    refreshCrew(home);
    for (const id of ['quant', 'risk', 'skeptic', 'trader']) {
      for (const m of ['idle', 'working', 'happy', 'sad', 'waiting', 'asleep'] as const) {
        const rows = renderLook(CREW[id]!.def!.look, m, 5);
        expect(rows).toHaveLength(4);
        for (const r of rows) expect(vlen(r)).toBe(10);
      }
    }
    expect(stepChoices()).toEqual(expect.arrayContaining(['planner', 'quant', 'risk', 'skeptic', 'trader']));
    const p = blankPipeline('trade');
    for (const id of ['quant', 'risk', 'skeptic', 'trader']) addStep(p, id, p.nodes.length, undefined, 'python risk.py');
    expect(p.nodes.map((n) => n.kind)).toEqual(['agent', 'gate', 'agent', 'approval']);
    expect(p.nodes[0]).toMatchObject({ role: 'quant', readOnly: true, prompt: 'Backtests ideas.' });
    expect(p.nodes[1]).toMatchObject({ role: 'risk', command: 'python risk.py' });
    expect(p.nodes[2]).toMatchObject({ role: 'skeptic', verdict: true, readOnly: true });
    expect(crewFor(p.nodes[1]!)).toBe('risk');
    expect(crewFor(p.nodes[3]!)).toBe('trader');
    expect(blurbFor(p.nodes[0]!)).toMatch(/quant researcher/);
    expect(() => normalizePipeline(relink(p))).not.toThrow();
    expect(preflight(normalizePipeline(p), { has: () => true, get: () => ({ detect: async () => ({ ok: true }) }), ids: () => ['claude'] } as never).filter((i) => i.level === 'error')).toEqual([]);
    expect(makeStep('coder', blankPipeline('x')).role).toBe('coder');
    refreshCrew(mkdtempSync(join(tmpdir(), 'crew-')));
    expect(CREW.quant).toBeUndefined();
  });

  it('every part combination draws inside the 10x8 cell', () => {
    const base = { ...BUILTIN_BOTS[0]!.look };
    for (const [k, opts] of Object.entries(LOOK_PARTS)) {
      for (const o of opts) {
        for (const mood of ['idle', 'working', 'happy', 'sad', 'waiting', 'asleep'] as const) {
          const rows = lookSprite({ ...base, [k]: o }, mood, 3);
          expect(rows).toHaveLength(8);
          for (const r of rows) expect(r).toHaveLength(10);
        }
      }
    }
  });
});

describe('imported bots and faces', () => {
  const base = { id: 'go-reviewer', name: 'Go Reviewer', title: 'go reviewer', kind: 'verdict', look: {} };

  it('keeps source, whenToUse, modelHint and a long persona for imported bots', () => {
    const persona = 'x\n'.repeat(7500) + 'y';
    const { bot } = sanitizeBot({ ...base, source: 'ecc@v2.2.3', whenToUse: 'Use for Go. '.repeat(40), modelHint: 'sonnet', persona });
    expect(bot!.source).toBe('ecc@v2.2.3');
    expect(bot!.whenToUse!.length).toBe(300);
    expect(bot!.modelHint).toBe('sonnet');
    expect(bot!.persona.length).toBe(15001);
    expect(bot!.persona).toContain('\n');
  });

  it('caps a user persona at 600 and drops bad source / modelHint', () => {
    const { bot } = sanitizeBot({ ...base, source: 'bad source', modelHint: 'gpt', persona: 'x'.repeat(900) });
    expect(bot!.source).toBeUndefined();
    expect(bot!.modelHint).toBeUndefined();
    expect(bot!.persona.length).toBe(600);
  });

  it('cleans face overrides', () => {
    const { bot } = sanitizeBot({ ...base, look: { face: { hue: 400, tone: 3, traits: { 'body.n': 0.4, Bad: 1, 'eyes.size': 'x' } } } });
    expect(bot!.look.face).toEqual({ hue: 40, tone: 1, traits: { 'body.n': 0.4 } });
    const plain = sanitizeBot(base).bot!;
    expect(plain.look.face).toBeUndefined();
  });

  it('loads up to 60 user bots and up to 150 imported bots, imported after user bots', () => {
    const home = mkdtempSync(join(tmpdir(), 'crew-'));
    for (let i = 0; i < 70; i++) saveBot(home, { id: `mine${i}`, name: `Mine ${i}`, title: '', kind: 'agent', persona: '', look: {} as never });
    for (let i = 0; i < 160; i++) saveBot(home, { id: `ecc${String(i).padStart(3, '0')}`, name: `E ${i}`, title: '', kind: 'agent', persona: '', look: {} as never, source: 'ecc@v2.2.3' });
    const crew = loadCrew(home);
    const mine = crew.filter((b) => !b.builtin && !b.source);
    const ecc = crew.filter((b) => b.source);
    expect(mine).toHaveLength(60);
    expect(ecc).toHaveLength(150);
    expect(crew.findIndex((b) => b.source)).toBeGreaterThan(crew.findIndex((b) => b.id === mine.at(-1)!.id));
  });
});
