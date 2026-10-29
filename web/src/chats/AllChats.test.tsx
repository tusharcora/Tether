import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { ChatSummary, StreamEvent } from '../assistant/api';
import { ToastStackProvider } from '../components/beui/kit/toast';
import { cssRule } from '../test/css';
import { calls, routeApi } from '../test/fixtures';
import { AllChats } from './AllChats';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
const turn = vi.hoisted(() => ({ bodies: [] as unknown[] }));
vi.mock('../assistant/api', async (orig) => ({
  ...(await orig<typeof import('../assistant/api')>()),
  streamTurn: async (body: { message: string }, on: (e: StreamEvent) => void) => {
    turn.bodies.push(body);
    on({ type: 'start', you: { id: 'y9', role: 'you', text: body.message, at: 9 }, id: 'r9', chat: 'c2', title: 'Plan the Teams feature' });
    on({ type: 'done', message: { id: 'r9', role: 'tether', text: 'Then each team gets one channel.', at: 10 } });
  },
}));

const base = { updated: Date.now(), count: 4, last: '', faces: [], cites: [] };
const CHATS: ChatSummary[] = [
  {
    ...base,
    id: 'c1',
    title: 'Why did the README run fail?',
    kind: 'live',
    last: 'Lens is reviewing it now.',
    faces: ['coder', 'reviewer'],
    cites: [{ n: 1, label: 'README', kind: 'file', path: 'README.md' }],
    outcome: [
      { kind: 'Asked', label: 'Why did R-7D92 fail?', state: 'answered', tone: 'done' },
      { kind: 'Proposal', label: 'Fix README CLI section', state: 'approved', tone: 'done' },
      { kind: 'Run', label: 'rmh0aaa4f21', runId: 'rmh0aaa4f21', state: 'running', tone: 'live' },
    ],
  },
  { ...base, id: 'c2', title: 'Plan the Teams feature', kind: 'needs', outcome: [{ kind: 'Asked', label: 'How should Teams work?', state: 'answered', tone: 'done' }, { kind: 'Proposal', label: 'Write the Teams spec', state: 'waiting on you', tone: 'needs' }] },
  { ...base, id: 'c3', title: 'What does Code Mode change?', kind: 'answer', outcome: [{ kind: 'Asked', label: 'What does Code Mode change?', state: 'answered', tone: 'done' }] },
  { ...base, id: 'c4', title: 'Free models: rate limits', kind: 'done', outcome: [{ kind: 'Asked', label: 'q', state: 'answered', tone: 'done' }, { kind: 'Run', label: 'rmh0aaa3a10', runId: 'rmh0aaa3a10', state: 'done · $0.00', tone: 'done' }] },
];
const proposal = { id: 'p2', kind: 'team', task: 'Write docs/specs/teams-design.md', status: 'proposed' };
const props = { ws: 'shop', project: { id: 'shop', name: 'shop' }, onOpen: vi.fn(), onPopOut: vi.fn(), onNew: vi.fn(), onGo: vi.fn(), onTurnDone: vi.fn() };
const mount = (o: Partial<typeof props & { active: string }> = {}) =>
  render(
    <ToastStackProvider>
      <AllChats {...props} {...o} />
    </ToastStackProvider>,
  );
const preview = () => within(screen.getByRole('region', { name: 'Chat preview' }));

beforeEach(() => {
  vi.mocked(api).mockReset();
  turn.bodies = [];
  routeApi({
    'GET /api/assistant/chats': (_b: unknown, path: string) => ({ chats: path.includes('q=readme') ? CHATS.slice(0, 1) : CHATS }),
    'GET /api/assistant': (_b: unknown, path: string) => ({
      title: 'x',
      messages: path.includes('chat=c2')
        ? [
            { id: 'm1', role: 'you', text: 'Agents should message each other like Slack.', at: 1 },
            { id: 'm2', role: 'tether', text: 'Then each team gets one channel.', at: 2, proposals: [proposal] },
          ]
        : [],
      agent: 'claude',
      model: 'opus',
      models: [],
    }),
    'POST /api/assistant/proposals/p2': { proposal: { ...proposal, status: 'started', runId: 'r5' } },
  });
});

describe('All chats', () => {
  it('counts each filter and shows only the chats that need you under Needs you', async () => {
    mount();
    await screen.findByRole('button', { name: 'Plan the Teams feature, Needs you' });
    const filters = screen.getByRole('group', { name: 'Filter chats' });
    const count = (name: RegExp) => within(filters).getByRole('button', { name }).querySelector('.ac-count')!.textContent;
    expect([count(/^All/), count(/^Needs you/), count(/^Live/), count(/^Led to a run/), count(/^Answers only/)]).toEqual(['4', '1', '1', '2', '1']);
    fireEvent.click(within(filters).getByRole('button', { name: /^Needs you/ }));
    const rows = within(screen.getByRole('region', { name: 'Chats' })).getAllByRole('button', { name: /, (Live|Needs you|Done|Failed|Answer only)$/ });
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Plan the Teams feature, Needs you']);
  });

  it('previews a chat: what it led to, its sources, and opens a run or a source', async () => {
    mount();
    expect(await screen.findByRole('heading', { level: 2, name: 'Why did the README run fail?' })).toBeTruthy();
    const flow = preview().getByRole('list', { name: 'What it led to' });
    expect(within(flow).getAllByRole('listitem').map((li) => li.querySelector('.nod-title')?.textContent)).toEqual(['Why did R-7D92 fail?', 'Fix README CLI section', 'R-4F21']);
    expect(flow.querySelector('.ac-link.live')).toBeTruthy();
    fireEvent.click(within(flow).getByRole('button', { name: 'Open run' }));
    expect(props.onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'rmh0aaa4f21' });
    fireEvent.click(preview().getByRole('button', { name: 'README.md' }));
    expect(props.onGo).toHaveBeenCalledWith({ tab: 'code', id: 'README.md' });
    expect(screen.getByText('run R-4F21')).toBeTruthy();
  });

  it('approves a waiting proposal in place, and continues the chat without opening it', async () => {
    mount({ active: 'c2' });
    expect(await screen.findByText('Start a run: Write docs/specs/teams-design.md?')).toBeTruthy();
    fireEvent.click(preview().getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls('POST', '/api/assistant/proposals/p2')[0]?.[2]).toEqual({ ws: 'shop', chat: 'c2', decision: 'start' }));
    fireEvent.change(preview().getByLabelText('Continue this chat'), { target: { value: 'and the handoffs?' } });
    fireEvent.click(preview().getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(turn.bodies[0]).toMatchObject({ ws: 'shop', chat: 'c2', message: 'and the handoffs?', context: { page: 'chats' } }));
    expect(await preview().findByText('and the handoffs?')).toBeTruthy();
    await waitFor(() => expect(props.onTurnDone).toHaveBeenCalledWith('c2'));
  });

  it('opens the chosen chat full screen or pops it out, and starts a new one', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Plan the Teams feature, Needs you' }));
    fireEvent.click(preview().getByRole('button', { name: 'Open chat' }));
    expect(props.onOpen).toHaveBeenCalledWith('c2');
    fireEvent.click(preview().getByRole('button', { name: 'Pop out' }));
    expect(props.onPopOut).toHaveBeenCalledWith('c2');
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(props.onNew).toHaveBeenCalled();
  });

  it('searches on the server once typing settles', async () => {
    mount();
    await screen.findByRole('button', { name: 'Plan the Teams feature, Needs you' });
    fireEvent.change(screen.getByLabelText('Search chats'), { target: { value: 'readme' } });
    await waitFor(() => expect(calls('GET', '/api/assistant/chats?ws=shop&q=readme').length).toBe(1));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Plan the Teams feature, Needs you' })).toBeNull());
  });

  it('stills its row, mark and baton animations under reduced motion', () => {
    expect(cssRule('chats/chats.css', '.ac-row,.ac-mark.live,.ac-mark.needs,.ac-link.live::after', '@media (prefers-reduced-motion: reduce)')).toContain('animation: none');
  });
});
