import { describe, expect, it } from 'vitest';
import { importEcc } from '../src/eccImport.js';
import { eccSkillPipeline, eccSkillPrompt, eccSkills, findSkill } from '../src/skills.js';
import { tmp } from './helpers.js';

const FIXTURE = new URL('./fixtures/ecc/', import.meta.url).pathname;

describe('ECC skills', () => {
  it('lists skills and commands with their kind', async () => {
    const home = tmp('home-');
    expect(eccSkills(home)).toEqual([]);
    await importEcc(home, { from: FIXTURE });
    const s = eccSkills(home);
    expect(s.map((x) => [x.name, x.kind, x.source])).toEqual([['tdd-workflow', 'skill', 'ecc'], ['plan', 'command', 'ecc']]);
    expect(s[0]!.description).toMatch(/failing test first/);
  });

  it('runs on any agent with the body fenced as instructions', async () => {
    const home = tmp('home-');
    await importEcc(home, { from: FIXTURE });
    const skill = eccSkills(home)[0]!;
    const prompt = eccSkillPrompt(skill);
    expect(prompt).toMatch(/<skill>\n# TDD workflow/);
    expect(prompt).toMatch(/Argument hint: <path\/to\/\*\.plan\.md>/);
    const p = eccSkillPipeline(skill);
    expect(p.nodes).toHaveLength(1);
    expect(p.nodes[0]).toMatchObject({ kind: 'agent', role: 'coder', prompt });
    expect(p.nodes[0]!.agent).toBeUndefined();
  });

  it('finds by name, and ecc:<name> forces the ECC one', () => {
    const all = [{ name: 'plan', description: '', source: 'claude' as const }, { name: 'plan', description: '', source: 'ecc' as const, kind: 'command' as const }];
    expect(findSkill(all, 'plan')!.source).toBe('claude');
    expect(findSkill(all, 'ecc:plan')!.source).toBe('ecc');
    expect(findSkill(all, 'nope')).toBeUndefined();
  });
});
