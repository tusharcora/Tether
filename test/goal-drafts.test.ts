import { describe, expect, it } from 'vitest';
import { checkDraft, draftPatch, firstTask, goalFromDraft, type DraftCtx } from '../src/assistant/goalDraft.js';

const ctx: DraftCtx = {
  teams: [{ id: 'web-1a2b', name: 'web', agents: ['coder', 'reviewer'] }],
  agents: [
    { id: 'coder', name: 'Bolt', specialty: 'code' },
    { id: 'reviewer', name: 'Lens', specialty: 'review' },
    { id: 'tester', name: 'Probe', specialty: 'tests' },
  ],
  workflows: ['bugfix'],
};
const draft = (o: Record<string, unknown> = {}) => ({ title: 'Sign-in returns people to where they were', type: 'bugfix', team: 'web-1a2b', agents: [{ id: 'coder', role: 'fixes it', why: 'edited auth/ last week' }], workflow: 'bugfix', ...o });

describe('a goal draft from a reply (lenient)', () => {
  it('keeps what exists and drops what does not', () => {
    const d = checkDraft(draft({ team: 'ghost', agents: [{ id: 'coder', role: 'fixes it' }, { id: 'nobody', role: 'x' }, { id: 'coder', role: 'twice' }], workflow: 'made-up' }), ctx);
    expect(d).toMatchObject({ title: 'Sign-in returns people to where they were', type: 'bugfix', agents: [{ id: 'coder', role: 'fixes it' }], workflow: 'team', approval: 'ask' });
    expect(d).not.toHaveProperty('team');
    expect(d).not.toHaveProperty('limits');
  });

  it('clamps limits into their ranges and drops ones that are not numbers', () => {
    const d = checkDraft(draft({ limits: { budgetUsd: 5000, maxRuns: 0.4, maxMinutes: 'soon' } }), ctx);
    expect(d).toMatchObject({ limits: { budgetUsd: 1000, maxRuns: 1 } });
    expect((d as { limits: object }).limits).not.toHaveProperty('maxMinutes');
  });

  it('caps the agents at five', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: ['coder', 'reviewer', 'tester'][i % 3], role: 'r' }));
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const wide: DraftCtx = { ...ctx, agents: ids.map((id) => ({ id, name: id, specialty: '' })) };
    expect((checkDraft(draft({ team: undefined, agents: ids.map((id) => ({ id, role: 'r' })) }), wide) as { agents: unknown[] }).agents).toHaveLength(5);
    expect((checkDraft(draft({ agents: many }), ctx) as { agents: unknown[] }).agents).toHaveLength(3);
  });

  it('needs a title and a real type; a missing type reads as a feature; a bad check is dropped', () => {
    expect(checkDraft(draft({ title: '  ' }), ctx)).toMatch(/title/);
    expect(checkDraft(draft({ type: 'epic' }), ctx)).toMatch(/type/);
    expect(checkDraft(draft({ type: undefined }), ctx)).toMatchObject({ type: 'feature' });
    expect(checkDraft(draft({ check: { kind: 'shell', command: 'x' } }), ctx)).not.toHaveProperty('check');
    expect(checkDraft(draft({ check: { kind: 'tests', command: 'npm test -- auth' } }), ctx)).toMatchObject({ check: { kind: 'tests', command: 'npm test -- auth' } });
    expect(checkDraft('nope', ctx)).toMatch(/object/);
  });
});

describe('edits sent with Start (strict)', () => {
  it('refuses unknown ids and out-of-range limits instead of dropping them', () => {
    expect(checkDraft(draft({ team: 'ghost' }), ctx, true)).toBe('unknown team "ghost"');
    expect(checkDraft(draft({ agents: [{ id: 'nobody', role: 'x' }] }), ctx, true)).toBe('unknown agent "nobody"');
    expect(checkDraft(draft({ workflow: 'made-up' }), ctx, true)).toBe('unknown workflow "made-up"');
    expect(checkDraft(draft({ limits: { maxRuns: 51 } }), ctx, true)).toMatch(/limits.maxRuns/);
    expect(checkDraft(draft({ limits: { budgetUsd: 2, maxMinutes: 90 } }), ctx, true)).toMatchObject({ limits: { budgetUsd: 2, maxMinutes: 90 } });
    expect(checkDraft(draft({ approval: 'yolo' }), ctx, true)).toMatch(/approval/);
  });
});

describe('the goal a draft makes', () => {
  it('is paused, owned by the team and its first agent, with the team and agents assigned and no limits', () => {
    const d = checkDraft(draft({ agents: [{ id: 'tester', role: 'tests it' }, { id: 'coder', role: 'fixes it' }] }), ctx) as Exclude<ReturnType<typeof checkDraft>, string>;
    const g = goalFromDraft(d, { workspace: 'api', origin: { kind: 'chat', chat: 'c1', message: 'm1' }, ctx });
    expect(g).toMatchObject({ status: 'paused', kind: 'tracker', type: 'bugfix', workflow: 'bugfix', team: 'web-1a2b', agent: 'tester', origin: { kind: 'chat', chat: 'c1', message: 'm1' } });
    expect(g.assignees).toEqual([{ kind: 'team', id: 'web-1a2b' }, { kind: 'agent', id: 'tester' }, { kind: 'agent', id: 'coder' }]);
    expect(g).not.toHaveProperty('budgetUsd');
    expect(g).not.toHaveProperty('startedAt');
  });

  it('a team with no agents named runs as the team’s first agent; no team, no owner', () => {
    const d = checkDraft(draft({ agents: [] }), ctx) as Exclude<ReturnType<typeof checkDraft>, string>;
    expect(goalFromDraft(d, { workspace: 'api', origin: { kind: 'chat', chat: 'c', message: 'm' }, ctx })).toMatchObject({ team: 'web-1a2b', agent: 'coder' });
    const solo = checkDraft(draft({ team: undefined }), ctx) as Exclude<ReturnType<typeof checkDraft>, string>;
    expect(goalFromDraft(solo, { workspace: 'api', origin: { kind: 'chat', chat: 'c', message: 'm' }, ctx })).not.toHaveProperty('team');
    expect(draftPatch(solo, ctx)).toMatchObject({ team: undefined, agent: undefined, budgetUsd: undefined });
  });

  it('the first run’s task carries the ask, the description and the check', () => {
    expect(firstTask('Fix the redirect', { ...(checkDraft(draft({ description: 'Keep ?next=.', check: { kind: 'tests', command: 'npm test' } }), ctx) as never) })).toBe('Fix the redirect\n\nKeep ?next=.\n\nDone when `npm test` passes.');
  });
});
