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
