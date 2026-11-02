import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));

import { api } from '../api';
import { routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import type { GoalDraft, Proposal } from './api';
import { GoalCard, JUST_ANSWER, stepsOf } from './GoalCard';
import type { Assistant } from './useAssistant';

const draft: GoalDraft = {
  title: 'Sign-in returns people to where they were',
  type: 'bugfix',
  check: { kind: 'tests', command: 'npm test -- auth' },
  team: 'web-1a2b',
  agents: [
    { id: 'coder', role: 'fixes it', why: 'edited auth/ last week', model: 'sonnet' },
    { id: 'reviewer', role: 'reviews the diff' },
  ],
  workflow: 'team',
  approval: 'ask',
};
const proposal = (o: Partial<Proposal> = {}): Proposal => ({ id: 'p1', kind: 'goal', task: 'Fix the redirect', draft, goalId: 'g1', status: 'proposed', ...o });
const roster = { squads: [{ id: 'web-1a2b', name: 'web', place: 'tether', project: 'w', agents: ['coder', 'reviewer'], status: 'idle', needs: 0, recent: [], queue: [] }], agents: [{ id: 'coder', name: 'Bolt', specialty: 'code' }, { id: 'reviewer', name: 'Lens', specialty: 'review' }, { id: 'tester', name: 'Probe', specialty: 'tests' }] };

function chat(o: Partial<Assistant> = {}): Assistant {
  return { decide: vi.fn(async (p: Proposal, d: string) => ({ ...p, status: d === 'start' ? 'started' : 'dismissed' })), send: vi.fn(async () => {}), ...o } as unknown as Assistant;
}

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({ 'GET /api/squads': roster, 'GET /api/tickets/g1': { id: 'g1', key: 'WEB-142', status: 'active', kind: 'loop', items: [{ id: 1, kind: 'run', runId: 'r00001abcd', runStatus: 'running', text: 'x', done: false, at: 1, goalId: 'g1' }] } });
});

describe('the workflow as steps', () => {
  it('a team goal is its agents’ roles, your approval when it asks, then the PR; no team: Tether plans first', () => {
    expect(stepsOf(draft)).toEqual([{ label: 'Fixes it' }, { label: 'Reviews the diff' }, { label: 'You approve', ask: true }, { label: 'Open PR' }]);
    expect(stepsOf({ ...draft, team: undefined, agents: [], approval: 'auto' }).map((s) => s.label)).toEqual(['Tether plans', 'Work', 'Open PR']);
  });

  it('a saved workflow is its own steps, approvals asking you', () => {
    const nodes = [{ id: 'fix', kind: 'agent', title: 'Fix' }, { id: 'tests', kind: 'gate', title: 'Tests' }, { id: 'ok', kind: 'approval', title: 'You approve' }];
    expect(stepsOf({ ...draft, workflow: 'bugfix' }, { nodes } as never)).toEqual([{ label: 'Fix' }, { label: 'Tests' }, { label: 'You approve', ask: true }]);
  });
});

describe('the goal card', () => {
  it('shows what the goal is, who does it and how, with no limits until added', async () => {
    renderApp(<GoalCard proposal={proposal()} chat={chat()} project="acme-web" onGo={vi.fn()} />);
    const card = screen.getByRole('article', { name: /Ticket card/ });
    expect(await within(card).findByText('WEB-142 · Bug fix · new ticket in acme-web · not started')).toBeTruthy();
    expect(within(card).getByText('Ready to start')).toBeTruthy();
    expect(within(card).getByText('npm test -- auth')).toBeTruthy();
    expect(await within(card).findByText('# web')).toBeTruthy();
    expect(within(card).getByText('fixes it · sonnet · edited auth/ last week')).toBeTruthy();
    expect(within(card).getByText('You approve').className).toContain('ask');
    expect(within(card).getByText('No limits')).toBeTruthy();
    expect(within(card).getByText('· nothing ships without you')).toBeTruthy();
  });

  it('Start sends the card’s edits: a swapped agent and an added limit', async () => {
    const c = chat();
    renderApp(<GoalCard proposal={proposal()} chat={c} onGo={vi.fn()} />);
    const card = screen.getByRole('article', { name: /Ticket card/ });
    fireEvent.click(await within(card).findByRole('combobox', { name: 'Swap Lens' }));
    fireEvent.click(await screen.findByRole('option', { name: /Probe/ }));
    fireEvent.click(within(card).getByRole('button', { name: '+ Add limits' }));
    fireEvent.click(within(card).getByRole('button', { name: '$ cap' }));
    fireEvent.change(within(card).getByLabelText('Spend cap ($)'), { target: { value: '2' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(c.decide).toHaveBeenCalled());
    const [, decision, sent] = vi.mocked(c.decide).mock.calls[0]!;
    expect(decision).toBe('start');
    expect(sent).toMatchObject({ limits: { budgetUsd: 2 } });
    expect(sent!.agents.map((a) => a.id)).toContain('tester');
  });

  it('"Just answer, no goal" drops it and asks again for a plain answer', async () => {
    const c = chat();
    renderApp(<GoalCard proposal={proposal()} chat={c} onGo={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Just answer, no ticket' }));
    await waitFor(() => expect(c.send).toHaveBeenCalledWith(JUST_ANSWER));
    expect(vi.mocked(c.decide).mock.calls[0]![1]).toBe('dismiss');
  });

  it('once started it follows the goal: its status, a link to its run, and Open in Goals', async () => {
    const onGo = vi.fn();
    renderApp(<GoalCard proposal={proposal({ status: 'started' })} chat={chat()} onGo={onGo} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run R-ABCD · running' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r00001abcd' });
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Tickets →' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'tickets', id: 'g1' });
    // a team goal plans first: no Try more ways from its card
    expect(screen.queryByRole('button', { name: 'Try 2 more ways' })).toBeNull();
  });

  it('a started workflow goal can try its run more ways: the picker, then Compare', async () => {
    routeApi({
      'GET /api/squads': roster,
      'GET /api/pipelines/bugfix': { pipeline: { name: 'bugfix', nodes: [], edges: [] } },
      'GET /api/tickets/g1': { id: 'g1', status: 'active', kind: 'loop', items: [{ id: 1, kind: 'run', runId: 'r00001abcd', runStatus: 'paused', text: 'x', done: false, at: 1, goalId: 'g1' }] },
      'GET /api/runs/r00001abcd/attempts?count=4': { picks: [{ agent: 'codex' }, null, null, null], choices: [{ agent: 'codex' }], original: { agent: 'claude' } },
      'POST /api/runs/r00001abcd/attempts': { ids: ['r2', 'r3'], set: 'aset9' },
    });
    const onGo = vi.fn();
    renderApp(<GoalCard proposal={proposal({ status: 'started', draft: { ...draft, workflow: 'bugfix' } })} chat={chat()} onGo={onGo} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try 2 more ways' }));
    const dialog = await screen.findByRole('dialog', { name: 'Try more ways' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Start 2 more' }));
    await waitFor(() => expect(onGo).toHaveBeenCalledWith({ tab: 'attempts', id: 'aset9' }));
  });
});
