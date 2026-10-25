import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Poll } from '../../hooks';
import { connectionOf, useConnection } from './connection';

describe('connectionOf', () => {
  it('is connected after a good poll', () => expect(connectionOf({ ok: true, fails: 0 }, true)).toBe('connected'));
  it('is offline when it never connected', () => {
    expect(connectionOf({ ok: false, fails: 1 }, false)).toBe('offline');
    expect(connectionOf({ ok: false, fails: 5 }, false)).toBe('offline');
  });
  it('rides out one or two misses, then says reconnecting at the backoff threshold', () => {
    expect(connectionOf({ ok: false, fails: 2 }, true)).toBe('connected');
    expect(connectionOf({ ok: false, fails: 3 }, true)).toBe('reconnecting');
  });
});

describe('useConnection', () => {
  const poll = (p: Partial<Poll<{ ok: boolean }>>): Poll<{ ok: boolean }> => ({ data: undefined, error: undefined, fails: 0, refresh: async () => {}, ...p });

  it('is connecting until the first health poll answers', () => {
    const { result, rerender } = renderHook((p: Poll<{ ok: boolean }>) => useConnection(p), { initialProps: poll({}) });
    expect(result.current).toBe('connecting');
    rerender(poll({ error: 'down', fails: 1 }));
    expect(result.current).toBe('offline');
  });

  it('is offline until the first good poll, then remembers it connected', () => {
    const { result, rerender } = renderHook((p: Poll<{ ok: boolean }>) => useConnection(p), { initialProps: poll({ error: 'down', fails: 4 }) });
    expect(result.current).toBe('offline');
    rerender(poll({ data: { ok: true } }));
    expect(result.current).toBe('connected');
    rerender(poll({ data: { ok: true }, error: 'down', fails: 2 }));
    expect(result.current).toBe('connected');
    rerender(poll({ data: { ok: true }, error: 'down', fails: 3 }));
    expect(result.current).toBe('reconnecting');
  });
});
