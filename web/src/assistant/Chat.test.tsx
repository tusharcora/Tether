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
  /** What GET /api/assistant adds (the bound agent's models, NVIDIA beside them). */
  view: {} as Record<string, unknown>,
}));
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  assistantApi: { chat: async () => ({ messages: [{ id: 'm1', role: 'you', text: 'q', at: 1 }, tether], agent: 'claude', models: [], ...api.view }), decide: api.decide, tool: api.tool, feedback: async () => ({ ok: true }) },
  streamTurn: (body: unknown, on: (e: StreamEvent) => void, signal: AbortSignal) => (api.bodies.push(body), api.turn!(body, on, signal)),
}));
// the model lists the composer polls
vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  api: async (_m: string, path: string) => {
    if (path === '/api/accounts/nvidia/models') return { models: ['nvidia/nemotron-3.5-super-vl-120b-a12b', 'z-ai/glm-5.3-flash'] };
    if (path === '/api/accounts/openrouter/models')
      return { models: ['nvidia/nemotron-3.5-super-vl:free', 'meta-llama/llama-4:free'].map((id) => ({ id, name: id, provider: id.split('/')[0], free: true, tools: true, images: false, context: 0 })) };
    throw new Error(`no route for ${path}`);
  },
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
    fireEvent.click(screen.getByRole('button', { name: /Sources/ }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'This session' }));
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
    // the stopped reply keeps its words, says why, and offers Continue and Discard
    expect(await screen.findByText('stopped')).toBeTruthy();
    expect(screen.getByText('Working on it')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeTruthy();
    expect(api.bodies[0]).toMatchObject({ ws: 'api', chat: 'c1', message: 'hello', context: { page: 'runs' } });
  });

  it('queues a message sent while a reply streams, shows it, and sends it when the reply is done', async () => {
    let finish!: () => void;
    api.bodies.length = 0;
    api.turn = (b, on) =>
      new Promise<void>((resolve) => {
        const text = (b as { message: string }).message;
        on({ type: 'start', you: { id: `y-${text}`, role: 'you', text, at: 3 }, id: `a-${text}`, chat: 'c1', title: 'q' });
        finish = () => (on({ type: 'done', message: { id: `a-${text}`, role: 'tether', text: `re ${text}`, at: 4 } }), resolve());
      });
    mount();
    await screen.findByText('See limit.ts.');
    const box = screen.getByLabelText('Message Tether');
    for (const v of ['first', 'second']) {
      fireEvent.change(box, { target: { value: v } });
      fireEvent.keyDown(box, { key: 'Enter' });
    }
    expect(await screen.findByText('1 queued')).toBeTruthy();
    expect(api.bodies).toHaveLength(1);
    finish();
    await waitFor(() => expect(api.bodies).toHaveLength(2));
    expect(api.bodies[1]).toMatchObject({ message: 'second' });
    expect(screen.queryByText('1 queued')).toBeNull();
    finish();
    expect(await screen.findByText('re second')).toBeTruthy();
  });

  it('lists NVIDIA’s free models in their own group beside the bound agent’s, and a turn on one names nvidia', async () => {
    localStorage.clear();
    api.view = { models: ['opus', 'haiku'], nvidia: true, openrouter: true };
    api.bodies.length = 0;
    api.turn = async (_b, on) => on({ type: 'start', you: { id: 'y', role: 'you', text: 'hi', at: 3 }, id: 'a', chat: 'c1', title: 'q' });
    try {
      mount();
      await screen.findByText('See limit.ts.');
      fireEvent.click(await screen.findByRole('button', { name: 'Model: Auto' }));
      const heads = await waitFor(() => {
        const h = [...document.querySelectorAll('[cmdk-group-heading]')].map((x) => x.textContent);
        expect(h).toContain('OpenRouter · free');
        return h;
      });
      // NVIDIA right after the agent's own models; OpenRouter's free ones as one group, not one per maker
      expect(heads).toEqual(['Anthropic', 'NVIDIA (build.nvidia.com)', 'OpenRouter · free']);
      const row = screen.getByRole('option', { name: /z-ai\/glm-5.3-flash/ });
      expect([...row.querySelectorAll('.aic-tag')].map((t) => t.textContent)).toEqual(['free', '40/min']);
      fireEvent.click(row);
      const box = screen.getByLabelText('Message Tether');
      fireEvent.change(box, { target: { value: 'hi' } });
      fireEvent.keyDown(box, { key: 'Enter' });
      await waitFor(() => expect(api.bodies).toHaveLength(1));
      expect(api.bodies[0]).toMatchObject({ model: 'z-ai/glm-5.3-flash', agent: 'nvidia' });

      fireEvent.click(screen.getByRole('button', { name: 'Model: z-ai/glm-5.3-flash' }));
      fireEvent.click(screen.getByRole('option', { name: /haiku/ }));
      fireEvent.change(box, { target: { value: 'again' } });
      fireEvent.keyDown(box, { key: 'Enter' });
      await waitFor(() => expect(api.bodies).toHaveLength(2));
      expect(api.bodies[1]).toMatchObject({ model: 'haiku' });
      expect(api.bodies[1]).not.toHaveProperty('agent');
    } finally {
      api.view = {};
    }
  });
});
