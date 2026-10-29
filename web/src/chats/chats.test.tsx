import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../api';
import { api, ApiError } from '../api';
import { App } from '../App';
import type { ChatSummary, StreamEvent } from '../assistant/api';
import { calls, routeApi } from '../test/fixtures';
import { starters } from './NewChat';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
vi.mock('../home/Home', () => ({ Home: () => <div>home screen</div> }));
const turn = vi.hoisted(() => ({ bodies: [] as unknown[] }));
vi.mock('../assistant/api', async (orig) => ({
  ...(await orig<typeof import('../assistant/api')>()),
  streamTurn: async (body: unknown, on: (e: StreamEvent) => void) => {
    turn.bodies.push(body);
    on({ type: 'start', you: { id: 'y1', role: 'you', text: 'hello there', at: 5 }, id: 'r1', chat: 'c9', title: 'hello there' });
    on({ type: 'done', message: { id: 'r1', role: 'tether', text: 'General Kenobi.', at: 6 } });
  },
}));

const summary = (id: string, title: string): ChatSummary => ({ id, title, updated: 1, count: 2, last: 'ok', kind: 'answer', outcome: [], faces: [], cites: [] });
const shop = { id: 'shop', name: 'shop', path: '/code/shop', isDefault: true, exists: true, repos: [] };
const startAt = (hash: string) => history.replaceState(null, '', hash);
const chatsSection = () => screen.findByRole('region', { name: 'Chats' });

beforeEach(() => {
  vi.mocked(api).mockReset();
  localStorage.clear();
  turn.bodies = [];
  startAt('#/home');
  routeApi({
    'GET /api/health': { ok: true },
    'GET /api/crew': { bots: [] },
    'GET /api/runs': [],
    'GET /api/pipelines': [],
    'GET /api/attention': { items: [] },
    'GET /api/workspaces': [shop],
    'GET /api/pins': { pins: [] },
    'GET /api/assistant/chats': { chats: [summary('c2', 'Old chat')] },
    'GET /api/assistant': (_b: unknown, path: string) =>
      path.includes('chat=c2')
        ? { id: 'c2', title: 'Old chat', messages: [{ id: 'm1', role: 'you', text: 'an old question', at: 1 }], agent: 'claude', models: [] }
        : path.includes('chat=')
          ? new ApiError('unknown chat', 404)
          : { messages: [], agent: 'claude', models: [] },
    'PATCH /api/assistant/chats/c2': (b: { title: string }) => ({ chat: summary('c2', b.title) }),
    'DELETE /api/assistant/chats/c2': { ok: true },
  });
});

describe('the full-screen chat', () => {
  it('opens New chat from the sidebar and with ⌘⇧O', async () => {
    render(<App />);
    fireEvent.click(within(await chatsSection()).getAllByRole('button', { name: 'New chat' }).at(-1)!);
    expect(location.hash).toBe('#/chats/new');
    expect(await screen.findByRole('heading', { name: 'What should we look at in shop?' })).toBeTruthy();
    act(() => location.assign('#/home'));
    await screen.findByText('home screen');
    fireEvent.keyDown(window, { key: 'O', metaKey: true, shiftKey: true });
    expect(location.hash).toBe('#/chats/new');
  });

  it('makes the chat with the first message, moves to it, and keeps the launcher away', async () => {
    startAt('#/chats/new');
    render(<App />);
    const box = await screen.findByLabelText('Message Tether');
    fireEvent.change(box, { target: { value: 'hello there' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(location.hash).toBe('#/chats/c9'));
    expect(await screen.findByText('General Kenobi.')).toBeTruthy();
    expect(turn.bodies[0]).toMatchObject({ ws: 'shop', message: 'hello there', context: { page: 'chats' } });
    expect(turn.bodies[0]).not.toHaveProperty('chat');
    expect(screen.queryByRole('button', { name: /Ask Tether/ })).toBeNull();
    expect(localStorage.getItem('tether.assistant.chat.shop')).toBe('c9');
  });

  it('falls back to a new chat for a chat that is gone', async () => {
    startAt('#/chats/gone');
    render(<App />);
    await waitFor(() => expect(location.hash).toBe('#/chats/new'));
  });

  it('pops a chat out into the mini chat over the screen it came from', async () => {
    render(<App />);
    await screen.findByText('home screen');
    fireEvent.click(within(await chatsSection()).getByRole('button', { name: 'Old chat' }));
    expect(location.hash).toBe('#/chats/c2');
    expect(await screen.findByText('an old question')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pop out' }));
    expect(location.hash).toBe('#/home');
    const mini = await screen.findByRole('region', { name: 'Tether assistant' });
    expect(within(mini).getByText('an old question')).toBeTruthy();
  });

  it('lists the chats on All chats, where Pop out opens the mini chat on that chat', async () => {
    render(<App />);
    fireEvent.click(within(await chatsSection()).getByRole('button', { name: 'All chats' }));
    expect(location.hash).toBe('#/chats');
    fireEvent.click(await screen.findByRole('button', { name: 'Old chat, Answer only' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Chat preview' })).getByRole('button', { name: 'Pop out' }));
    const mini = await screen.findByRole('region', { name: 'Tether assistant' });
    expect(within(mini).getByRole('button', { name: 'Switch chat (Old chat)' })).toBeTruthy();
    expect(localStorage.getItem('tether.assistant.chat.shop')).toBe('c2');
  });

  it('renames and deletes the chat from its title menu', async () => {
    startAt('#/chats/c2');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Old chat' , expanded: false }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const field = screen.getByLabelText('Chat title');
    fireEvent.change(field, { target: { value: 'Renamed' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(calls('PATCH', '/api/assistant/chats/c2')).toHaveLength(1));
    expect(await screen.findByRole('button', { name: 'Renamed', expanded: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chat actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(location.hash).toBe('#/chats'));
    expect(calls('DELETE', '/api/assistant/chats/c2?ws=shop')).toHaveLength(1);
  });
});

describe('New chat starters', () => {
  const run = (o: Partial<RunRow>) => ({ id: 'rmh0aaa7d92', status: 'done', startedAt: 1, ...o }) as RunRow;
  it('ask about the last failed run only when one failed, and name the last file opened', () => {
    expect(starters([run({})]).map((s) => s.title)).toEqual(["What's running right now?", 'Plan a change with the crew', 'Explain a file']);
    const s = starters([run({ id: 'rmh0aaa0001', status: 'error', finishedAt: 5 }), run({ id: 'rmh0aaa7d92', status: 'error', finishedAt: 9 })], 'src/http/limit.ts');
    expect(s.map((x) => x.title)).toEqual(["What's running right now?", 'Why did R-7D92 fail?', 'Plan a change with the crew', 'Explain limit.ts']);
    expect(s[1]!.text).toBe('Why did run rmh0aaa7d92 fail?');
  });
});
