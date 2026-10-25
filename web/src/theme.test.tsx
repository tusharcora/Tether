import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, initialTheme, storedChoice, useTheme } from './theme';

/** A controllable prefers-color-scheme: dark query. */
function fakeOs(dark: boolean) {
  const state = { dark };
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    get matches() { return state.dark; },
    media: '(prefers-color-scheme: dark)', onchange: null,
    addEventListener: (_: string, f: (e: { matches: boolean }) => void) => listeners.add(f),
    removeEventListener: (_: string, f: (e: { matches: boolean }) => void) => listeners.delete(f),
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  };
  vi.stubGlobal('matchMedia', (q: string) => (q === '(prefers-color-scheme: dark)' ? mql : { ...mql, matches: false, media: q }));
  return {
    set(d: boolean) { state.dark = d; for (const f of listeners) f({ matches: d }); },
    listeners: () => listeners.size,
  };
}
const root = () => document.documentElement;

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks(); // storage spies must not leak into later tests
  delete root().dataset.theme;
  delete root().dataset.accent;
  root().style.colorScheme = '';
});

describe('theme selection', () => {
  it('defaults to Match system and follows OS changes live', () => {
    const os = fakeOs(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe('system');
    expect(root().dataset.theme).toBe('light');
    act(() => os.set(true));
    expect(root().dataset.theme).toBe('dark');
    expect(result.current.theme).toBe('dark');
  });

  it('ignores OS changes under a manual pick and stores it', () => {
    const os = fakeOs(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setChoice('dark'));
    expect(localStorage.getItem('aorch.theme')).toBe('dark');
    act(() => os.set(false));
    expect(root().dataset.theme).toBe('dark');
    expect(os.listeners()).toBe(0);
    act(() => result.current.setChoice('system'));
    expect(root().dataset.theme).toBe('light');
  });

  it('keeps an old two-state value as the manual choice', () => {
    fakeOs(true);
    localStorage.setItem('aorch.theme', 'light');
    expect(storedChoice()).toBe('light');
    expect(initialTheme()).toBe('light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe('light');
  });

  it('treats unknown stored values as Match system', () => {
    fakeOs(true);
    localStorage.setItem('aorch.theme', 'violet');
    expect(storedChoice()).toBe('system');
    expect(initialTheme()).toBe('dark');
  });

  it('works when storage is unavailable', () => {
    fakeOs(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe('system');
    expect(root().dataset.theme).toBe('dark');
    expect(() => act(() => result.current.setChoice('light'))).not.toThrow();
    expect(root().dataset.theme).toBe('light');
  });

  it('never sets the Arc accent attribute and clears a stale one', () => {
    root().dataset.accent = 'violet';
    applyTheme('dark');
    expect(root().dataset.accent).toBeUndefined();
    expect(root().style.colorScheme).toBe('dark');
  });
});
