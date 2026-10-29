import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastStackProvider } from '../components/beui/kit/toast';
import type { ChatMessage, StreamEvent } from './api';
import { Chat } from './Chat';
import { useAssistant } from './useAssistant';

const tether: ChatMessage = {
  id: 'm2',
  role: 'tether',
  text: 'See limit.ts.',
  at: 2,
  cites: [{ n: 1, label: 'limit.ts', kind: 'file', path: 'src/limit.ts', line: 3 }],
  proposals: [{ id: 'p1', kind: 'team', task: 'add a test', why: 'you asked', status: 'proposed' }],
  toolAsks: [{ id: 't1', what: 'comment on o/r#4', status: 'pending' }],
};
const api = vi.hoisted(() => ({
  decide: vi.fn(async () => ({ proposal: { id: 'p1', kind: 'team', task: 'add a test', status: 'started', runId: 'r7' } })),
  tool: vi.fn(async () => ({ ask: { id: 't1', what: 'comment on o/r#4', status: 'once' } })),
  turn: undefined as undefined | ((body: unknown, on: (e: StreamEvent) => void, signal: AbortSignal) => Promise<void>),
  bodies: [] as unknown[],
}));
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  assistantApi: { chat: async () => ({ messages: [{ id: 'm1', role: 'you', text: 'q', at: 1 }, tether], agent: 'claude', models: [] }), decide: api.decide, tool: api.tool, feedback: async () => ({ ok: true }) },
  streamTurn: (body: unknown, on: (e: StreamEvent) => void, signal: AbortSignal) => (api.bodies.push(body), api.turn!(body, on, signal)),
}));

function Harness({ onGo }: { onGo: (r: unknown) => void }) {
  const chat = useAssistant('api', 'c1', true);
  return <Chat chat={chat} project="api" context={{ page: 'runs' }} onGo={onGo} />;
}
const mount = (onGo = vi.fn()) =>
  render(
    <ToastStackProvider>
      <Harness onGo={onGo} />
    </ToastStackProvider>,
  );

describe('the chat', () => {
  it('opens a citation inside the app', async () => {
    const onGo = vi.fn();
    mount(onGo);
    await screen.findByText('See limit.ts.');
    fireEvent.click(screen.getByRole('button', { name: /1 source/ }));
    fireEvent.click(await screen.findByRole('button', { name: /limit\.ts/ }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'code', id: 'src/limit.ts', line: 3 });
  });

  it('starts a run only when Start run is clicked, and shows it started', async () => {
    mount();
    await screen.findByText('add a test');
    expect(api.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith('api', 'c1', 'p1', 'start'));
    expect(await screen.findByRole('button', { name: 'Open run' })).toBeTruthy();
  });

  it('sends a tool decision', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Allow once/ }));
    await waitFor(() => expect(api.tool).toHaveBeenCalledWith('api', 'c1', 't1', 'once'));
  });

  it('streams the reply as it arrives, hides the data block, and Stop keeps what was written', async () => {
    api.turn = (_b, on, signal) =>
      new Promise<void>((_resolve, reject) => {
        on({ type: 'start', you: { id: 'y', role: 'you', text: 'hello', at: 3 }, id: 'a', chat: 'c1', title: 'q' });
        on({ type: 'delta', text: 'Working on' });
        on({ type: 'delta', text: ' it\n```tether\n{"sou' });
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    mount();
    await screen.findByText('See limit.ts.');
    const box = screen.getByLabelText('Message Tether');
    fireEvent.change(box, { target: { value: 'hello' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText(/Working on it/)).toBeTruthy();
    expect(screen.queryByText(/\{"sou/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));
    expect(await screen.findByText('Stopped.')).toBeTruthy();
    expect(api.bodies[0]).toMatchObject({ ws: 'api', chat: 'c1', message: 'hello', context: { page: 'runs' } });
  });
});
