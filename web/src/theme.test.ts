import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, initialTheme } from './theme';

describe('theme', () => {
  beforeEach(() => localStorage.clear());
  it('prefers the saved choice', () => {
    localStorage.setItem('aorch.theme', 'light');
    expect(initialTheme()).toBe('light');
  });
  it('falls back to the system setting', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('light'), media: q, addEventListener() {}, removeEventListener() {} }));
    expect(initialTheme()).toBe('light');
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    expect(initialTheme()).toBe('dark');
  });
  it('sets theme and accent on the root element', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.accent).toBe('violet');
  });
});
