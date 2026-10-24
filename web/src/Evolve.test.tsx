import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { EvolvePanel } from './Evolve';
import { calls, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const edit = (n: number) => ({ n, field: 'guidance', op: 'add', after: `note ${n}`, lessons: [] });
const proposal = (o = {}) => ({ id: 'p1', bot: 'coder', base: 1, status: 'open', label: 'open', createdAt: '2026-10-23T10:00:00Z', stale: false, edits: [edit(1), edit(2)], ...o });
const harness = { bot: 'coder', evolvable: true, current: { version: 1, persona: 'Writes code', guidance: [], skills: [] }, versions: [{ version: 1, at: '2026-10-20T10:00:00Z' }, { version: 2, at: '2026-10-21T10:00:00Z' }], total: 2 };

const routes = (p: unknown) => routeApi({
  'GET /api/harness/coder': harness,
  'GET /api/proposals?bot=coder': { proposals: [p] },
  'GET /api/lessons?bot=coder': { lessons: [] },
  'POST /api/proposals/p1/accept': { harness: { version: 2 } },
  'POST /api/proposals/p1/reject': {},
  'POST /api/harness/coder/rollback': { harness: { version: 3 } },
});

beforeEach(() => {
  vi.mocked(api).mockReset();
});

it('starts with every edit picked and accepts the picked ones', async () => {
  routes(proposal());
  renderApp(<EvolvePanel bot="coder" name="Bolt" onClose={() => {}} />);
  expect(await screen.findByRole('button', { name: 'Accept all' })).toBeTruthy();
  fireEvent.click(screen.getAllByRole('checkbox')[0]!);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Accept 1 of 2' })));
  expect(calls('POST', '/api/proposals/p1/accept')[0]![2]).toEqual({ pick: [2] });
  expect(await screen.findByText(/harness is now v2/)).toBeTruthy();
});

it('picks nothing when the probe dropped edits', async () => {
  routes(proposal({ composed: { kept: [2], dropped: [1], unprobed: [] } }));
  renderApp(<EvolvePanel bot="coder" name="Bolt" onClose={() => {}} />);
  const accept = (await screen.findByRole('button', { name: /Accept 0 of 2/ })) as HTMLButtonElement;
  expect(accept.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Pick the kept edits' }));
  expect(screen.getByRole('button', { name: 'Accept 1 of 2' })).toBeTruthy();
});

it('asks before rejecting and before rolling back', async () => {
  routes(proposal());
  renderApp(<EvolvePanel bot="coder" name="Bolt" onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, reject' })));
  expect(calls('POST', '/api/proposals/p1/reject')).toHaveLength(1);
  fireEvent.click(screen.getByText(/Versions \(2\)/));
  fireEvent.click(await screen.findByRole('button', { name: 'Roll back to v2' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Roll back' })));
  await waitFor(() => expect(calls('POST', '/api/harness/coder/rollback')[0]![2]).toEqual({ version: 2 }));
});

it('drops its own heading inside a drawer but keeps Close', async () => {
  routes(proposal());
  const { unmount } = renderApp(<EvolvePanel bot="coder" name="Bolt" onClose={() => {}} />);
  expect(await screen.findByRole('heading', { name: 'Evolve · Bolt' })).toBeTruthy();
  unmount();
  renderApp(<EvolvePanel bot="coder" name="Bolt" inDrawer onClose={() => {}} />);
  expect(await screen.findByRole('button', { name: 'Accept all' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Evolve · Bolt' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Evolve Bolt' }).classList.contains('in-drawer')).toBe(true);
  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
});
