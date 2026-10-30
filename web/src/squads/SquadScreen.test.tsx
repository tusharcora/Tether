import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import type { GoalView } from '../goals/goalsApi';
import type { Card, TeamMessage, TeamView } from '../teams/teamsApi';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { SquadScreen } from './SquadScreen';

const NOW = Date.now();
const you = { kind: 'person' as const, id: 'owner', name: 'you' };
const bolt = { kind: 'agent' as const, id: 'coder', name: 'Bolt' };
const lens = { kind: 'agent' as const, id: 'reviewer', name: 'Lens' };
const msg = (id: string, from: TeamMessage['from'], text: string, o: Partial<TeamMessage> = {}): TeamMessage => ({ id, at: NOW - 60_000, from, text, ...o });
type Ship = Extract<Card, { kind: 'approval' }>;
const shipCard = (o: Partial<Ship> = {}): Ship => ({ kind: 'approval', what: 'ship', title: 'Ship “Sign-in fix”?', runId: 'r1', node: 'ship', status: 'pending', files: 3, plus: 44, minus: 9, tests: { ok: true, line: 'Tests 24 passed' }, review: { by: 'Lens', pass: true }, ...o });
const view = (ship: Ship = shipCard(), o: Partial<TeamView> = {}): TeamView => ({
  team: { id: 'web', name: 'web', place: 'tether', project: 'acme', agents: ['coder', 'reviewer', 'tester'], people: [{ id: 'owner', name: 'you' }], approvers: 'any', level: 'balanced', limits: { usdPerDay: 10, runsPerDay: 20 }, learn: true, createdAt: 1 },
  messages: [
    msg('m1', you, '@Bolt people land on /home after sign-in. can you fix it?', { pinned: { by: 'you', at: 5 } }),
    msg('m2', bolt, 'Fixed it. 3 files, tests pass. @Lens mind checking the redirect check?', {
      run: 'r1',
      ticket: 't142',
      handoff: { to: 'reviewer', name: 'Lens', review: true },
      reactions: { Nice: ['you'] },
      report: '## Summary of changes\nI changed callback.ts.',
      work: { files: ['auth/callback.ts', 'auth/sameSite.ts', 'callback.test.ts'], plus: 42, minus: 9, ran: [{ command: 'npm test -- auth', ok: true, summary: '24 passed' }], ms: 220_000, model: 'sonnet' },
    }),
    msg('m3', lens, 'One thing: //evil.com still counts as same-site. @Bolt can you reject those too?', { run: 'r1' }),
    msg('t1', bolt, 'Good catch. Now rejecting anything starting with //, plus a test.', { thread: 'm3' }),
    msg('t2', lens, 'Checked it. Good to go from me.', { thread: 'm3' }),
    msg('m4', bolt, '@you ready when you are.', { run: 'r1', ticket: 't142', card: ship }),
    msg('m5', lens, "Reading Bolt's change…", { pending: true }),
  ],
  members: [
    { id: 'coder', name: 'Bolt', specialty: 'code', state: 'coding', line: 'editing Tabs.tsx', since: NOW - 72_000, progress: 0.5, title: 'Remember the last settings tab', ticket: 't145', runId: 'r2' },
    { id: 'reviewer', name: 'Lens', specialty: 'review', state: 'reviewing', line: "reading Bolt's change" },
    { id: 'tester', name: 'Probe', specialty: 'tests', state: 'idle' },
  ],
  queue: [{ id: 'q1', bot: 'tester', task: 'fix the billing crash', msg: 'm1', ticket: 't143', at: 1 }],
  working: [],
  spend: { usd: 0.63, runs: 2 },
  status: 'needs',
  ...o,
});
const tk = (o: Partial<GoalView>): GoalView => ({ workspace: 'acme', kind: 'tracker', status: 'active', approval: 'ask', workflow: 'team', createdAt: NOW, spentUsd: 0, items: [], progress: 0, criteria: [], squad: 'web', stage: 'todo', ...o }) as GoalView;
const tickets = [
  tk({ id: 't142', key: 'WEB-142', title: 'Sign-in fix', stage: 'in_review', criteria: [{ id: 'check', text: 'npm test passes', done: true, auto: true }, { id: 'i1', text: 'lands on ?next=', done: true, item: 1 }] }),
  tk({ id: 't145', key: 'WEB-145', title: 'Remember the last settings tab', stage: 'in_progress' }),
  tk({ id: 't143', key: 'WEB-143', title: 'Billing crash', stage: 'todo' }),
  tk({ id: 't141', key: 'WEB-141', title: 'Dark mode for settings', stage: 'done', endedAt: NOW - 1000, prs: [{ number: 141, url: 'u', merged: true }] }),
  tk({ id: 't130', key: 'WEB-130', title: 'Nightly test triage', kind: 'loop', team: 'web', stage: 'in_progress' }),
];

function setup(v: TeamView = view()) {
  routeApi({
    'GET /api/squads/web': v,
    'GET /api/schedules': [{ id: 's1', name: 'nightly', cron: '0 2 * * *', target: { kind: 'goal', goalId: 't130' }, enabled: true, nextAt: new Date(2026, 10, 1, 2, 0).toISOString() }],
    'POST /api/squads/web/messages': { id: 'm9' },
    'POST /api/squads/web/cards/m4': (b: unknown) => ({ ...v.messages[5], b }),
    'POST /api/squads/web/cards/m4/undo': v.messages[5],
    'POST /api/squads/web/messages/m2/react': v.messages[1],
    'POST /api/squads/web/messages/m2/pin': v.messages[1],
    'GET /api/squads/web/diff/m4': { diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n', truncated: false },
    'GET /api/squads/web/diff/m2': { diff: '', truncated: false },
  });
  const p = { onGo: vi.fn(), onChanged: vi.fn(), onNewAgent: vi.fn() };
  renderApp(<SquadScreen id="web" tickets={tickets} agents={[]} projects={[{ id: 'acme', name: 'acme-web', path: '/p', isDefault: true, exists: true, repos: [] }]} {...p} />);
  return p;
}
const messages = () => screen.getByRole('list', { name: 'Messages' });
const rowOf = (text: string | RegExp) => screen.getByText(text).closest('li') as HTMLElement;

beforeEach(() => {
  vi.mocked(api).mockReset();
  localStorage.clear();
});

describe('a squad (board 8)', () => {
  it('heads the channel: name, project, who is working, what needs you, today’s spend; Chat | Map', async () => {
    setup();
    const h = await screen.findByRole('heading', { level: 1 });
    expect(h.textContent).toBe('# web');
    expect(screen.getByText(/^acme-web · 2 working/).textContent).toBe('acme-web · 2 working · 1 needs you · $0.63 today');
    expect(screen.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true');
    // reading the squad marks it seen for the sidebar's unread count
    expect(JSON.parse(localStorage.getItem('tether.squads.seen')!).web).toBeGreaterThan(NOW - 5000);
  });

  it('Right now: a card per busy agent, a You card, the free ones; a card filters the channel and Show everyone clears it', async () => {
    setup();
    const strip = await screen.findByRole('region', { name: 'Right now' });
    const boltCard = within(strip).getByRole('button', { name: /^Bolt/ });
    expect(within(boltCard).getByText('editing Tabs.tsx')).toBeTruthy();
    expect(within(boltCard).getByText(/^1:1\d$/)).toBeTruthy();
    expect(within(boltCard).getByText('Remember the last settings tab · WEB-145')).toBeTruthy();
    const youCard = within(strip).getByRole('button', { name: /^Y?You/ });
    expect(within(youCard).getByText('1 thing to decide')).toBeTruthy();
    expect(within(youCard).getByText('Ship “Sign-in fix”?')).toBeTruthy();
    expect(within(strip).getByRole('button', { name: /Probe free/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(strip).getByRole('button', { name: /^Lens/ }));
    expect(within(strip).getByRole('button', { name: /^Lens/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Showing Lens only');
    expect(within(messages()).queryByText(/people land on/)).toBeNull();
    expect(within(messages()).getByText(/One thing/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Show everyone' }));
    expect(within(messages()).getByText(/people land on/)).toBeTruthy();
  });

  it('a message in a teammate’s voice: What I did behind it, the hand-off chip, reactions, hover actions', async () => {
    const p = setup();
    await screen.findByRole('list', { name: 'Messages' });
    const row = rowOf(/^Fixed it\./);
    expect(within(row).getByText('Lens').closest('.sq-handoff')!.textContent).toBe('Handed to Lens for a review');
    const what = within(row).getByRole('button', { name: /What I did/ });
    expect(what.getAttribute('aria-expanded')).toBe('false');
    expect(what.textContent).toContain('3 files · +42 −9 · 3m 40s · sonnet');
    fireEvent.click(what);
    expect(within(row).getByText('auth/callback.ts · auth/sameSite.ts · callback.test.ts')).toBeTruthy();
    expect(within(row).getByText('npm test -- auth')).toBeTruthy();
    expect(within(row).getByText('24 passed')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Full report' }));
    expect((await screen.findByRole('dialog', { name: /Bolt's full report/ })).textContent).toContain('## Summary of changes');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(within(row.querySelector('.sq-links') as HTMLElement).getByRole('button', { name: 'Open the run' }));
    expect(p.onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r1' });
    // reactions: a chip per reaction (yours pressed), and the toolbar's React menu
    const nice = within(row).getByRole('button', { name: 'Nice: you' });
    expect(nice.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(nice);
    await waitFor(() => expect(calls('POST', '/api/squads/web/messages/m2/react')[0]![2]).toEqual({ reaction: 'Nice' }));
    const bar = within(row).getByRole('toolbar', { name: 'Message actions' });
    fireEvent.click(within(bar).getByRole('button', { name: 'React' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Thanks' }));
    await waitFor(() => expect(calls('POST', '/api/squads/web/messages/m2/react')[1]![2]).toEqual({ reaction: 'Thanks' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Pin to the pulse' }));
    await waitFor(() => expect(calls('POST', '/api/squads/web/messages/m2/pin')[0]![2]).toEqual({ on: true }));
    expect(within(bar).getByRole('button', { name: 'Reply in thread' })).toBeTruthy();
  });

  it('a thread opens on the right in place of the pulse; a reply goes in it; closing brings the pulse back', async () => {
    setup();
    await screen.findByRole('list', { name: 'Messages' });
    expect(within(messages()).queryByText(/Good catch/)).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Squad pulse' })).toBeTruthy();
    fireEvent.click(within(rowOf(/^One thing/)).getByRole('button', { name: /2 replies · Lens checked it/ }));
    const thread = screen.getByRole('complementary', { name: 'Thread' });
    expect(screen.queryByRole('complementary', { name: 'Squad pulse' })).toBeNull();
    expect(within(thread).getByText(/Good catch/)).toBeTruthy();
    expect(within(thread).getByText('Checked it. Good to go from me.')).toBeTruthy();
    fireEvent.change(within(thread).getByLabelText('Reply in the thread'), { target: { value: 'nice, thanks both' } });
    fireEvent.click(within(thread).getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(calls('POST', '/api/squads/web/messages')[0]![2]).toEqual({ text: 'nice, thanks both', thread: 'm3' }));
    fireEvent.click(within(thread).getByRole('button', { name: 'Close thread' }));
    expect(screen.getByRole('complementary', { name: 'Squad pulse' })).toBeTruthy();
  });

  it('the typing line says who is writing and what they are doing', async () => {
    setup();
    expect((await screen.findByLabelText("Lens is reading Bolt's change")).textContent).toContain("Lens is reading Bolt's change");
  });
});

describe('the ship card (board 8)', () => {
  it('pending: the +/− bar, chips for tests, review, criteria and size; Ship it, See the diff, Not yet with a reason', async () => {
    setup();
    const card = await screen.findByRole('group', { name: 'Ship “Sign-in fix”?' });
    expect(within(card).getByRole('img', { name: '44 lines added, 9 removed' })).toBeTruthy();
    for (const chip of ['Tests 24 passed', 'Lens approved', '2/2 criteria', '+44 −9']) expect(within(card).getByText(chip)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'See the diff' }));
    expect(await screen.findByRole('dialog', { name: 'Ship “Sign-in fix”?' })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(within(card).getByRole('button', { name: 'Ship it' }));
    await waitFor(() => expect(calls('POST', '/api/squads/web/cards/m4')[0]![2]).toEqual({ action: 'approve' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Not yet' }));
    fireEvent.change(within(card).getByLabelText(/What should change/), { target: { value: 'also reject backslashes' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Send back' }));
    await waitFor(() => expect(calls('POST', '/api/squads/web/cards/m4')[1]![2]).toEqual({ action: 'reject', reason: 'also reject backslashes' }));
  });

  it('after Ship it: who shipped it and the PR; Undo while it is not merged yet', async () => {
    setup(view(shipCard({ status: 'approved', by: 'you', at: NOW, ship: { state: 'open', pr: { url: 'u', number: 142 } } })));
    const done = await screen.findByText(/^Shipped by You · PR #142 open, merging once checks pass/);
    fireEvent.click(within(done).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(calls('POST', '/api/squads/web/cards/m4/undo')).toHaveLength(1));
  });

  it('merged: no Undo', async () => {
    setup(view(shipCard({ status: 'approved', by: 'you', ship: { state: 'merged', pr: { url: 'u', number: 142 } } })));
    const done = await screen.findByText(/^Shipped by You · PR #142 merged/);
    expect(within(done).queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

describe('the composer (board 8)', () => {
  it('@ opens the picker with each agent’s availability; suggestions fill the box; Enter sends', async () => {
    setup();
    const box = (await screen.findByRole('combobox', { name: 'Message # web' })) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole('button', { name: 'Mention someone' }));
    const list = screen.getByRole('listbox', { name: 'Mention' });
    const opts = within(list).getAllByRole('option');
    expect(opts.map((o) => o.textContent)).toEqual(['Boltbusy · will queue', 'Lensbusy · will queue', 'Probefree now']);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('@Probe ');
    fireEvent.change(box, { target: { value: '@Probe run the billing tests' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(calls('POST', '/api/squads/web/messages')[0]![2]).toEqual({ text: '@Probe run the billing tests' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask Bolt to…' }));
    expect((screen.getByRole('combobox', { name: 'Message # web' }) as HTMLTextAreaElement).value).toBe('@Bolt ');
    expect(screen.getByRole('button', { name: 'Have Lens review a PR' })).toBeTruthy();
    expect(screen.getByRole('button', { name: "What's everyone doing?" })).toBeTruthy();
  });
});

describe('the squad pulse (board 8)', () => {
  it('tickets per status (opening the board on this squad), shipped today with five days, what is coming up, what is pinned', async () => {
    const p = setup();
    const pulse = await screen.findByRole('complementary', { name: 'Squad pulse' });
    expect(within(pulse).getAllByRole('button', { name: /: open the board$/ }).map((b) => b.getAttribute('aria-label'))).toEqual(['1 Todo: open the board', '2 Doing: open the board', '1 Review: open the board', '1 Done: open the board']);
    fireEvent.click(within(pulse).getByRole('button', { name: '1 Review: open the board' }));
    expect(p.onGo).toHaveBeenCalledWith({ tab: 'tickets', squad: 'web' });
    expect(within(pulse).getByText('WEB-141 Dark mode for settings')).toBeTruthy();
    expect(within(pulse).getByText('#141')).toBeTruthy();
    expect(within(pulse).getByRole('img', { name: /^Tickets shipped per day, last 5 days: 0, 0, 0, 0, 1$/ })).toBeTruthy();
    expect(within(pulse).getByText('Probe picks up WEB-143 next')).toBeTruthy();
    expect(within(pulse).getByText('Nightly test triage')).toBeTruthy();
    expect(within(pulse).getByText(/^0?2:00/)).toBeTruthy();
    expect(within(pulse).getByRole('button', { name: /Decision · @Bolt people land on/ })).toBeTruthy();
  });

  it('the Map: who handed work to whom today, live lines while the work goes on', async () => {
    setup();
    fireEvent.click(await screen.findByRole('tab', { name: 'Map' }));
    expect(screen.getByRole('img', { name: /^Who handed work to whom today: You to Bolt \(live\), Bolt to Lens \(live\)/ })).toBeTruthy();
    expect(screen.getByText('Lines show who handed work to whom today · moving lines are live')).toBeTruthy();
  });
});
