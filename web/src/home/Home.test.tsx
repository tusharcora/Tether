import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { Home } from './Home';

beforeEach(() => {
  vi.mocked(api).mockReset();
  localStorage.clear();
  routeApi({
    'GET /api/workspaces': [{ id: 'api', name: 'API', path: '/p/api', isDefault: true, exists: true, repos: [] }],
    'GET /api/roster/preview': new Error('hidden'),
  });
});

describe('Home', () => {
  it('polls the workspace list once and shares it with its sections', async () => {
    renderApp(<Home onGo={() => {}} />);
    expect(await screen.findByLabelText('Task')).toBeTruthy();
    await act(async () => {});
    expect(calls('GET', '/api/workspaces')).toHaveLength(1);
  });
});
