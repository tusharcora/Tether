import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PHONE, useMediaQuery } from './useMediaQuery';

describe('useMediaQuery', () => {
  it('reads the query and follows changes', () => {
    let matches = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (q: string) => ({ get matches() { return q === PHONE && matches; }, media: q, addEventListener: (_: string, f: () => void) => listeners.add(f), removeEventListener: (_: string, f: () => void) => listeners.delete(f) }));
    const { result } = renderHook(() => useMediaQuery(PHONE));
    expect(result.current).toBe(true);
    act(() => { matches = false; listeners.forEach((f) => f()); });
    expect(result.current).toBe(false);
  });
});
