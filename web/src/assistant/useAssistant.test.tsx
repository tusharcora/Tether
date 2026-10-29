import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import type { StreamEvent } from './api';
import { useActiveChat, useAssistant } from './useAssistant';

const api = vi.hoisted(() => ({
  chat: vi.fn(),
  turn: undefined as undefined | ((body: unknown, on: (e: StreamEvent) => void, signal: AbortSignal) => Promise<void>),
  bodies: [] as unknown[],
}));
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  assistantApi: { chat: api.chat },
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
