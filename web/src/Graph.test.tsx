import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { GraphView } from './Graph';
import { routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const graph = { nodes: [{ id: 'runs/r1.md', title: 'Run r1', type: 'run', tags: [], degree: 3 }, { id: 'roles/coder.md', title: 'Coder', type: 'role', tags: [], degree: 1 }], edges: [{ from: 'runs/r1.md', to: 'roles/coder.md' }], unresolved: 0 };

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({
    'GET /api/vault/graph': graph,
    'GET /api/vault/note': { path: 'runs/r1.md', title: 'Run r1', type: 'run', tags: [], body: 'body text', links: ['roles/coder'], backlinks: [] },
    'GET /api/vault/search': [{ path: 'roles/coder.md' }],
  });
});

it('draws notes and opens one', async () => {
  renderApp(<GraphView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run r1' }));
  expect(await screen.findByText('body text')).toBeTruthy();
  expect(screen.getByText('2 notes · 1 links · scroll to zoom, drag to pan')).toBeTruthy();
});

it('highlights search hits', async () => {
  const { container } = renderApp(<GraphView />);
  await screen.findByRole('button', { name: 'Run r1' });
  fireEvent.change(screen.getByLabelText('Search the vault'), { target: { value: 'coder' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Search' })));
  await waitFor(() => expect(container.querySelector('.g-node.hit')).toBeTruthy());
  expect(container.querySelectorAll('.g-node.dim')).toHaveLength(1);
});

it('explains an empty vault', async () => {
  routeApi({ 'GET /api/vault/graph': { nodes: [], edges: [], unresolved: 0 } });
  renderApp(<GraphView />);
  expect(await screen.findByText(/The vault is empty/)).toBeTruthy();
});
