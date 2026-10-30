import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import type { GoalView } from '../goals/goalsApi';
import { act } from '@testing-library/react';
import { calls, FakeEventSource, makeRun, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import type { TeamView } from './teamsApi';
import { TeamScreen } from './TeamScreen';

const you = { kind: 'person' as const, id: 'owner', name: 'you' };
const bolt = { kind: 'agent' as const, id: 'coder', name: 'Bolt' };
const probe = { kind: 'agent' as const, id: 'tester', name: 'Probe' };
const view = (): TeamView => ({
  team: { id: 'core', name: 'Tether core', place: 'tether', project: 'app', agents: ['coder', 'tester'], people: [{ id: 'owner', name: 'you' }], approvers: 'any', level: 'balanced', limits: { usdPerDay: 10, runsPerDay: 20 }, learn: true, createdAt: 1 },
  messages: [
    { id: 'm1', at: Date.now() - 5000, from: you, text: '@Probe keep main green. Stop at $5.' },
    { id: 'm2', at: Date.now() - 4000, from: probe, text: 'On it. I made it a loop.', card: { kind: 'loop', goalId: 'g1' } },
    { id: 'm3', at: Date.now() - 3000, from: bolt, text: 'On it. Started R-5A21 in its own worktree.', run: 'rmh15a21', card: { kind: 'run', runId: 'rmh15a21', title: 'probe timeout', steps: [{ id: 'work', status: 'done' }, { id: 'tests', status: 'done' }, { id: 'ship', status: 'awaiting' }], status: 'paused', costUsd: 0.4 } },
    { id: 'm4', at: Date.now() - 2000, from: bolt, text: 'Ready to ship. It needs a person to approve.', run: 'rmh15a21', card: { kind: 'approval', what: 'ship', title: 'Ship “probe timeout”?', detail: 'npm test passed · +12 −4 in 1 file', runId: 'rmh15a21', node: 'ship', status: 'pending' } },
    { id: 'm5', at: Date.now() - 1000, from: { kind: 'tether', id: 'tether', name: 'Tether' }, text: 'Opened the PR.', card: { kind: 'pr', url: 'https://github.com/o/r/pull/12', number: 12, title: 'probe timeout' } },
  ],
  members: [
    { id: 'coder', name: 'Bolt', specialty: 'code', state: 'waiting' },
    { id: 'tester', name: 'Probe', specialty: 'tests', state: 'looping' },
  ],
  working: [{ kind: 'loop', title: 'Keep main green', agent: 'tester', needs: false, goalId: 'g1', progress: 0.33, line: '2 of ≤6 runs · $1.40 of $5.00' }],
  spend: { usd: 1.8, runs: 3 },
  status: 'needs',
});
const goal = { id: 'g1', workspace: 'app', title: 'Keep main green', kind: 'loop', status: 'active', check: { kind: 'tests', command: 'npm test' }, budgetUsd: 5, maxRuns: 6, approval: 'auto', workflow: 'team', createdAt: 1, spentUsd: 1.4, progress: 0.3, team: 'core', agent: 'tester',
  items: [{ id: 1, goalId: 'g1', kind: 'run', text: 'fix triggers', runId: 'rmh15a10', done: false, at: 1, attempt: { after: { ok: false, at: 2, summary: '2 failing', tail: '' } } }, { id: 2, goalId: 'g1', kind: 'run', text: 'fix evolve', runId: 'rmh15a22', done: false, at: 3 }] } as GoalView;

const setup = () => {
  routeApi({ 'GET /api/teams/core': view(), 'GET /api/runs/rmh15a21/events': [], 'GET /api/runs/rmh15a10/events': [], 'GET /api/runs/rmh15a22/events': [], 'POST /api/teams/core/cards/m4': (b: unknown) => ({ ...view().messages[3], b }), 'POST /api/teams/core/messages': { id: 'm9' }, 'GET /api/teams/core/diff/m4': { diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n', truncated: false } });
  const onGo = vi.fn();
  renderApp(<TeamScreen id="core" goals={[goal]} agents={[]} projects={[]} onGo={onGo} onChanged={vi.fn()} onNewAgent={vi.fn()} />);
  return { onGo };
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

describe('the team screen (board 1)', () => {
  it('heads the room with its live runs, what needs you and today’s spend; the channel keeps its messages and cards', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Tether core' });
    expect(screen.getByText('Tether team · you + 2 agents · app · any of you can approve')).toBeTruthy();
    expect(screen.getByText('1 live run')).toBeTruthy();
    expect(screen.getByText('1 needs you')).toBeTruthy();
    expect(screen.getByText('$1.80 of $10.00 today')).toBeTruthy();
    const chat = screen.getByRole('region', { name: 'Team chat' });
    expect(chat.querySelector('.tm-mention')!.textContent).toBe('@Probe');
    // who spoke: name, and an agent's specialty with the time
    expect(within(chat).getAllByText(/^agent · code · /)).toHaveLength(2);
    // the loop card scores its goal: check 2 failing (0), budget left 72%, runs left 67%
    expect(within(chat).getByText('4.6')).toBeTruthy();
    expect(within(chat).getByText('run 2 of ≤6 · $1.40 / $5.00')).toBeTruthy();
    const task = chat.querySelector('[data-slot="task-card"]') as HTMLElement;
    expect(task.dataset.state).toBe('waiting');
    expect(within(task).getByText('Spent $0.40')).toBeTruthy();
    // a PR card is a link preview of what it knows (no unfurl)
    expect(within(chat).getByRole('link', { name: /PR #12 · probe timeout/ }).getAttribute('href')).toBe('https://github.com/o/r/pull/12');
  });

  it('maps the picked run from you to your approval; the strip switches runs and a team run opens in the room', async () => {
    const { onGo } = setup();
    const strip = await screen.findByRole('region', { name: 'Team map' });
    // the live ones first: the run waiting on its ship step, then the loop
    const cards = within(strip).getAllByRole('button', { pressed: false }).concat(within(strip).getAllByRole('button', { pressed: true })).filter((b) => b.classList.contains('tr-card'));
    expect(cards.map((b) => b.querySelector('b')!.textContent).sort()).toEqual(['Keep main green', 'probe timeout']);
    expect(within(strip).getByRole('button', { name: /probe timeout/, pressed: true })).toBeTruthy();
    await waitFor(() => expect(FakeEventSource.all.at(-1)?.url).toBe('/api/runs/rmh15a21/stream'));
    act(() => FakeEventSource.all.at(-1)!.emit('state', makeRun({ id: 'rmh15a21' })));
    expect(await within(strip).findByText('You')).toBeTruthy();
    expect(within(strip).getByRole('button', { name: /^Bolt,/ })).toBeTruthy();
    fireEvent.click(within(strip).getByRole('button', { name: 'Zoom in' }));
    expect((strip.querySelector('.rg-scale') as HTMLElement).style.transform).toBe('scale(1.25)');
    // the loop's latest run
    fireEvent.click(within(strip).getByRole('button', { name: /Keep main green/ }));
    await waitFor(() => expect(FakeEventSource.all.at(-1)?.url).toBe('/api/runs/rmh15a22/stream'));
    // Open run on a run card follows it here, not on a separate page
    fireEvent.click(within(screen.getByRole('region', { name: 'Team chat' })).getByRole('button', { name: 'Open run' }));
    await waitFor(() => expect(FakeEventSource.all.at(-1)?.url).toBe('/api/runs/rmh15a21/stream'));
    expect(onGo).not.toHaveBeenCalled();
  });

  it('Whole team shows who hands work to whom; a member focuses the chat until Show all', async () => {
    setup();
    fireEvent.click(await screen.findByRole('tab', { name: 'Whole team' }));
    expect(screen.getByRole('tab', { name: 'Whole team' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'you: focus the chat on them' }).textContent).toContain('1 hand-off this week');
    fireEvent.click(screen.getByRole('button', { name: 'Bolt: focus the chat on them' }));
    expect(screen.getByRole('status').textContent).toBe('Showing Bolt · Show all');
    const chat = screen.getByRole('region', { name: 'Team chat' });
    expect(within(chat).queryByText('On it. I made it a loop.')).toBeNull();
    expect(within(chat).getByText('Ready to ship. It needs a person to approve.')).toBeTruthy();
    fireEvent.click(within(chat).getByRole('button', { name: 'Show all' }));
    expect(within(chat).getByText('On it. I made it a loop.')).toBeTruthy();
  });

  it('Approve decides the card; Reject asks for a reason first; Review diff shows the diff', async () => {
    setup();
    const card = await screen.findByRole('group', { name: 'Ship “probe timeout”?' });
    expect(within(card).getByText('Any teammate can approve')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls('POST', '/api/teams/core/cards/m4')[0]?.[2]).toEqual({ action: 'approve' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    fireEvent.change(within(card).getByLabelText(/Why\?/), { target: { value: 'needs a test' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(calls('POST', '/api/teams/core/cards/m4')[1]?.[2]).toEqual({ action: 'reject', reason: 'needs a test' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Review diff' }));
    expect(await screen.findByLabelText('Changes')).toBeTruthy();
    expect(screen.getByText('x')).toBeTruthy();
  });

  it('@ suggests the team’s agents; Enter completes the mention, then sends', async () => {
    setup();
    const box = (await screen.findByRole('combobox', { name: 'Message Tether core' })) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '@Bo' } });
    const list = screen.getByRole('listbox', { name: 'Mention' });
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Boltcode']);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('@Bolt ');
    fireEvent.change(box, { target: { value: '@Bolt fix the typo' } });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(calls('POST', '/api/teams/core/messages')[0]?.[2]).toEqual({ text: '@Bolt fix the typo' }));
  });
});
