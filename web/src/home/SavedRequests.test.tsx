import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, ApiError } from '../api';
import type { HistoryRow, HttpTree } from '../http/client';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { SavedRequests, savedRows } from './SavedRequests';

const tree: HttpTree = {
  root: { path: '', name: '', requests: [{ id: 'users/list', name: 'List users', method: 'GET', url: '{{base}}/users' }], collections: [{ path: 'admin', name: 'admin', collections: [], requests: [{ id: 'admin/create', name: 'Create user', method: 'POST', url: '{{base}}/users' }] }] },
  environments: [], activeEnv: null, workspace: 'api',
};
const hist = (id: number, request: string, status: number, ts: number) => ({ id, ts, request, status, ok: status < 400, method: 'GET', url: '', ms: 1, size: 1, workspace: 'api', source: 'ui', runId: null, data: {} }) as unknown as HistoryRow;
const WS = [{ id: 'api', name: 'API', path: '/p/api', isDefault: true, exists: true, repos: [] }, { id: 'web', name: 'Web', path: '/p/web', isDefault: false, exists: true, repos: [] }];
const t = Date.now();

beforeEach(() => {
  vi.mocked(api).mockReset();
  localStorage.clear();
  routeApi({ 'GET /api/workspaces': WS, 'GET /api/http/tree': tree, 'GET /api/http/history': [hist(2, 'users/list', 200, t - 60_000), hist(1, 'users/list', 500, t - 120_000)] });
});

describe('Saved requests', () => {
  it('pairs each request with its newest history row', () => {
    expect(savedRows(tree, [hist(1, 'users/list', 500, 1), hist(2, 'users/list', 200, 2)])).toEqual([
      { id: 'users/list', name: 'List users', method: 'GET', last: { status: 200, ts: 2, ok: true } },
      { id: 'admin/create', name: 'Create user', method: 'POST' },
    ]);
  });

  it('lists method, name, last status and time, or never sent; rows open the API tab', async () => {
    const onGo = vi.fn();
    renderApp(<SavedRequests onGo={onGo} refreshKey={0} />);
    expect(await screen.findByText('List users')).toBeTruthy();
    expect(screen.getByText('200 · 1m ago')).toBeTruthy();
    expect(screen.getByText('never sent')).toBeTruthy();
    expect(calls('GET', '/api/http/history?ws=api&limit=100')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'api' });
  });

  it('reads the API tab’s workspace', async () => {
    localStorage.setItem('aorch.api.ws', 'web');
    renderApp(<SavedRequests onGo={() => {}} refreshKey={0} />);
    await screen.findByText('List users');
    expect(calls('GET', '/api/http/tree?ws=web')).toHaveLength(1);
  });

  it('reads the default workspace’s requests when the stored id is stale', async () => {
    localStorage.setItem('aorch.api.ws', 'removed');
    renderApp(<SavedRequests onGo={() => {}} refreshKey={0} />);
    await screen.findByText('List users');
    expect(calls('GET', '/api/http/tree?ws=api')).toHaveLength(1);
  });

  it('shows the no-workspace state on 409 and an inline error otherwise', async () => {
    routeApi({ 'GET /api/workspaces': [], 'GET /api/http/tree': new ApiError('no workspace', 409), 'GET /api/http/history': [] });
    const { unmount } = renderApp(<SavedRequests onGo={() => {}} refreshKey={0} />);
    expect(await screen.findByText('No workspace yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeTruthy();
    unmount();
    routeApi({ 'GET /api/workspaces': WS, 'GET /api/http/tree': new ApiError('disk full', 500), 'GET /api/http/history': [] });
    renderApp(<SavedRequests onGo={() => {}} refreshKey={0} />);
    expect((await screen.findByRole('alert')).textContent).toContain('disk full');
    routeApi({ 'GET /api/workspaces': WS, 'GET /api/http/tree': { ...tree, root: { ...tree.root, requests: [], collections: [] } }, 'GET /api/http/history': [] });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(screen.getByText('No saved requests')).toBeTruthy();
  });

  it('shows the skeleton on refresh and keeps its rows when the refresh fails', async () => {
    const { rerender } = renderApp(<SavedRequests onGo={() => {}} refreshKey={0} />);
    await screen.findByText('List users');
    let fail!: () => void;
    routeApi({ 'GET /api/workspaces': WS, 'GET /api/http/tree': () => new Promise((_, no) => (fail = () => no(new Error('down')))), 'GET /api/http/history': [] });
    rerender(<SavedRequests onGo={() => {}} refreshKey={1} />);
    expect(screen.getByRole('status', { name: 'Loading saved requests' })).toBeTruthy();
    await act(async () => fail());
    expect(screen.getByRole('alert').textContent).toContain("Couldn't refresh");
    expect(screen.getByText('List users')).toBeTruthy();
  });
});
