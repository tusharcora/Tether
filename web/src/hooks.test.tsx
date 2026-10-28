import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { BACKOFF_MS, hashFor, parseHash, SCREENS, TAB_LABEL, usePoll, useHashRoute } from './hooks';

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

  it('counts failures in a row and resets on success', async () => {
    apiMock.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => usePoll('/api/x', 1000));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.fails).toBe(3);
    apiMock.mockResolvedValue({});
    await act(() => vi.advanceTimersByTimeAsync(BACKOFF_MS));
    expect(result.current.fails).toBe(0);
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

/** What the browser does on a typed hash: a new history entry and one hashchange (no jsdom-queued second event). */
const browserGoes = (hash: string) =>
  act(() => {
    history.pushState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
/** Lets jsdom run its queued history traversals and hashchange events. */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 10)));

describe('hash routes', () => {
  beforeEach(() => {
    vi.useRealTimers();
    history.replaceState(null, '', '#/home');
  });
  afterEach(settle);

  it('parses and formats', () => {
    expect(parseHash('#/runs/r-1')).toEqual({ tab: 'runs', id: 'r-1' });
    expect(parseHash('#/runs/r-1/code')).toEqual({ tab: 'runs', id: 'r-1', node: 'code' });
    expect(parseHash('#/crew')).toEqual({ tab: 'crew' });
    expect(parseHash('#/crew/quill')).toEqual({ tab: 'crew', id: 'quill' });
    expect(parseHash('#/graph/runs%2Fr1.md')).toEqual({ tab: 'graph', id: 'runs/r1.md' });
    expect(parseHash('#/settings')).toEqual({ tab: 'settings' });
    expect(parseHash('')).toEqual({ tab: 'home' });
    expect(parseHash('#/nope')).toEqual({ tab: 'home' });
    expect(parseHash('#/runs/%E0')).toEqual({ tab: 'runs', id: '%E0' });
    expect(hashFor({ tab: 'builder', id: 'my flow' })).toBe('#/builder/my%20flow');
    expect(hashFor({ tab: 'runs', id: 'r1', node: 'code' })).toBe('#/runs/r1/code');
    expect(hashFor({ tab: 'graph', id: 'runs/r1.md' })).toBe('#/graph/runs%2Fr1.md');
    expect(parseHash(hashFor({ tab: 'builder', id: 'my flow' }))).toEqual({ tab: 'builder', id: 'my flow' });
  });

  it('carries a run pane hint as a query on run links only', () => {
    expect(hashFor({ tab: 'runs', id: 'r1', pane: 'timeline' })).toBe('#/runs/r1?pane=timeline');
    expect(parseHash('#/runs/r1?pane=timeline')).toEqual({ tab: 'runs', id: 'r1', pane: 'timeline' });
    expect(parseHash('#/runs/r1/code?pane=timeline')).toEqual({ tab: 'runs', id: 'r1', node: 'code', pane: 'timeline' });
    expect(parseHash('#/runs/r1?pane=bogus')).toEqual({ tab: 'runs', id: 'r1' });
    expect(parseHash('#/crew/quill?pane=timeline')).toEqual({ tab: 'crew', id: 'quill' });
    expect(hashFor({ tab: 'crew', id: 'quill', pane: 'timeline' })).toBe('#/crew/quill');
  });

  it('keeps a Code path readable, with an optional :line', () => {
    expect(hashFor({ tab: 'code', id: 'src/http/limit.ts', line: 12 })).toBe('#/code/src/http/limit.ts:12');
    expect(hashFor({ tab: 'code', id: 'docs/a b:c.md' })).toBe('#/code/docs/a%20b%3Ac.md');
    expect(hashFor({ tab: 'code' })).toBe('#/code');
    expect(parseHash('#/code/src/http/limit.ts:12')).toEqual({ tab: 'code', id: 'src/http/limit.ts', line: 12 });
    expect(parseHash('#/code/docs/a%20b%3Ac.md')).toEqual({ tab: 'code', id: 'docs/a b:c.md' });
    expect(parseHash('#/code')).toEqual({ tab: 'code' });
    expect(parseHash('#/code/')).toEqual({ tab: 'code' });
  });

  it('lists the screens in sidebar order', () => {
    expect(SCREENS).toEqual(['home', 'inbox', 'runs', 'code', 'builder', 'crew', 'goals', 'api', 'graph', 'triggers']);
    expect(TAB_LABEL.settings).toBe('Settings');
  });

  it('follows hashchange and sets the hash', () => {
    const { result } = renderHook(() => useHashRoute());
    act(() => result.current[1]({ tab: 'graph' }));
    expect(location.hash).toBe('#/graph');
    browserGoes('#/runs/r9');
    expect(result.current[0]).toEqual({ tab: 'runs', id: 'r9' });
  });

  it('restores the hash and reports a blocked browser navigation', () => {
    history.replaceState(null, '', '#/api');
    const onBlocked = vi.fn();
    const { result } = renderHook(() => useHashRoute((next, cur) => cur.tab === 'api' && next.tab !== 'api', onBlocked));
    browserGoes('#/crew');
    expect(onBlocked).toHaveBeenCalledWith({ tab: 'crew' });
    expect(location.hash).toBe('#/api');
    expect(result.current[0]).toEqual({ tab: 'api' });
  });

  it('never blocks its own navigation', () => {
    history.replaceState(null, '', '#/api');
    const onBlocked = vi.fn();
    const { result } = renderHook(() => useHashRoute(() => true, onBlocked));
    act(() => result.current[1]({ tab: 'crew' }));
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(onBlocked).not.toHaveBeenCalled();
    expect(result.current[0]).toEqual({ tab: 'crew' });
  });

  it('forgets its own pending hash once the person navigates elsewhere', () => {
    const onBlocked = vi.fn();
    const { result } = renderHook(() => useHashRoute((next) => next.tab === 'graph', onBlocked));
    act(() => result.current[1]({ tab: 'graph' })); // its hashchange is still queued
    browserGoes('#/crew'); // the person moves on first
    expect(result.current[0]).toEqual({ tab: 'crew' });
    browserGoes('#/graph'); // no longer the app's own change: asked like any other
    expect(onBlocked).toHaveBeenCalledWith({ tab: 'graph' });
    expect(result.current[0]).toEqual({ tab: 'crew' });
  });

  it('undoes a blocked Back by stepping forward again, keeping the earlier entry', async () => {
    let guard = true;
    const onBlocked = vi.fn();
    const { result } = renderHook(() => useHashRoute((next, cur) => guard && cur.tab === 'api' && next.tab !== 'api', onBlocked));
    act(() => result.current[1]({ tab: 'crew' }));
    act(() => result.current[1]({ tab: 'api' }));
    await settle();
    const entries = history.length;

    act(() => history.back());
    await settle();
    expect(onBlocked).toHaveBeenCalledWith({ tab: 'crew' });
    expect(location.hash).toBe('#/api');
    expect(result.current[0]).toEqual({ tab: 'api' });
    expect(history.length).toBe(entries);

    guard = false; // the person discarded: Back now reaches the crew entry, which is still there
    act(() => history.back());
    await settle();
    expect(location.hash).toBe('#/crew');
    expect(result.current[0]).toEqual({ tab: 'crew' });
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it('undoes a blocked Forward the same way', async () => {
    let guard = false;
    const onBlocked = vi.fn();
    const { result } = renderHook(() => useHashRoute((next, cur) => guard && cur.tab === 'api' && next.tab !== 'api', onBlocked));
    act(() => result.current[1]({ tab: 'api' }));
    act(() => result.current[1]({ tab: 'triggers' }));
    await settle();
    act(() => history.back());
    await settle();
    expect(result.current[0]).toEqual({ tab: 'api' });

    guard = true;
    act(() => history.forward());
    await settle();
    expect(onBlocked).toHaveBeenCalledWith({ tab: 'triggers' });
    expect(location.hash).toBe('#/api');
    expect(result.current[0]).toEqual({ tab: 'api' });

    guard = false;
    act(() => history.forward());
    await settle();
    expect(result.current[0]).toEqual({ tab: 'triggers' });
  });

  it('ignores browser moves that land while a blocked Back is being undone', async () => {
    let guard = false;
    const onBlocked = vi.fn();
    const { result } = renderHook(() => useHashRoute((next, cur) => guard && cur.tab === 'api' && next.tab !== 'api', onBlocked));
    act(() => result.current[1]({ tab: 'crew' }));
    act(() => result.current[1]({ tab: 'graph' }));
    act(() => result.current[1]({ tab: 'api' }));
    await settle();
    guard = true;
    // A second browser move reaches the page before the undo of the first has landed (a rapid second Back)
    onBlocked.mockImplementationOnce(() => window.dispatchEvent(new HashChangeEvent('hashchange')));

    act(() => history.back());
    await settle();
    await settle();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledWith({ tab: 'graph' });
    expect(location.hash).toBe('#/api');
    expect(result.current[0]).toEqual({ tab: 'api' });

    act(() => history.back()); // once the undo has landed, Back is asked about again
    await settle();
    expect(onBlocked).toHaveBeenCalledTimes(2);
    expect(onBlocked).toHaveBeenLastCalledWith({ tab: 'graph' });
    expect(location.hash).toBe('#/api');
    expect(result.current[0]).toEqual({ tab: 'api' });
  });
});
