import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import type { GoalView } from '../goals/goalsApi';
import type { TeamsReply } from '../teams/teamsApi';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { Tickets } from './Tickets';

const NOW = Date.now();
const project = { id: 'web', name: 'acme-web', path: '/code/web', isDefault: true, exists: true, repos: [] };
const bolt = { kind: 'agent' as const, id: 'coder', name: 'Bolt' };
const lens = { kind: 'agent' as const, id: 'reviewer', name: 'Lens' };
const tk = (o: Partial<GoalView>): GoalView => ({ workspace: 'web', kind: 'tracker', status: 'active', approval: 'ask', workflow: 'team', createdAt: NOW - 3_600_000, spentUsd: 0, items: [], progress: 0, criteria: [], ...o }) as GoalView;
const review = tk({
  id: 't142',
  key: 'WEB-142',
  num: 142,
  title: 'Sign-in returns people to where they were',
  description: 'After signing in, people land on /home instead of the page they came from.',
  type: 'bugfix',
  stage: 'in_review',
  priority: 'high',
  squad: 'web',
  assignee: { kind: 'agent', id: 'coder' },
  reviewer: { kind: 'agent', id: 'reviewer' },
  needs: 'Ready to ship: it waits for your approval',
  spentUsd: 0.63,
  prs: [{ number: 142, url: 'https://github.com/o/r/pull/142', runId: 'r1' }],
  criteria: [
    { id: 'check', text: 'npm test -- auth passes', done: true, auto: true },
    { id: 'i1', text: 'After sign-in, people land on ?next=', done: true, item: 1 },
  ],
  origin: { kind: 'squad', squad: 'web', message: 'm1' },
  activity: [
    { at: NOW - 600_000, who: { kind: 'person', id: 'owner', name: 'You' }, text: 'asked for this in # web' },
    { at: NOW - 500_000, who: bolt, text: 'Fixed it. 3 files, tests pass.', runId: 'r1' },
    { at: NOW - 400_000, who: lens, text: 'Checked it. Good to go from me.', verdict: 'pass' },
  ],
});
const live = tk({ id: 't145', key: 'WEB-145', num: 145, title: 'Remember the last settings tab', stage: 'in_progress', priority: 'medium', squad: 'web', assignee: { kind: 'agent', id: 'coder' } });
const backlog = tk({ id: 't144', key: 'WEB-144', num: 144, title: 'Keyboard shortcuts for the settings tabs', stage: 'todo', status: 'paused', priority: 'low', squad: 'web', labels: ['settings'] });
const bug = tk({ id: 't143', key: 'WEB-143', num: 143, title: 'Billing page crashes with an empty cart', type: 'bugfix', stage: 'todo', status: 'paused', priority: 'urgent', squad: 'web', assignee: { kind: 'agent', id: 'tester' } });
const done = tk({ id: 't141', key: 'WEB-141', num: 141, title: 'Dark mode for settings', stage: 'done', status: 'met', endedAt: NOW - 1000, prs: [{ number: 141, url: 'u', merged: true }] });
const canceled = tk({ id: 't140', key: 'WEB-140', num: 140, title: 'Old idea', stage: 'canceled', status: 'stopped' });
const squads: TeamsReply = {
  squads: [{ id: 'web', name: 'web', place: 'tether', project: 'web', agents: ['coder', 'reviewer', 'tester', 'manager'], status: 'live', needs: 1, recent: [], queue: [{ id: 'q1', bot: 'tester', task: 'fix the billing crash', msg: 'm9', ticket: 't143', at: 1 }] }],
  agents: [
    { id: 'coder', name: 'Bolt', specialty: 'code', state: 'coding', line: 'editing Tabs.tsx', since: NOW - 72_000, progress: 0.5, ticket: 't145' },
    { id: 'reviewer', name: 'Lens', specialty: 'review', state: 'idle' },
    { id: 'tester', name: 'Probe', specialty: 'tests', state: 'coding' },
    { id: 'manager', name: 'Boss', specialty: 'plans', state: 'idle' },
  ],
};
const all = [review, live, backlog, bug, done, canceled];

function setup(o: { tickets?: GoalView[]; ideas?: unknown[]; selected?: string; squads?: TeamsReply } = {}) {
  routeApi({
    'GET /api/tickets/ideas': o.ideas ?? [],
    'POST /api/tickets/t142/ship': { ...review, stage: 'done' },
    'POST /api/tickets/t142/send-back': { ...review, stage: 'in_progress' },
    'POST /api/tickets/t142/comments': (b: { text: string }) => ({ ...review, activity: [...review.activity!, { at: NOW, who: { kind: 'person', id: 'owner', name: 'You' }, text: b.text }] }),
    'PATCH /api/tickets/t142': (b: Record<string, unknown>) => ({ ...review, ...b }),
    'PATCH /api/tickets/t144': (b: Record<string, unknown>) => ({ ...backlog, ...b }),
    'POST /api/tickets/t144/start': { ...backlog, stage: 'in_progress', status: 'active' },
    'POST /api/squads/web/queue/q1/start': { runId: 'r9' },
    'POST /api/tickets/ideas': { ...backlog, id: 'tnew', key: 'WEB-146', title: 'Add a loading state to search', stage: 'backlog' },
    'POST /api/tickets': (b: Record<string, unknown>) => tk({ id: 'tmade', key: 'WEB-147', ...b }),
  });
  const p = { onTicket: vi.fn(), onSelect: vi.fn(), onGo: vi.fn(), onSquadsChanged: vi.fn() };
  renderApp(<Tickets tickets={o.tickets ?? all} project={project} squads={o.squads ?? squads} selected={o.selected} {...p} />);
  return p;
}

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('Tickets (board 10)', () => {
  it('heads the screen and shows This week: shipped with its days, in flight and who, Todo → Done, the oldest wait on you', () => {
    const p = setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Tickets' })).toBeTruthy();
    expect(screen.getByText('acme-web · 1 in progress · 1 waiting on you')).toBeTruthy();
    const week = screen.getByRole('region', { name: 'This week' });
    expect(within(week).getByText('shipped this week')).toBeTruthy();
    expect(within(week).getByRole('img', { name: /^Shipped per day this week: / })).toBeTruthy();
    expect(within(week).getByText('in flight · Bolt')).toBeTruthy();
    expect(within(week).getByText('avg. Todo → Done')).toBeTruthy();
    fireEvent.click(within(week).getByRole('button', { name: /oldest waiting on you · WEB-142/ }));
    expect(p.onSelect).toHaveBeenCalledWith('t142');
  });

  it('a column per status with its cards: type, key, priority, live work, review chips, a struck-through Done', () => {
    setup();
    const board = screen.getByRole('region', { name: 'Board' });
    const col = (name: string) => within(board).getByRole('group', { name });
    expect(within(col('Todo')).getAllByRole('button', { name: /^WEB-/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['WEB-143 Billing page crashes with an empty cart', 'WEB-144 Keyboard shortcuts for the settings tabs']);
    expect(within(col('Todo')).getByRole('img', { name: 'Urgent priority' })).toBeTruthy();
    expect(within(col('Todo')).getByText('Probe picks it up next')).toBeTruthy();
    const working = within(col('In progress')).getByRole('button', { name: /WEB-145/ });
    expect(within(working).getByText('Bolt · editing Tabs.tsx')).toBeTruthy();
    expect(within(working).getByText(/^1:1\d$/)).toBeTruthy();
    const inReview = within(col('In review')).getByRole('button', { name: /WEB-142/ });
    expect(within(inReview).getByText('needs you')).toBeTruthy();
    expect(within(inReview).getByText('2/2 criteria')).toBeTruthy();
    expect(within(inReview).getByText('PR #142')).toBeTruthy();
    const shipped = within(col('Done')).getByRole('button', { name: /WEB-141/ });
    expect(within(shipped).getByText('PR #141 merged')).toBeTruthy();
    expect(within(board).queryByText('Old idea')).toBeNull();
  });

  it('filters: Needs me, Bugs, a squad, an assignee; Canceled shows in the List', () => {
    setup();
    const board = () => screen.getByRole('region', { name: 'Board' });
    fireEvent.click(screen.getByRole('button', { name: 'Needs me' }));
    expect(screen.getByRole('button', { name: 'Needs me' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(board()).getAllByRole('button', { name: /^WEB-/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['WEB-142 Sign-in returns people to where they were']);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bugs' }));
    expect(within(board()).getAllByRole('button', { name: /^WEB-/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Assignee' }), { target: { value: 'tester' } });
    expect(within(board()).getAllByRole('button', { name: /^WEB-/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['WEB-143 Billing page crashes with an empty cart']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Assignee' }), { target: { value: '*' } });
    fireEvent.click(screen.getByRole('button', { name: 'Canceled' }));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent)).toEqual(['WEB-140']);
  });

  it('the List: key, title, status, priority, assignee, squad, updated', () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: 'List' }));
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(within(rows[0]!).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Key', 'Title', 'Status', 'Priority', 'Assignee', 'Squad', 'Updated']);
    const [key, , status, , assignee, squad] = within(rows[1]!).getAllByRole('cell').map((c) => c.textContent?.trim());
    expect([key, status, assignee, squad]).toEqual(['WEB-144', 'Todo', '—', '# web']);
  });

  it('the detail panel: properties, criteria (one checked automatically), the ship banner, activity and a comment', async () => {
    const p = setup({ selected: 't142' });
    const panel = screen.getByRole('complementary', { name: 'Ticket' });
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe('Sign-in returns people to where they were');
    expect((within(panel).getByLabelText('Status') as HTMLSelectElement).value).toBe('in_review');
    expect((within(panel).getByLabelText('Priority') as HTMLSelectElement).value).toBe('high');
    expect((within(panel).getByLabelText('Reviewer') as HTMLSelectElement).value).toBe('reviewer');
    expect(within(panel).getByText('$0.63')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'PR #142' }).getAttribute('href')).toBe('https://github.com/o/r/pull/142');
    expect(within(panel).getByText('(checked automatically)')).toBeTruthy();
    expect((within(panel).getByRole('checkbox', { name: /npm test -- auth passes/ }) as HTMLInputElement).disabled).toBe(true);
    const ship = within(panel).getByRole('group', { name: 'Ship' });
    expect(within(ship).getByText('All criteria met and Lens approved. Ship it?')).toBeTruthy();
    fireEvent.click(within(ship).getByRole('button', { name: 'Merge PR #142' }));
    await waitFor(() => expect(calls('POST', '/api/tickets/t142/ship')).toHaveLength(1));
    await waitFor(() => expect(p.onTicket).toHaveBeenCalledWith(expect.objectContaining({ stage: 'done' })));
    fireEvent.click(within(ship).getByRole('button', { name: 'Send back' }));
    await waitFor(() => expect(calls('POST', '/api/tickets/t142/send-back')).toHaveLength(1));
    expect(within(panel).getByText('Checked it. Good to go from me.')).toBeTruthy();
    fireEvent.change(within(panel).getByLabelText('Comment'), { target: { value: '@Bolt also the mobile view' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(calls('POST', '/api/tickets/t142/comments')[0]![2]).toEqual({ text: '@Bolt also the mobile view' }));
    fireEvent.change(within(panel).getByLabelText('Status'), { target: { value: 'backlog' } });
    await waitFor(() => expect(calls('PATCH', '/api/tickets/t142')[0]![2]).toEqual({ stage: 'backlog' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'a message in # web' }));
    expect(p.onGo).toHaveBeenCalledWith({ tab: 'squads', id: 'web' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Close ticket' }));
    expect(p.onSelect).toHaveBeenLastCalledWith(undefined);
  });

  it('a ticket waiting for its Start is handed to its squad agent', async () => {
    setup({ selected: 't143' });
    expect(within(screen.getByRole('complementary', { name: 'Ticket' })).getByRole('button', { name: 'Hand to Probe' })).toBeTruthy();
  });
});

describe('the Backlog and Todo helpers (board 10)', () => {
  it('Ideas from your chats: “+” makes a ticket; hidden when there are none', async () => {
    const p = setup({ ideas: [{ chat: 'c1', proposal: 'p1', title: 'Add a loading state to search', type: 'feature', at: 1 }] });
    const box = await screen.findByText('Ideas from your chats');
    fireEvent.click(within(box.parentElement!).getByRole('button', { name: 'Make a ticket: Add a loading state to search' }));
    await waitFor(() => expect(calls('POST', '/api/tickets/ideas')[0]![2]).toEqual({ workspace: 'web', chat: 'c1', proposal: 'p1' }));
    await waitFor(() => expect(p.onTicket).toHaveBeenCalledWith(expect.objectContaining({ key: 'WEB-146' })));
    expect(within(box.parentElement!).getByText('Or type in any chat: "make a ticket to…"')).toBeTruthy();
  });

  it('Ready for an agent: Assign a free agent (it starts), or Start a queued pickup now; hidden when nothing is real', async () => {
    const p = setup();
    const box = screen.getByText('Ready for an agent').parentElement!;
    expect(within(box).getByText(/is free · could take WEB-144/)).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(calls('PATCH', '/api/tickets/t144')[0]![2]).toEqual({ assignee: { kind: 'agent', id: 'reviewer' } }));
    await waitFor(() => expect(calls('POST', '/api/tickets/t144/start')).toHaveLength(1));
    expect(within(box).getByText('· picks up WEB-143 next')).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: 'Start now' }));
    await waitFor(() => expect(calls('POST', '/api/squads/web/queue/q1/start')).toHaveLength(1));
    await waitFor(() => expect(p.onSquadsChanged).toHaveBeenCalled());
  });

  it('no idea, no free agent, no queue: neither box shows', async () => {
    setup({ tickets: [done], squads: { squads: [{ ...squads.squads[0]!, queue: [] }], agents: [] } });
    await waitFor(() => expect(calls('GET', '/api/tickets/ideas?ws=web')).toHaveLength(1));
    expect(screen.queryByText('Ideas from your chats')).toBeNull();
    expect(screen.queryByText('Ready for an agent')).toBeNull();
    expect(screen.queryByText(/oldest waiting on you/)).toBeNull();
  });
});

describe('ticket keys', () => {
  it('the project’s key prefix is editable; every key follows it', async () => {
    const p = setup();
    routeApi({ 'PUT /api/tickets/prefix': { workspace: 'web', prefix: 'ACME' }, 'GET /api/tickets': [{ ...review, key: 'ACME-142' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Ticket keys start with WEB: change' }));
    fireEvent.change(screen.getByLabelText('Key prefix'), { target: { value: 'acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('PUT', '/api/tickets/prefix')[0]![2]).toEqual({ workspace: 'web', prefix: 'ACME' }));
    await waitFor(() => expect(p.onTicket).toHaveBeenCalledWith(expect.objectContaining({ key: 'ACME-142' })));
  });
});

describe('New ticket', () => {
  it('makes a ticket from its fields', async () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Keep ?next= after sign-in' } });
    fireEvent.change(within(dialog).getByLabelText('Type'), { target: { value: 'bugfix' } });
    fireEvent.change(within(dialog).getByLabelText('Priority'), { target: { value: 'high' } });
    fireEvent.change(within(dialog).getByLabelText('Squad'), { target: { value: 'web' } });
    fireEvent.change(within(dialog).getByLabelText('Assignee'), { target: { value: 'coder' } });
    fireEvent.change(within(dialog).getByLabelText('Labels (comma separated)'), { target: { value: 'auth, redirects' } });
    fireEvent.change(within(dialog).getByLabelText('Acceptance criteria (one per line)'), { target: { value: 'Lands on ?next=\nRejects //evil.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create ticket' }));
    await waitFor(() =>
      expect(calls('POST', '/api/tickets')[0]![2]).toEqual({ title: 'Keep ?next= after sign-in', workspace: 'web', type: 'bugfix', priority: 'high', stage: 'todo', recurring: false, squad: 'web', assignee: { kind: 'agent', id: 'coder' }, labels: ['auth', 'redirects'], criteria: ['Lands on ?next=', 'Rejects //evil.com'] }),
    );
    await waitFor(() => expect(p.onSelect).toHaveBeenCalledWith('tmade'));
  });
});
