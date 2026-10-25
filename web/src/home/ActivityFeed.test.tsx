import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type ActivityLine } from '../api';
import { routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { ActivityFeed, useActivity } from './ActivityFeed';

const L = (n: number, o: Partial<ActivityLine> = {}): ActivityLine => ({ id: `r1:${n}`, ts: Date.now() - 1000, runId: 'r1', who: 'Implement', text: `line ${n}`, kind: 'working', bot: 'coder', ...o });
let replies: Record<string, unknown> = {};
const paths = () => vi.mocked(api).mock.calls.map((c) => c[1]);
function Harness() {
  const [paused, setPaused] = useState(false);
  const feed = useActivity(paused);
  return <ActivityFeed feed={feed} paused={paused} onPause={setPaused} refreshing={false} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api).mockReset();
  replies = {};
  routeApi({ 'GET /api/activity': (_: unknown, path: string) => replies[path] ?? { lines: [], cursor: null } });
});

describe('Live activity', () => {
  it('shows lines newest first in a polite log and decodes only new arrivals', async () => {
    replies['/api/activity?limit=50'] = { lines: [L(2), L(1)], cursor: 'c1' };
    replies['/api/activity?since=c1'] = { lines: [L(3, { text: 'newer' })], cursor: 'c2' };
    renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    const log = screen.getByRole('log', { name: 'Live activity' });
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect([...log.querySelectorAll('.sl-sr')].map((n) => n.textContent)).toEqual(['line 2', 'line 1']);
    expect(log.querySelector('[data-ascii-reveal]')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect([...log.querySelectorAll('.sl-sr')].map((n) => n.textContent)).toEqual(['newer', 'line 2', 'line 1']);
    const decoding = log.querySelectorAll('[data-ascii-reveal]');
    expect(decoding).toHaveLength(1);
    expect(decoding[0]!.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it('decodes at most the newest five new lines', async () => {
    replies['/api/activity?limit=50'] = { lines: [], cursor: 'c1' };
    replies['/api/activity?since=c1'] = { lines: [7, 6, 5, 4, 3, 2, 1].map((n) => L(n)), cursor: 'c2' };
    renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole('log').querySelectorAll('[data-ascii-reveal]')).toHaveLength(5);
  });

  it('does not decode under reduced motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    try {
      replies['/api/activity?limit=50'] = { lines: [], cursor: 'c1' };
      replies['/api/activity?since=c1'] = { lines: [L(1)], cursor: 'c2' };
      renderApp(<Harness />);
      await act(() => vi.advanceTimersByTimeAsync(3000));
      expect(screen.getByText('line 1', { selector: '.sl-sr' })).toBeTruthy();
      expect(screen.getByRole('log').querySelector('[data-ascii-reveal]')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stops polling while paused and fetches what was missed on resume', async () => {
    replies['/api/activity?limit=50'] = { lines: [L(1)], cursor: 'c1' };
    renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Resume' }).hasAttribute('aria-pressed')).toBe(false);
    const before = paths().length;
    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(paths().length).toBe(before);
    replies['/api/activity?since=c1'] = { lines: [L(2, { text: 'missed' })], cursor: 'c2' };
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Resume' })));
    expect(paths().at(-1)).toBe('/api/activity?since=c1');
    expect(screen.getByText('missed', { selector: '.sl-sr' })).toBeTruthy();
  });

  it('stops polling while the browser tab is hidden', async () => {
    renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    const before = paths().length;
    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(paths().length).toBe(before);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    expect(paths().length).toBe(before + 1);
  });

  it('shows a load error inline with a retry, and an empty state', async () => {
    routeApi({ 'GET /api/activity': new Error('down') });
    renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('alert').textContent).toContain('down');
    routeApi({ 'GET /api/activity': { lines: [], cursor: null } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(screen.getByText('No activity yet')).toBeTruthy();
  });

  it('keeps its lines and says it could not refresh when a later poll fails', async () => {
    replies['/api/activity?limit=50'] = { lines: [L(1)], cursor: 'c1' };
    renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    routeApi({ 'GET /api/activity': new Error('down') });
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole('alert').textContent).toContain("Couldn't refresh");
    expect(screen.getByText('line 1', { selector: '.sl-sr' })).toBeTruthy();
  });
});
