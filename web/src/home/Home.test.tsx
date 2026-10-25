import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type RunRow } from '../api';
import { calls, FakeEventSource, makeRow, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { Home } from './Home';

const WS = [{ id: 'api', name: 'API', path: '/p/api', isDefault: true, exists: true, repos: [] }];
let rows: RunRow[] = [];
beforeEach(() => {
  vi.mocked(api).mockReset();
  localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  FakeEventSource.all = [];
  rows = [makeRow({ id: 'r0', status: 'done', live: false, finishedAt: Date.now() })];
  routeApi({
    'GET /api/runs': () => rows,
    'GET /api/attention': { items: [] },
    'GET /api/workspaces': WS,
    'GET /api/roster/preview': new Error('hidden'),
    'GET /api/activity': { lines: [], cursor: null },
    'GET /api/http/tree': { root: { path: '', name: '', collections: [], requests: [] }, environments: [], activeEnv: null, workspace: 'api' },
    'GET /api/http/history': [],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Home', () => {
  it('polls the workspace list once and shares it with its sections', async () => {
    renderApp(<Home onGo={() => {}} />);
    expect(await screen.findByLabelText('Task')).toBeTruthy();
    await act(async () => {});
    expect(calls('GET', '/api/workspaces')).toHaveLength(1);
  });

  it('lays out the sections in the one-column order', async () => {
    renderApp(<Home onGo={() => {}} />);
    await act(async () => {});
    // the toast stack's region (from renderApp) sits outside the Home grid
    const names = screen.getAllByRole('region').filter((r) => r.closest('.home-grid')).map((r) => r.getAttribute('aria-labelledby') && document.getElementById(r.getAttribute('aria-labelledby')!)!.textContent);
    expect(names).toEqual(['Needs you', 'Start a run', 'Running', 'Live activity', 'Recent', 'Saved requests', 'Crew']);
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
  });

  it('polls every 10 s while nothing is live and every 2 s while a run is live, with no EventSource', async () => {
    vi.useFakeTimers();
    renderApp(<Home onGo={() => {}} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    const n = () => calls('GET', '/api/runs').length;
    const a = () => calls('GET', '/api/attention').length;
    const start = n();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(n()).toBe(start);
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(n()).toBe(start + 1);
    rows = [makeRow({ id: 'r1', live: true })];
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    const live = n();
    const liveA = a();
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(n() - live).toBe(2);
    expect(a() - liveA).toBe(2);
    expect(FakeEventSource.all).toHaveLength(0);
  });

  it('goes by the server-computed live flag, not the status', async () => {
    vi.useFakeTimers();
    rows = [makeRow({ id: 'r1', status: 'running', live: false, lastTs: Date.now() })];
    renderApp(<Home onGo={() => {}} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    const start = calls('GET', '/api/runs').length;
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(calls('GET', '/api/runs').length).toBe(start);
    expect(screen.getByText('Nothing running')).toBeTruthy();
  });

  it('shows skeletons while refreshing', async () => {
    let finish!: () => void;
    renderApp(<Home onGo={() => {}} />);
    await act(async () => {});
    routeApi({
      'GET /api/runs': () => new Promise<RunRow[]>((r) => (finish = () => r(rows))),
      'GET /api/attention': { items: [] },
      'GET /api/workspaces': WS,
      'GET /api/roster/preview': new Error('hidden'),
      'GET /api/activity': { lines: [], cursor: null },
    });
    await act(async () => screen.getByRole('button', { name: 'Refresh' }).click());
    expect(screen.getByRole('status', { name: 'Loading running runs' })).toBeTruthy();
    await act(async () => finish());
    expect(screen.queryByRole('status', { name: 'Loading running runs' })).toBeNull();
  });
});
