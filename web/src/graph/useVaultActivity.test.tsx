import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { PING_MS, useVaultActivity, VAULT_POLL_MS } from './useVaultActivity';

const item = (path: string, ts: number, seq: number) => ({ id: `r1:${seq}`, ts, runId: 'r1', run: 'ship', path });
const history = { items: [item('old.md', 1, 2)], cursor: '1:r1:2' };
const setHidden = (hidden: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });

beforeEach(() => {
  vi.mocked(api).mockReset();
  setHidden(false);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

describe('useVaultActivity', () => {
  it('remembers past writes without pinging them, then pings new ones for a while', async () => {
    routeApi({
      'GET /api/vault/activity': (_b: unknown, p: string) =>
        p.includes('since=1%3Ar1%3A2') ? { items: [item('new.md', 9, 3)], cursor: '9:r1:3' } : p.includes('since=') ? { items: [], cursor: '9:r1:3' } : history,
    });
    const { result } = renderHook(() => useVaultActivity());
    await act(async () => {});
    expect(calls('GET', '/api/vault/activity?limit=100')).toHaveLength(1);
    expect(result.current.last.get('old.md')?.run).toBe('ship');
    expect(result.current.fresh.size).toBe(0);
    expect(result.current.latest).toBeUndefined();
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS));
    expect(result.current.fresh.has('new.md')).toBe(true);
    expect(result.current.latest?.path).toBe('new.md');
    expect(result.current.last.get('new.md')?.ts).toBe(9);
    await act(() => vi.advanceTimersByTimeAsync(PING_MS));
    expect(result.current.fresh.has('new.md')).toBe(false);
    expect(result.current.latest?.path).toBe('new.md');
  });

  it('pings the first writes of a vault that had none', async () => {
    let first = true;
    routeApi({
      'GET /api/vault/activity': () => {
        if (!first) return { items: [item('a.md', 5, 2)], cursor: '5:r1:2' };
        first = false;
        return { items: [], cursor: null };
      },
    });
    const { result } = renderHook(() => useVaultActivity());
    await act(async () => {});
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS));
    expect(result.current.fresh.has('a.md')).toBe(true);
  });

  it('leaves no timers behind on unmount, live-window ones included', async () => {
    let first = true;
    routeApi({
      'GET /api/vault/activity': () => {
        if (!first) return { items: [item('a.md', 5, 2)], cursor: '5:r1:2' };
        first = false;
        return { items: [], cursor: null };
      },
    });
    const { result, unmount } = renderHook(() => useVaultActivity());
    await act(async () => {});
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS));
    expect(result.current.fresh.has('a.md')).toBe(true);
    expect(vi.getTimerCount()).toBeGreaterThan(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps polling quietly after an error', async () => {
    let fail = true;
    routeApi({
      'GET /api/vault/activity': () => {
        if (!fail) return history;
        fail = false;
        return new Error('down');
      },
    });
    const { result } = renderHook(() => useVaultActivity());
    await act(async () => {});
    expect(result.current.last.size).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS));
    expect(result.current.last.has('old.md')).toBe(true);
  });

  it('does not poll while the tab is hidden', async () => {
    setHidden(true);
    routeApi({ 'GET /api/vault/activity': history });
    renderHook(() => useVaultActivity());
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS * 2));
    expect(vi.mocked(api)).not.toHaveBeenCalled();
    setHidden(false);
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS));
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
  });
});
