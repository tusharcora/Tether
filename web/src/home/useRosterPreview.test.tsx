import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { useRosterPreview } from './useRosterPreview';

const hook = (t: string) => renderHook(({ t }) => useRosterPreview(t, 'api'), { initialProps: { t } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api).mockReset();
});

describe('useRosterPreview', () => {
  it('asks 400 ms after typing stops, only for tasks of 8+ characters', async () => {
    vi.mocked(api).mockResolvedValue({ bots: [], core: ['planner'] });
    const { result, rerender } = hook('short');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api).not.toHaveBeenCalled();
    rerender({ t: 'fix the RAG' });
    await act(() => vi.advanceTimersByTimeAsync(200));
    rerender({ t: 'fix the RAG retriever' });
    await act(() => vi.advanceTimersByTimeAsync(399));
    expect(api).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(vi.mocked(api).mock.calls).toEqual([['GET', '/api/roster/preview?task=fix%20the%20RAG%20retriever&ws=api']]);
    expect(result.current).toEqual({ bots: [], core: ['planner'] });
  });

  it('keeps one request in flight and then sends only the latest text', async () => {
    let release!: (v: unknown) => void;
    vi.mocked(api)
      .mockImplementationOnce(() => new Promise((r) => (release = r)))
      .mockResolvedValue({ bots: [{ id: 'b', name: 'B', why: 'w' }], core: [] });
    const { result, rerender } = hook('first long task');
    await act(() => vi.advanceTimersByTimeAsync(400));
    rerender({ t: 'second long task' });
    await act(() => vi.advanceTimersByTimeAsync(400));
    rerender({ t: 'third long task' });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(api).toHaveBeenCalledTimes(1);
    await act(async () => release({ bots: [], core: [] }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(api).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api).mock.calls[1]![1]).toContain('third%20long%20task');
    expect(result.current?.bots[0]?.id).toBe('b');
  });

  it('hides on error and never asks for a task over 2000 characters', async () => {
    vi.mocked(api).mockRejectedValue(new Error('boom'));
    const { result, rerender } = hook('a long enough task');
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(result.current).toBeUndefined();
    vi.mocked(api).mockClear();
    rerender({ t: 'x'.repeat(2001) });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api).not.toHaveBeenCalled();
  });
});
