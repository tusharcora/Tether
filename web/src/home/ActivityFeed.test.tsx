import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type ActivityLine } from '../api';
import { routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { ActivityFeed, collapseActivity, useActivity } from './ActivityFeed';

const L = (n: number, o: Partial<ActivityLine> = {}): ActivityLine => ({ id: `r1:${n}`, ts: Date.now() - 1000, runId: 'r1', who: 'Implement', text: `line ${n}`, kind: 'working', bot: 'coder', ...o });
let replies: Record<string, unknown> = {};
const paths = () => vi.mocked(api).mock.calls.map((c) => c[1]);
function Harness(p: { paused?: boolean }) {
  const feed = useActivity(!!p.paused);
  return <ActivityFeed feed={feed} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api).mockReset();
  replies = {};
  routeApi({ 'GET /api/activity': (_: unknown, path: string) => replies[path] ?? { lines: [], cursor: null } });
});

describe('Activity', () => {
  it('shows lines newest first in a polite log and decodes only new arrivals', async () => {
    replies['/api/activity?limit=50'] = { lines: [L(2), L(1)], cursor: 'c1' };
    replies['/api/activity?since=c1'] = { lines: [L(3, { text: 'newer' })], cursor: 'c2' };
    renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    const log = screen.getByRole('log', { name: 'Activity' });
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
    const { rerender } = renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    rerender(<Harness paused />);
    const before = paths().length;
    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(paths().length).toBe(before);
    replies['/api/activity?since=c1'] = { lines: [L(2, { text: 'missed' })], cursor: 'c2' };
    await act(async () => rerender(<Harness />));
    expect(paths().at(-1)).toBe('/api/activity?since=c1');
    expect(screen.getByText('missed', { selector: '.sl-sr' })).toBeTruthy();
  });

  it('shows a live dot, no Pause button, a mono time and the step in 500 weight', async () => {
    replies['/api/activity?limit=50'] = { lines: [L(1, { who: 'Bolt', text: 'Bolt started', ts: new Date(2026, 9, 28, 9, 5).getTime() })], cursor: 'c1' };
    renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('region', { name: 'Activity' }).querySelector('.sl-sec .sl-dot.pulse')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    const line = screen.getByRole('log').querySelector('.act-line')!;
    expect(line.querySelector('.act-tm')!.textContent).toBe('09:05');
    expect(line.querySelector('.act-who')!.textContent).toBe('Bolt');
    expect(line.querySelector('.act-what')!.textContent).toBe('started');
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
    expect(screen.getByText('No activity yet.')).toBeTruthy();
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

const G = (id: string, who: string, text: string, kind: ActivityLine['kind'] = 'info'): ActivityLine => ({ id, ts: 1, runId: 'r', who, text, kind });
describe('collapseActivity', () => {
  it('folds a repeated retry cycle of the same run into its newest occurrence', () => {
    const cycle = (n: number, run = 'r') => [
      { ...G(`${n}f`, 'Team run', 'run failed · budget reached', 'failed'), runId: run },
      { ...G(`${n}t`, 'Test', 'Test skipped'), runId: run },
      { ...G(`${n}l`, 'Lint', 'Lint skipped'), runId: run },
      { ...G(`${n}b`, 'Build', 'Build skipped'), runId: run },
      { ...G(`${n}r`, 'Team run', 'run resumed', 'working'), runId: run },
    ];
    const g = collapseActivity([...cycle(2), ...cycle(1), G('0', 'Team run', 'run started', 'working')]);
    expect(g.map((x) => x.text)).toEqual(['run failed · budget reached ×2', '3 steps skipped ×2', 'run resumed ×2', 'run started']);
    expect(g.map((x) => x.id)).toEqual(['2f', '2t', '2r', '0']);
    expect(g.map((x) => x.count)).toEqual([2, 6, 2, 1]);
    // another run's identical cycle is not folded into this one
    expect(collapseActivity([...cycle(2, 'a'), ...cycle(1, 'b')])).toHaveLength(6);
    // the fold still leaves at most 8 lines
    expect(collapseActivity(Array.from({ length: 6 }, (_, i) => cycle(i)).flat().concat(Array.from({ length: 20 }, (_, i) => G(`x${i}`, `S${i}`, `S${i} started`, i % 2 ? 'working' : 'done'))))).toHaveLength(8);
  });
  it('collapses consecutive repeats into one line', () => {
    const g = collapseActivity([G('1', 'Build', 'Build skipped'), G('2', 'Lint', 'Lint skipped'), G('3', 'Test', 'Test skipped'), G('4', 'Bolt', 'Bolt started', 'working')]);
    expect(g.map((x) => x.text)).toEqual(['3 steps skipped', 'Bolt started']);
    expect(g[0]!.count).toBe(3);
    expect(g[0]!.id).toBe('1');
    expect(g[1]).toMatchObject({ id: '4', text: 'Bolt started', count: 1 });
  });
  it('says ×n for repeated run lines and keeps singles as they are', () => {
    expect(collapseActivity([G('1', 'Team run', 'run started', 'working'), G('2', 'deploy', 'run started', 'working')])[0]!.text).toBe('run started ×2');
  });
  it('groups finished steps despite different costs', () => {
    expect(collapseActivity([G('1', 'A', 'A finished · $0.10', 'done'), G('2', 'B', 'B finished · $0.20', 'done')])[0]!.text).toBe('2 steps finished');
  });
  it('shows at most 8 lines', () => {
    expect(collapseActivity(Array.from({ length: 20 }, (_, i) => G(String(i), `S${i}`, `S${i} ${i % 2 ? 'started' : 'finished'}`, i % 2 ? 'working' : 'done')))).toHaveLength(8);
  });
});
