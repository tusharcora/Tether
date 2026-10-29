import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addTeamLessons, forgetLessons, isQuote, loadLessons, MAX_LESSONS_PER_BOT, saveLessons, type Lesson } from '../src/lessons.js';
import { tmp } from './helpers.js';

describe('agent memory: team lessons', () => {
  it('keeps the team tag through save and load', () => {
    const home = tmp();
    const saved = addTeamLessons(home, 'coder', 'core', 'r1', ['Rerun failing test files alone before calling a test broken']);
    expect(saved).toHaveLength(1);
    const [l] = loadLessons(home, 'coder');
    expect(l).toMatchObject({ bot: 'coder', team: 'core', polarity: 'do', provenance: 'check', evidence: [{ run: 'r1', node: 'team' }] });
    expect(JSON.parse(readFileSync(join(home, 'harness', 'coder', 'lessons.json'), 'utf8')).lessons[0].team).toBe('core');
  });

  it('drops quotes and who-said-what', () => {
    for (const t of ['Maya said use tabs', '"use tabs" everywhere', '@maya wants tabs', 'Use tabs, according to the lead', 'tushar told us to skip lint', '“Never rebase”']) expect(isQuote(t), t).toBe(true);
    for (const t of ['Rerun failing test files alone before calling a test broken', "The repo's tests need CI=1"]) expect(isQuote(t), t).toBe(false);
    const home = tmp();
    addTeamLessons(home, 'coder', 'core', 'r1', ['Maya said use tabs', 'Keys never go in argv or logs']);
    expect(loadLessons(home, 'coder').map((l) => l.text)).toEqual(['Keys never go in argv or logs']);
  });

  it('takes at most 3 per call and 200 per bot, oldest first out', () => {
    const home = tmp();
    addTeamLessons(home, 'coder', 'core', 'r1', ['alpha one rule', 'beta two rule', 'gamma three rule', 'delta four rule']);
    expect(loadLessons(home, 'coder')).toHaveLength(3);
    const many: Lesson[] = Array.from({ length: MAX_LESSONS_PER_BOT }, (_, i) => ({
      id: `coder-${String(i).padStart(8, '0')}`, bot: 'coder', text: `fact number ${i} about word${i}`, polarity: 'do', topic: 'team', provenance: 'check', team: 'core',
      evidence: [{ run: `r${i}`, node: 'team', signal: 'team', source: 'verdict' }], runs: 1, status: 'tentative', updatedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    }));
    saveLessons(home, 'coder', many);
    addTeamLessons(home, 'coder', 'core', 'r9', ['a brand new lesson entirely'], new Date(2026, 5, 1));
    const after = loadLessons(home, 'coder');
    expect(after).toHaveLength(MAX_LESSONS_PER_BOT);
    expect(after.some((l) => l.text === 'a brand new lesson entirely')).toBe(true);
    expect(after.some((l) => l.text === 'fact number 0 about word0')).toBe(false);
  });

  it('forgets one lesson, then all', () => {
    const home = tmp();
    addTeamLessons(home, 'coder', 'core', 'r1', ['alpha one rule', 'beta two rule']);
    const [a] = loadLessons(home, 'coder');
    expect(forgetLessons(home, 'coder', [a!.id])).toEqual([a!.id]);
    expect(loadLessons(home, 'coder')).toHaveLength(1);
    expect(forgetLessons(home, 'coder', ['coder-nope'])).toEqual([]);
    expect(forgetLessons(home, 'coder')).toHaveLength(1);
    expect(loadLessons(home, 'coder')).toEqual([]);
  });
});
