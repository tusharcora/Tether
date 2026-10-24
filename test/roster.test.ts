import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_BOTS, type BotDef } from '../src/crew.js';
import { buildRoster, detectLanguages, botLanguage, loadRouting, rosterLine, routingHints, ROSTER_CAP } from '../src/roster.js';
import { importEcc } from '../src/eccImport.js';
import { loadCrew } from '../src/crew.js';
import { tmp } from './helpers.js';

const FIXTURE = new URL('./fixtures/ecc/', import.meta.url).pathname;
const look = BUILTIN_BOTS[0]!.look;
const ecc = (id: string, when = `when ${id}`): BotDef => ({ id, name: id, title: id, kind: id.endsWith('-reviewer') ? 'verdict' : 'agent', persona: '', look, source: 'ecc@v2.2.3', whenToUse: when });
const repo = (files: Record<string, string>) => {
  const d = tmp('repo-');
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(d, f, '..'), { recursive: true });
    writeFileSync(join(d, f), body);
  }
  return d;
};

describe('roster', () => {
  it('detects languages at the root and one level down', () => {
    expect([...detectLanguages(repo({ 'go.mod': 'module x', 'web/package.json': JSON.stringify({ dependencies: { react: '19' } }), 'web/tsconfig.json': '{}' }))].sort()).toEqual(['go', 'react', 'typescript']);
    expect([...detectLanguages(repo({ 'pyproject.toml': '[project]\ndependencies=["fastapi"]' }))].sort()).toEqual(['fastapi', 'python']);
    expect(detectLanguages(undefined).size).toBe(0);
    expect(detectLanguages(tmp('empty-')).size).toBe(0);
    // a package.json holding `null` is still a JS project and must not throw
    expect([...detectLanguages(repo({ 'package.json': 'null' }))]).toEqual(['javascript']);
  });

  it('maps language bots', () => {
    expect(botLanguage('go-reviewer')).toBe('go');
    expect(botLanguage('ecc-rust-build-resolver')).toBe('rust');
    expect(botLanguage('code-reviewer')).toBeUndefined();
    // ids are capped at 24 characters, so an imported typescript-build-resolver arrives truncated
    expect(botLanguage('typescript-build-resolve')).toBe('typescript');
  });

  it('keeps built-ins and general bots, filters language and domain bots', () => {
    const crew = [...BUILTIN_BOTS, ecc('go-reviewer'), ecc('python-reviewer'), ecc('code-reviewer'), ecc('healthcare-reviewer')];
    const ids = buildRoster({ dir: repo({ 'go.mod': 'module x' }), task: 'add rate limiting', crew }).map((e) => e.id);
    expect(ids).toContain('planner');
    expect(ids).toContain('go-reviewer');
    expect(ids).toContain('code-reviewer');
    expect(ids).not.toContain('python-reviewer');
    expect(ids).not.toContain('healthcare-reviewer');
    expect(ids).not.toContain('orchestrator');
    expect(ids).not.toContain('approval');
    expect(ids).not.toContain('tester');
    expect(ids).not.toContain('manager');
    expect(buildRoster({ task: 'patient records export', crew }).map((e) => e.id)).toContain('healthcare-reviewer');
  });

  it('falls back from an empty when-to-use or persona to the next field', () => {
    const crew = [...BUILTIN_BOTS, { ...ecc('code-reviewer', ''), persona: 'Reviews code' }, { id: 'helper', name: 'Help', title: 'general helper', kind: 'agent' as const, persona: '', look }];
    const es = buildRoster({ task: 'x', crew });
    expect(es.find((e) => e.id === 'code-reviewer')!.when).toBe('Reviews code');
    expect(es.find((e) => e.id === 'helper')!.when).toBe('general helper');
  });

  it('works with no repo and no ECC', () => {
    const ids = buildRoster({ task: 'x', crew: [...BUILTIN_BOTS] }).map((e) => e.id);
    expect(ids).toEqual(['planner', 'architect', 'coder', 'reviewer']);
  });

  it('caps at 40, keeping built-ins and user bots first, then table order', () => {
    const many = Array.from({ length: 60 }, (_, i) => ecc(`agent${String(i).padStart(2, '0')}`));
    const mine: BotDef = { id: 'mine', name: 'Mine', title: 'mine', kind: 'agent', persona: 'my bot', look };
    const r = buildRoster({ task: 'x', crew: [...BUILTIN_BOTS, mine, ...many], routing: { table: ['agent59'], rules: [] } });
    expect(r).toHaveLength(ROSTER_CAP);
    expect(r.map((e) => e.id).slice(0, 6)).toEqual(['planner', 'architect', 'coder', 'reviewer', 'mine', 'agent59']);
  });

  it('keeps a task-matched domain bot inside the cap, right after built-ins', () => {
    const many = Array.from({ length: 60 }, (_, i) => ecc(`agent${String(i).padStart(2, '0')}`));
    const r = buildRoster({ task: 'patient export', crew: [...BUILTIN_BOTS, ...many, ecc('healthcare-reviewer')] });
    expect(r).toHaveLength(ROSTER_CAP);
    expect(r.map((e) => e.id).slice(0, 5)).toEqual(['planner', 'architect', 'coder', 'reviewer', 'healthcare-reviewer']);
  });

  it('formats lines and routing hints with roster ids only', async () => {
    const line = rosterLine({ id: 'go-reviewer', kind: 'verdict', readOnly: true, when: 'Expert Go code reviewer '.repeat(10), builtin: false });
    expect(line.startsWith('- go-reviewer (verdict, read-only) — Expert Go')).toBe(true);
    expect(line.length).toBeLessThanOrEqual(100);
    const home = tmp('home-');
    await importEcc(home, { from: FIXTURE });
    const routing = loadRouting(home)!;
    const es = buildRoster({ dir: repo({ 'go.mod': 'x' }), task: 'x', crew: loadCrew(home), routing });
    const hints = routingHints(routing, es);
    expect(hints).toContain('- Complex feature requests → ecc-planner');
    expect(hints).toContain('- Go changes → go-reviewer');
    expect(hints.some((h) => h.includes('opensource'))).toBe(false);
    expect(loadRouting(tmp('home-'))).toBeUndefined();
  });
  it('caps each routing rule at one line of 160 characters', () => {
    const es = [{ id: 'go-reviewer', kind: 'verdict' as const, readOnly: true, when: 'Go', builtin: false }];
    const hints = routingHints({ table: [], rules: [{ when: 'Go\nchanges ' + 'x'.repeat(400), agents: ['go-reviewer'] }] }, es);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toBe(`- ${('Go changes ' + 'x'.repeat(400)).slice(0, 160)} → go-reviewer`);
  });
});
