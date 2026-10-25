import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom lacks these; Radix, motion and the canvas code call them.
afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  // Imported lazily: a static import would load the real ./api before a test file's vi.mock('./api') applies.
  const { FakeEventSource } = await import('./fixtures');
  FakeEventSource.all = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  location.hash = '';
});
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; }
globalThis.ResizeObserver ??= Observer as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= Observer as unknown as typeof IntersectionObserver;
Element.prototype.scrollIntoView ??= function () {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
document.elementFromPoint ??= () => null;
// ascii-reveal draws on <canvas>, which jsdom lacks: tests get a plain stand-in that records the props Loading passes.
vi.mock('ascii-reveal', async () => {
  const React = await import('react');
  return {
    AsciiReveal: ({ loading, children, className, preset: _p, duration: _d, revealOnMount: _r, ...rest }: Record<string, unknown>) =>
      React.createElement('div', { 'data-ascii-reveal': '', 'data-loading': String(!!loading), className, ...rest }, children as never),
    AsciiSkeleton: ({ variant, animate, lines, rows }: { variant?: string; animate?: boolean; lines?: number; rows?: number }) =>
      React.createElement('span', { 'data-ascii-skeleton': '', 'data-variant': variant, 'data-animate': String(animate !== false), 'data-lines': lines, 'data-rows': rows }),
  };
});
