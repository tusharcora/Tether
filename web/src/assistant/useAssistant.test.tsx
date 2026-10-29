import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import type { StreamEvent } from './api';
import { useActiveChat, useAssistant, withoutTurn } from './useAssistant';

const api = vi.hoisted(() => ({
  chat: vi.fn(),
  compact: vi.fn(),
  discard: vi.fn(async () => ({ ok: true })),
  turn: undefined as undefined | ((body: unknown, on: (e: StreamEvent) => void, signal: AbortSignal) => Promise<void>),
  bodies: [] as unknown[],
}));
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  assistantApi: { chat: api.chat, compact: api.compact, discard: api.discard },
  streamTurn: (body: unknown, on: (e: StreamEvent) => void, signal: AbortSignal) => (api.bodies.push(body), api.turn!(body, on, signal)),
}));

const view = (messages: unknown[] = [], title?: string) => ({ messages, ...(title ? { title } : {}), agent: 'claude', models: [] });

beforeEach(() => {
  localStorage.clear();
  api.bodies = [];
  api.chat.mockImplementation(async (_ws: string, chat?: string) => (chat === 'c2' ? view([{ id: 'x', role: 'you', text: 'old', at: 1 }], 'Old chat') : view()));
});

describe('useAssistant', () => {
  it('makes a new chat with its first message: created gets the id, the title shows, nothing reloads', async () => {
    api.turn = async (_b, on) => {
      on({ type: 'start', you: { id: 'y', role: 'you', text: 'hi', at: 1 }, id: 'r', chat: 'c9', title: 'hi' });
      on({ type: 'delta', text: 'Hello' });
      on({ type: 'done', message: { id: 'r', role: 'tether', text: 'Hello', at: 2 } });
    };
    const created = vi.fn();
    const { result, rerender } = renderHook(({ id }) => useAssistant('api', id, true, { created }), { initialProps: { id: undefined as string | undefined } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.send('hi'));
    expect(api.bodies[0]).not.toHaveProperty('chat');
    expect(created).toHaveBeenCalledWith('c9');
    rerender({ id: 'c9' });
    expect(result.current.title).toBe('hi');
    expect(result.current.messages.map((m) => m.text)).toEqual(['hi', 'Hello']);
    expect(api.chat).toHaveBeenCalledTimes(1);
  });

  it('takes the server’s messages when a turn compacted first, and after Compact now', async () => {
    const folded = [{ id: 'x', role: 'you', text: 'old', at: 1, compactedBy: 's' }, { id: 's', role: 'tether', text: 'sum', at: 2, compact: { count: 1, auto: true } }];
    api.turn = async (_b, on) => {
      on({ type: 'start', you: { id: 'y', role: 'you', text: 'hi', at: 3 }, id: 'r', chat: 'c2', title: 'Old chat' });
      on({ type: 'compacted', messages: [...folded, { id: 'y', role: 'you', text: 'hi', at: 3 }] as never });
      on({ type: 'done', message: { id: 'r', role: 'tether', text: 'Hello', at: 4 } });
    };
    const { result } = renderHook(() => useAssistant('api', 'c2', true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.send('hi'));
    expect(result.current.messages.map((m) => m.id)).toEqual(['x', 's', 'y', 'r']);
    api.compact.mockResolvedValueOnce({ messages: [{ id: 'x', role: 'you', text: 'old', at: 1 }] });
    await act(() => result.current.compact(true));
    expect(api.compact).toHaveBeenCalledWith('api', 'c2', true);
    expect(result.current.messages.map((m) => m.id)).toEqual(['x']);
    expect(result.current.compacting).toBe(false);
  });

  it('calls gone for a chat that is not there', async () => {
    api.chat.mockRejectedValueOnce(new ApiError('unknown chat', 404));
    const gone = vi.fn();
    renderHook(() => useAssistant('api', 'cX', true, { gone }));
    await waitFor(() => expect(gone).toHaveBeenCalledWith('cX'));
  });

  it('stops a turn when another chat opens, and the old reply never lands in the new chat', async () => {
    api.turn = (_b, on, signal) =>
      new Promise<void>((_resolve, reject) => {
        on({ type: 'start', you: { id: 'y', role: 'you', text: 'q', at: 1 }, id: 'r', chat: 'c1', title: 'q' });
        on({ type: 'delta', text: 'half an answer' });
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const { result, rerender } = renderHook(({ id }) => useAssistant('api', id, true), { initialProps: { id: 'c1' as string | undefined } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let sent!: Promise<void>;
    act(() => void (sent = result.current.send('q')));
    await waitFor(() => expect(result.current.streaming?.text).toBe('half an answer'));
    rerender({ id: 'c2' });
    await act(() => sent);
    await waitFor(() => expect(result.current.title).toBe('Old chat'));
    expect(result.current.streaming).toBeUndefined();
    expect(result.current.messages.map((m) => m.text)).toEqual(['old']);
  });
});

describe('useAssistant: queue, regenerate, retry, discard', () => {
  const said = [
    { id: 'y1', role: 'you', text: 'one', at: 1 },
    { id: 'a1', role: 'tether', text: 'first', at: 2, context: { parts: {}, agent: 'openrouter', model: 'm/free' } },
    { id: 'y2', role: 'you', text: 'two', at: 3 },
    { id: 'a2', role: 'tether', text: 'second', at: 4, context: { parts: {}, agent: 'claude', model: 'opus' } },
  ];
  const answer = (id: string) => async (b: unknown, on: (e: StreamEvent) => void) => {
    on({ type: 'start', you: { id: `y-${id}`, role: 'you', text: (b as { message: string }).message, at: 5 }, id, chat: 'c1', title: 't' });
    on({ type: 'done', message: { id, role: 'tether', text: `again ${id}`, at: 6 } });
  };

  it('drops a turn the way the server does', () => {
    expect(withoutTurn(said as never, 'a2').map((m) => m.id)).toEqual(['y1', 'a1']);
    expect(withoutTurn(said as never, 'nope').map((m) => m.id)).toEqual(['y1', 'a1', 'y2', 'a2']);
  });

  it('regenerates the latest reply in place, on the agent and model that answered; an older one is asked again at the end', async () => {
    api.chat.mockResolvedValue(view(said));
    const { result } = renderHook(() => useAssistant('api', 'c1', true));
    await waitFor(() => expect(result.current.messages).toHaveLength(4));
    api.turn = answer('r1');
    await act(() => result.current.regenerate('a2'));
    expect(api.bodies[0]).toMatchObject({ chat: 'c1', message: 'two', regenerate: 'a2', agent: 'claude', model: 'opus' });
    expect(result.current.messages.map((m) => m.id)).toEqual(['y1', 'a1', 'y-r1', 'r1']);
    api.turn = answer('r2');
    await act(() => result.current.regenerate('a1'));
    expect(api.bodies[1]).toMatchObject({ message: 'one', agent: 'openrouter', model: 'm/free' });
    expect(api.bodies[1]).not.toHaveProperty('regenerate');
    expect(result.current.messages.map((m) => m.id)).toEqual(['y1', 'a1', 'y-r1', 'r1', 'y-r2', 'r2']);
  });

  it('queues while a reply streams, lets one be removed, and forgets the queue in another chat', async () => {
    let finish!: () => void;
    api.turn = (b, on) => new Promise<void>((resolve) => ((finish = resolve), on({ type: 'start', you: { id: 'y', role: 'you', text: (b as { message: string }).message, at: 1 }, id: 'r', chat: 'c1', title: 't' })));
    const { result, rerender } = renderHook(({ id }) => useAssistant('api', id, true), { initialProps: { id: 'c1' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => void result.current.send('a'));
    await act(() => result.current.send('b'));
    await act(() => result.current.send('c'));
    expect(result.current.queue.map((q) => q.text)).toEqual(['b', 'c']);
    act(() => result.current.unqueue(result.current.queue[0]!.id));
    expect(result.current.queue.map((q) => q.text)).toEqual(['c']);
    await act(async () => finish());
    await waitFor(() => expect(api.bodies.map((b) => (b as { message: string }).message)).toEqual(['a', 'c']));
    act(() => void result.current.send('d'));
    rerender({ id: 'c2' });
    await waitFor(() => expect(result.current.queue).toEqual([]));
  });

  it('retries what failed: the load, or the send', async () => {
    api.chat.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useAssistant('api', 'c1', true));
    await waitFor(() => expect(result.current.error).toBe('offline'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeUndefined();
    expect(api.chat).toHaveBeenCalledTimes(2);
    api.turn = async () => {
      throw new Error('HTTP 502');
    };
    await act(() => result.current.send('hi'));
    expect(result.current.error).toBe('HTTP 502');
    api.turn = answer('r');
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.messages.map((m) => m.text)).toEqual(['hi', 'again r']));
  });

  it('discards a reply here and on the server', async () => {
    api.chat.mockResolvedValue(view([{ id: 'y', role: 'you', text: 'q', at: 1 }, { id: 'a', role: 'tether', text: 'half', at: 2, error: 'Stopped.' }]));
    const { result } = renderHook(() => useAssistant('api', 'c1', true));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    await act(() => result.current.discard('a'));
    expect(result.current.messages.map((m) => m.id)).toEqual(['y']);
    expect(api.discard).toHaveBeenCalledWith('api', 'c1', 'a');
  });
});

describe('useActiveChat', () => {
  it('keeps one open chat per project on this device', () => {
    const { result, rerender } = renderHook(({ ws }) => useActiveChat(ws), { initialProps: { ws: 'a' as string | undefined } });
    act(() => result.current[1]('c1'));
    expect(result.current[0]).toBe('c1');
    rerender({ ws: 'b' });
    expect(result.current[0]).toBeUndefined();
    act(() => result.current[1]('c2'));
    rerender({ ws: 'a' });
    expect(result.current[0]).toBe('c1');
    act(() => result.current[1](undefined));
    expect(localStorage.getItem('tether.assistant.chat.a')).toBeNull();
    expect(localStorage.getItem('tether.assistant.chat.b')).toBe('c2');
  });
});
