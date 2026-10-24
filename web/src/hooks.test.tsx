import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { BACKOFF_MS, hashFor, parseHash, usePoll, useHashRoute } from './hooks';

const apiMock = vi.mocked(api);

describe('usePoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMock.mockReset();
  });

  it('fetches now and then every interval', async () => {
    apiMock.mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => usePoll<{ n: number }>('/api/x', 1000));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.data).toEqual({ n: 1 });
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(apiMock).toHaveBeenCalledTimes(4);
    expect(apiMock).toHaveBeenCalledWith('GET', '/api/x');
  });

  it('keeps the last good value and exposes the error', async () => {
    apiMock.mockResolvedValueOnce({ n: 1 }).mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => usePoll<{ n: number }>('/api/x', 1000));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.data).toEqual({ n: 1 });
    expect(result.current.error).toBe('down');
  });

  it('backs off after three failures and recovers after a success', async () => {
    apiMock.mockRejectedValue(new Error('down'));
    renderHook(() => usePoll('/api/x', 1000));
    await act(() => vi.advanceTimersByTimeAsync(2000)); // calls at 0, 1000, 2000 -> 3 failures
    expect(apiMock).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(BACKOFF_MS - 1));
    expect(apiMock).toHaveBeenCalledTimes(3);
    apiMock.mockResolvedValue({});
    await act(() => vi.advanceTimersByTimeAsync(1)); // 4th call succeeds
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(apiMock).toHaveBeenCalledTimes(5);
  });

  it('does nothing while the path is null', async () => {
    renderHook(() => usePoll(null, 1000));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('ignores a reply for a path it no longer polls', async () => {
    let resolveOld!: (v: unknown) => void;
    apiMock.mockImplementationOnce(() => new Promise((r) => (resolveOld = r))).mockResolvedValue({ which: 'new' });
    const { result, rerender } = renderHook(({ p }) => usePoll<{ which: string }>(p, 1000), { initialProps: { p: '/api/old' } });
    rerender({ p: '/api/new' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    resolveOld({ which: 'old' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.data).toEqual({ which: 'new' });
  });
});

describe('hash routes', () => {
  it('parses and formats', () => {
    expect(parseHash('#/runs/r-1')).toEqual({ tab: 'runs', id: 'r-1' });
    expect(parseHash('#/crew')).toEqual({ tab: 'crew' });
    expect(parseHash('')).toEqual({ tab: 'builder' });
    expect(parseHash('#/nope')).toEqual({ tab: 'builder' });
    expect(parseHash('#/runs/%E0')).toEqual({ tab: 'runs', id: '%E0' });
    expect(hashFor({ tab: 'builder', id: 'my flow' })).toBe('#/builder/my%20flow');
    expect(parseHash(hashFor({ tab: 'builder', id: 'my flow' }))).toEqual({ tab: 'builder', id: 'my flow' });
  });

  it('follows hashchange and sets the hash', () => {
    const { result } = renderHook(() => useHashRoute());
    act(() => result.current[1]({ tab: 'graph' }));
    expect(location.hash).toBe('#/graph');
    act(() => {
      location.hash = '#/runs/r9';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current[0]).toEqual({ tab: 'runs', id: 'r9' });
  });
});
