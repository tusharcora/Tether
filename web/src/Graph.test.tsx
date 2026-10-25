import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api, ApiError } from './api';
import { GraphView, VAULT_SCAN_MS } from './Graph';
import { VAULT_POLL_MS } from './graph/useVaultActivity';
import { calls, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const graph = {
  nodes: [
    { id: 'runs/r1.md', title: 'Run r1', type: 'run', tags: ['aorch/run'], degree: 2 },
    { id: 'roles/coder.md', title: 'Coder', type: 'role', tags: [], degree: 1 },
    { id: 'notes/x.md', title: 'Loose note', tags: ['design'], degree: 1 },
  ],
  edges: [
    { from: 'runs/r1.md', to: 'roles/coder.md' },
    { from: 'notes/x.md', to: 'runs/r1.md' },
  ],
  unresolved: 1,
};
const noteFor = (path: string) => {
  const n = graph.nodes.find((x) => x.id === path) ?? { title: path, type: 'note' };
  return { path, title: n.title, type: n.type, tags: ['aorch/run'], body: `body of ${n.title}`, links: [], backlinks: [] };
};
const routes = {
  'GET /api/vault/graph': graph as unknown,
  'GET /api/vault/note': (_b: unknown, p: string) => {
    const path = decodeURIComponent(p.split('path=')[1]!);
    return path.startsWith('ghost') ? new ApiError('no such note', 404) : noteFor(path);
  },
  'GET /api/vault/search': [{ path: 'roles/coder.md' }],
  'GET /api/vault/activity': { items: [], cursor: null },
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  // reduced motion: the layout rests at once and the camera jumps, so positions are final on the first paint
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)', media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  routeApi(routes);
});

describe('Graph', () => {
  it('draws the vault, reads a note and lists what it connects to', async () => {
    const onNote = vi.fn();
    renderApp(<GraphView onNote={onNote} />);
    expect(await screen.findByText('vault · 3 notes · 2 links · 1 unresolved')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /^Run r1, run/ }));
    expect(onNote).toHaveBeenLastCalledWith('runs/r1.md');
    expect(await screen.findByText('body of Run r1')).toBeTruthy();
    const reader = screen.getByRole('region', { name: 'Reader' });
    expect(within(reader).getByRole('heading', { name: 'Run r1' })).toBeTruthy();
    expect(within(reader).getByRole('button', { name: /links to Coder/ })).toBeTruthy();
    expect(within(reader).getByRole('button', { name: /linked from Loose note/ })).toBeTruthy();
  });

  it('navigates by a connected note and searches by a tag', async () => {
    renderApp(<GraphView />);
    fireEvent.click(await screen.findByRole('button', { name: /^Run r1, run/ }));
    const reader = await screen.findByRole('region', { name: 'Reader' });
    fireEvent.click(await within(reader).findByRole('button', { name: /links to Coder/ }));
    expect(await screen.findByText('body of Coder')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '#aorch/run' }));
    expect((screen.getByLabelText('Search the vault') as HTMLInputElement).value).toBe('#aorch/run');
    expect(screen.getByText('1 found')).toBeTruthy();
  });

  it('pulses search hits with a count and dims the rest', async () => {
    const { container } = renderApp(<GraphView />);
    await screen.findByRole('button', { name: /^Run r1,/ });
    fireEvent.change(screen.getByLabelText('Search the vault'), { target: { value: 'coder' } });
    expect(screen.getByText('1 found')).toBeTruthy();
    await waitFor(() => expect(calls('GET', '/api/vault/search?q=coder')).toHaveLength(1));
    expect(container.querySelector('[data-gn="roles/coder.md"] .gb-match')).toBeTruthy();
    expect(container.querySelectorAll('.gb-node.dim')).toHaveLength(2);
  });

  it('hides a note type from its filter button', async () => {
    const { container } = renderApp(<GraphView />);
    await screen.findByRole('button', { name: /^Run r1,/ });
    const runs = screen.getByRole('button', { name: 'runs 1' });
    expect(runs.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(runs);
    expect(runs.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-gn="runs/r1.md"]')!.classList.contains('hidden')).toBe(true);
  });

  it('moves through the All notes list with the keyboard', async () => {
    renderApp(<GraphView />);
    const list = await screen.findByRole('navigation', { name: 'All notes' });
    const items = within(list).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual(['Coder', 'Loose note', 'Run r1']);
    items[0]!.focus();
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.click(items[2]!);
    expect(await screen.findByText('body of Run r1')).toBeTruthy();
    expect(items[2]!.getAttribute('aria-current')).toBe('true');
  });

  it('opens the note a deep link names', async () => {
    renderApp(<GraphView note="roles/coder.md" onNote={() => {}} />);
    expect(await screen.findByText('body of Coder')).toBeTruthy();
  });

  it('says so when the linked note is not in the vault', async () => {
    renderApp(<GraphView note="ghost.md" onNote={() => {}} />);
    expect(await screen.findByText('That note is not in the vault.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /^Run r1,/ })).toBeTruthy();
  });

  it('reloads the graph when a run writes a note it does not have', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let current = graph;
    let polls = 0;
    const written = { id: 'r9:4', ts: Date.now(), runId: 'r9', run: 'ship', path: 'Runs/new.md' };
    routeApi({
      ...routes,
      'GET /api/vault/graph': () => current,
      'GET /api/vault/activity': () => (polls++ === 1 ? { items: [written], cursor: `${written.ts}:r9:4` } : { items: [], cursor: polls > 1 ? `${written.ts}:r9:4` : null }),
    });
    const { container } = renderApp(<GraphView />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('button', { name: /^Run r1,/ })).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS));
    expect(screen.getByText(/ship recorded Runs\/new\.md/)).toBeTruthy();
    current = { ...graph, nodes: [...graph.nodes, { id: 'Runs/new.md', title: 'New run', type: 'run', tags: [], degree: 0 }] };
    await act(() => vi.advanceTimersByTimeAsync(VAULT_SCAN_MS));
    expect(calls('GET', '/api/vault/graph')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^New run, run/ })).toBeTruthy();
    expect(container.querySelector('[data-gn="Runs/new.md"] .gb-ping')).toBeTruthy();
    expect(screen.getByText(/ship recorded New run/)).toBeTruthy();
  });

  it('selects a note pressed on the board with real pointer events, and hands its path to the hash', async () => {
    const onNote = vi.fn();
    const { container } = renderApp(<GraphView onNote={onNote} />);
    const r1 = await screen.findByRole('button', { name: /^Run r1, run/ });
    fireEvent.pointerDown(r1, { pointerId: 1, clientX: 40, clientY: 40 });
    fireEvent.pointerUp(r1, { pointerId: 1, clientX: 41, clientY: 41 });
    expect(onNote).toHaveBeenLastCalledWith('runs/r1.md');
    expect(await screen.findByText('body of Run r1')).toBeTruthy();
    expect(container.querySelector('[data-gn="runs/r1.md"]')!.classList.contains('sel')).toBe(true);
  });

  it('narrows the All notes list to the search matches and opens the first on Enter', async () => {
    renderApp(<GraphView />);
    await screen.findByRole('button', { name: /^Run r1,/ });
    const search = screen.getByLabelText('Search the vault');
    fireEvent.change(search, { target: { value: 'e' } });
    const list = screen.getByRole('navigation', { name: 'All notes' });
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['Coder', 'Loose note']);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(await screen.findByText('body of Coder')).toBeTruthy();
  });

  it('reloads when any note in a poll is new, not only the newest', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let polls = 0;
    const known = { id: 'r9:5', ts: Date.now(), runId: 'r9', run: 'ship', path: 'roles/coder.md' };
    const unknown = { id: 'r9:4', ts: Date.now(), runId: 'r9', run: 'ship', path: 'Runs/new.md' };
    routeApi({
      ...routes,
      'GET /api/vault/activity': () => (polls++ === 1 ? { items: [known, unknown], cursor: `${known.ts}:r9:5` } : { items: [], cursor: polls > 1 ? `${known.ts}:r9:5` : null }),
    });
    renderApp(<GraphView />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(VAULT_POLL_MS));
    await act(() => vi.advanceTimersByTimeAsync(VAULT_SCAN_MS));
    expect(calls('GET', '/api/vault/graph')).toHaveLength(2);
  });

  it('shows a load failure inline and retries', async () => {
    let down = true;
    routeApi({ ...routes, 'GET /api/vault/graph': () => (down ? new Error('vault gone') : graph) });
    renderApp(<GraphView />);
    expect((await screen.findByRole('alert')).textContent).toContain('vault gone');
    down = false;
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(await screen.findByRole('button', { name: /^Run r1,/ })).toBeTruthy();
  });

  it('explains an empty vault', async () => {
    routeApi({ ...routes, 'GET /api/vault/graph': { nodes: [], edges: [], unresolved: 0 } });
    renderApp(<GraphView />);
    expect(await screen.findByText(/The vault is empty/)).toBeTruthy();
  });
});
