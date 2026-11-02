import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render';
import type { ChatMessage, SavedPrompt } from './api';
import { ChatComposer, mentioned } from './Chat';
import { promptFrom } from './Prompts';
import { Thread } from './Thread';

const saved: SavedPrompt[] = [{ id: 'p-aaaa1', name: 'Review a file', body: 'Review {{file}} for bugs.', variables: ['file'] }];

/** /api/squads (the crew an @mention can name) and the prompt routes over a fake fetch; the calls it saw. */
function serve() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, path: url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (url === '/api/squads') return new Response(JSON.stringify({ squads: [], agents: [{ id: 'coder', name: 'Bolt', specialty: 'code' }, { id: 'tester', name: 'Probe', specialty: 'tests' }] }));
      if (url.startsWith('/api/assistant/prompts') && method === 'GET') return new Response(JSON.stringify({ prompts: saved }));
      if (url === '/api/assistant/prompts' && method === 'POST') return new Response(JSON.stringify({ prompt: { id: 'p-new01', ...(JSON.parse(String(init!.body)) as object), variables: [] } }));
      return new Response(JSON.stringify({ ok: true }));
    }),
  );
  return calls;
}

const fakeChat = (o: Record<string, unknown> = {}) => ({ ws: 'api', messages: [], models: [], loading: false, queue: [], send: vi.fn(), stop: vi.fn(), compact: vi.fn(async () => {}), turnIntoRun: vi.fn(async () => {}), unqueue: vi.fn(), feedback: vi.fn(), regenerate: vi.fn(), ...o }) as never;

describe('@mentions in the chat', () => {
  it('finds the first crew agent a message mentions', () => {
    const bots = [{ id: 'coder', name: 'Bolt' }, { id: 'tester', name: 'Probe' }];
    expect(mentioned('@Probe then @Bolt', bots)?.id).toBe('tester');
    expect(mentioned('ask @Bolt, please', bots)?.id).toBe('coder');
    expect(mentioned('email bolt@Boltx.dev', bots)).toBeUndefined();
    expect(mentioned('no one', bots)).toBeUndefined();
  });

  it('lists the crew agents after "@" and sends the message to the one named, on its own binding', async () => {
    serve();
    const chat = fakeChat() as unknown as { send: ReturnType<typeof vi.fn> };
    renderApp(<ChatComposer chat={chat as never} context={{ page: 'home' }} />);
    const box = screen.getByLabelText('Message Tether');
    await waitFor(() => {
      fireEvent.change(box, { target: { value: '@b' } });
      expect(screen.getByRole('listbox', { name: 'Mention' })).toBeTruthy();
    });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.change(box, { target: { value: '@Bolt why is the build red?' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(chat.send).toHaveBeenCalledWith('@Bolt why is the build red?', { context: { page: 'home' }, bot: 'coder' });
  });
});

describe('who answered', () => {
  it('a reply by an @mentioned crew agent says so, with its face; Tether’s own replies do not', () => {
    serve();
    const msgs: ChatMessage[] = [
      { id: 'y', role: 'you', text: '@Bolt why?', at: 1 },
      { id: 'a', role: 'tether', text: 'Because the test is flaky.', at: 2, by: { bot: 'coder', name: 'Bolt' } },
      { id: 'b', role: 'tether', text: 'Tether here.', at: 3 },
    ];
    const { container } = renderApp(<Thread chat={fakeChat({ messages: msgs })} onGo={vi.fn()} empty="" />);
    const row = container.querySelector('[data-answered-by="coder"]') as HTMLElement;
    expect(row.textContent).toBe('Bolt· crew agent');
    expect(row.querySelector('[aria-hidden="true"] .face')).toBeTruthy();
    expect(container.querySelectorAll('[data-answered-by]')).toHaveLength(1);
  });
});

describe('slash commands in the chat', () => {
  it('offers what the chat can do now and runs it', async () => {
    serve();
    const onGo = vi.fn();
    const onNewChat = vi.fn();
    const chat = fakeChat({ chatId: 'c1', messages: [{ id: 'a', role: 'tether', text: 'Done.', at: 1 }] }) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    renderApp(<ChatComposer chat={chat as never} context={{ page: 'home' }} onGo={onGo} onNewChat={onNewChat} />);
    const box = screen.getByLabelText('Message Tether');
    fireEvent.change(box, { target: { value: '/' } });
    // nothing is queued and nothing streams: no /clear or /stop; a single model: no /model
    expect(screen.getAllByRole('option').map((o) => o.textContent!.match(/^\/([a-z]+)/)?.[1])).toEqual(['new', 'compact', 'prompts', 'artifacts', 'run']);
    const run = (name: string) => (fireEvent.change(box, { target: { value: `/${name}` } }), fireEvent.keyDown(box, { key: 'Enter' }));
    run('new');
    expect(onNewChat).toHaveBeenCalled();
    run('compact');
    expect(chat.compact).toHaveBeenCalled();
    run('artifacts');
    expect(onGo).toHaveBeenCalledWith({ tab: 'artifacts' });
    run('run');
    expect(chat.turnIntoRun).toHaveBeenCalledWith('a');
    run('prompts');
    expect(await screen.findByRole('dialog', { name: 'Saved prompts' })).toBeTruthy();
  });
});

describe('the prompt library', () => {
  it('opens from the composer, inserts a prompt into the message with its {{vars}} left to fill', async () => {
    serve();
    renderApp(<ChatComposer chat={fakeChat()} context={{ page: 'home' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Saved prompts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Saved prompts' });
    const option = await within(dialog).findByRole('option', { name: /Review a file/ });
    expect(option.textContent).toContain('1 var');
    fireEvent.click(option);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    expect((screen.getByLabelText('Message Tether') as HTMLTextAreaElement).value).toBe('Review {{file}} for bugs.');
  });

  it('+ New saves a prompt to the project', async () => {
    const calls = serve();
    renderApp(<ChatComposer chat={fakeChat()} context={{ page: 'home' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Saved prompts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Saved prompts' });
    fireEvent.click(within(dialog).getByRole('button', { name: '+ New' }));
    fireEvent.change(within(dialog).getByLabelText('Prompt name'), { target: { value: 'Explain' } });
    fireEvent.change(within(dialog).getByLabelText('Prompt'), { target: { value: 'Explain {{thing}}' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save prompt' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', path: '/api/assistant/prompts', body: { ws: 'api', name: 'Explain', body: 'Explain {{thing}}' } }));
  });

  it('Save as prompt under a message you sent saves it, named by its first line', async () => {
    const calls = serve();
    const you: ChatMessage = { id: 'y', role: 'you', text: 'Summarize the failing tests\nand propose fixes', at: 1 };
    renderApp(<Thread chat={fakeChat({ messages: [you] })} onGo={vi.fn()} empty="" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as prompt' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', path: '/api/assistant/prompts', body: { ws: 'api', ...promptFrom(you.text) } }));
    expect(promptFrom(you.text)).toEqual({ name: 'Summarize the failing tests', body: 'Summarize the failing tests\nand propose fixes' });
    expect(await screen.findByText('Saved as a prompt')).toBeTruthy();
  });
});
