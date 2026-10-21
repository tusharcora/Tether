import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../src/adapters/index.js';
import { CREW, CREW_STYLES, crewFor, lookSprite, renderBot, setCrewStyle, sprite, type Mood } from '../src/bots.js';
import { addStep, classifyTask, composePipeline, detectTestCommand, fromTemplate, moveStep, relink, removeStep, slugify } from '../src/composer.js';
import { normalizePipeline, preflight } from '../src/pipeline.js';
import { parseKeys } from '../src/tui.js';
import { THEMES, setTheme, strip, vlen, BRAND, pal } from '../src/ui.js';
import type { AgentAdapter } from '../src/types.js';

const repoWith = (files: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'aorch-c-'));
  for (const [k, v] of Object.entries(files)) writeFileSync(join(d, k), v);
  return d;
};
const stub = (reply: string, ok = true): AgentAdapter => ({
  id: 'claude',
  reportsCost: true,
  supportsResume: true,
  detect: async () => ({ ok }),
  run: async () => ({ output: reply, exitCode: 0 }),
});
const reg = (a: AgentAdapter) => new AdapterRegistry().register(a);

describe('composer', () => {
  it('classifies tasks', () => {
    expect(classifyTask('fix the crash on login')).toBe('bugfix');
    expect(classifyTask('refactor the parser')).toBe('refactor');
    expect(classifyTask('update the README')).toBe('docs');
    expect(classifyTask('add rate limiting to orders')).toBe('feature');
    expect(classifyTask('explain why the cache misses')).toBe('research');
  });

  it('slugifies into a valid pipeline name', () => {
    expect(slugify('Fix: the "crash"!! in login?')).toMatch(/^bot-[a-z0-9-]+$/);
    expect(() => normalizePipeline(fromTemplate('bugfix', slugify('x'.repeat(200)), 'claude', 'npm test'))).not.toThrow();
  });

  it('detects the test command from the repo', () => {
    expect(detectTestCommand(repoWith({ 'package.json': '{"scripts":{"test":"vitest"}}' }))).toBe('npm test');
    expect(detectTestCommand(repoWith({ 'go.mod': 'module x' }))).toBe('go test ./...');
    expect(detectTestCommand(repoWith({ 'README.md': 'x' }))).toBeUndefined();
  });

  it('edits chains: add, move, remove keep edges and fix-loop targets consistent', () => {
    const p = fromTemplate('bugfix', 'w', 'claude', 'npm test');
    expect(p.nodes.map((n) => n.id)).toEqual(['coder', 'tests', 'review']);
    expect(p.edges).toHaveLength(2);
    expect(p.nodes[1]!.fixNode).toBe('coder');
    addStep(p, 'planner', 0);
    expect(p.nodes[0]!.id).toBe('planner');
    expect(p.edges).toHaveLength(3);
    expect(moveStep(p, 0, 1)).toBe(1); // planner now after coder
    relink(p);
    removeStep(p, 0);
    expect(p.edges.length).toBe(p.nodes.length - 1);
    expect(preflight(normalizePipeline(p)).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('uses the bot design when valid and never trusts a model-supplied command', async () => {
    const repo = repoWith({ 'package.json': '{"scripts":{"test":"vitest"}}' });
    const reply = JSON.stringify({ steps: ['coder', 'tester', 'reviewer'], testCommand: 'rm -rf /', rationale: 'because' });
    const c = await composePipeline('fix login', { repo, registry: reg(stub('here you go: ' + reply)) });
    expect(c.source).toBe('bot');
    expect(c.pipeline.nodes.find((n) => n.kind === 'gate')!.command).toBe('npm test');
    expect(c.warnings.join(' ')).toMatch(/ignored proposed test command/);
  });

  it('drops a test gate when the repo has no test command', async () => {
    const c = await composePipeline('fix login', { repo: repoWith({}), registry: reg(stub('{"steps":["coder","tester"],"rationale":"r"}')) });
    expect(c.pipeline.nodes.map((n) => n.kind)).toEqual(['agent']);
    expect(c.warnings.join(' ')).toMatch(/dropped a test gate/);
  });

  it('falls back to rules on garbage, unknown steps, or an unavailable agent', async () => {
    const repo = repoWith({ 'package.json': '{"scripts":{"test":"x"}}' });
    for (const a of [stub('no json here'), stub('{"steps":["hacker"]}'), stub('{"steps":[]}'), stub('{}', false)]) {
      const c = await composePipeline('fix the crash', { repo, registry: reg(a) });
      expect(c.source).toBe('heuristic');
      expect(c.template).toBe('bugfix');
      expect(preflight(c.pipeline).filter((i) => i.level === 'error')).toEqual([]);
    }
  });
});

describe('crew', () => {
  it('maps nodes to crew members', () => {
    expect(crewFor({ kind: 'gate' })).toBe('tester');
    expect(crewFor({ kind: 'approval' })).toBe('approval');
    expect(crewFor({ kind: 'agent', role: 'reviewer' })).toBe('reviewer');
    expect(crewFor({ kind: 'agent', role: 'QA engineer' })).toBe('tester');
    expect(crewFor({ kind: 'agent' })).toBe('coder');
  });

  it('every role, mood and style renders 4 rows of 10 columns', () => {
    const moods: Mood[] = ['idle', 'working', 'happy', 'sad', 'waiting', 'asleep'];
    for (const style of Object.keys(CREW_STYLES)) {
      expect(setCrewStyle(style)).toBe(true);
    for (const role of [...Object.keys(CREW), 'unknown']) {
      for (const m of moods) {
        for (const t of [0, 7, 39]) {
          expect(sprite(role, m, t)).toHaveLength(8);
          const rows = renderBot(role, m, t);
          expect(rows).toHaveLength(4);
          for (const r of rows) expect(vlen(r)).toBe(10);
        }
      }
    }
    }
    expect(setCrewStyle('nope')).toBe(false);
    setCrewStyle('pebble');
  });

  it('family bots keep their eyes inside the body and move them with mood', () => {
    setCrewStyle('pebble');
    const look = { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: '#5b9dff', accent: 'auto' };
    const eyes = (m: Mood, t: number) => lookSprite(look, m, t).map((r, y) => [...r].map((c, x) => (c === 'E' ? `${x},${y}` : '')).filter(Boolean)).flat();
    expect(eyes('idle', 0)).toHaveLength(2);
    expect(eyes('asleep', 0)).toHaveLength(0);
    expect(eyes('working', 0)).not.toEqual(eyes('working', 7));
    expect(eyes('waiting', 0)).not.toEqual(eyes('idle', 0));
    setCrewStyle('pebble');
  });

  it('eyes move as one piece: no eye is ever lost or stretched while animating', () => {
    const count = (look: object, m: Mood, t: number) => lookSprite(look as never, m, t).join('').replace(/[^EA]/g, '').length;
    for (const body of ['pebble', 'wide', 'tall', 'square', 'blob']) {
      for (const eyes of ['dots', 'tall', 'wide', 'cyclops', 'glasses']) {
        const look = { body, eyes, mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: '#5b9dff', accent: 'auto', guard: true };
        const base = count(look, 'idle', 0);
        for (const m of ['working', 'waiting', 'sad'] as Mood[]) for (let t = 0; t < 120; t++) expect(count(look, m, t), `${body}/${eyes}/${m}/${t}`).toBe(base);
      }
    }
  });
});

describe('themes and keys', () => {
  it('switches palette in place and can switch back', () => {
    const before = [...BRAND];
    expect(setTheme('matrix')).toBe(true);
    expect(BRAND).not.toEqual(before);
    expect(setTheme('nope')).toBe(false);
    for (const n of Object.keys(THEMES)) expect(setTheme(n)).toBe(true);
    setTheme('aurora');
    expect(BRAND).toEqual(before);
    expect(pal.cyan).toEqual([34, 211, 238]);
  });

  it('parses keystrokes, including escape sequences and pastes', () => {
    expect(parseKeys('\x1b[A\x1b[B\x1b[C\x1b[D')).toEqual(['up', 'down', 'right', 'left']);
    expect(parseKeys('\x1b')).toEqual(['esc']);
    expect(parseKeys('\r')).toEqual(['enter']);
    expect(parseKeys('\x1b[1;2C')).toEqual(['shift-right']);
    expect(parseKeys('ab\x7f')).toEqual(['a', 'b', 'backspace']);
    expect(parseKeys('\x03')).toEqual(['ctrl-c']);
    expect(strip(parseKeys('héllo').join(''))).toBe('héllo');
  });
});
