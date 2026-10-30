import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));

import { ApiError, api, type RunRow } from '../api';
import type { Poll } from '../hooks';
import { makeRow, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { RunList } from './RunList';

const poll = (data?: RunRow[], error?: string): Poll<RunRow[]> => ({ data, error, fails: 0, refresh: vi.fn(async () => {}) });
const H = 3_600_000;
const rows = [
  makeRow({ id: 'r1', task: 'Sign-in returns people to where they were', status: 'paused', live: false, added: 42, deleted: 9, origin: { kind: 'goal', id: 'g1', team: 'web' }, steps: [{ id: 'fix', status: 'done', bot: 'coder', kind: 'agent' }, { id: 'ok', status: 'awaiting', bot: 'approval', kind: 'approval', title: 'You approve' }] }),
  makeRow({ id: 'r2', task: 'Dark mode for settings', live: true, bots: ['coder', 'reviewer'], current: { node: 'b', bot: 'Bolt', title: 'Implement' }, steps: [{ id: 'a', status: 'done', bot: 'coder' }, { id: 'b', status: 'running', bot: 'coder' }] }),
  makeRow({ id: 'r3', task: 'Upgrade vite', status: 'error', live: false, startedAt: Date.now() - H, steps: [{ id: 'a', status: 'done', bot: 'coder' }, { id: 't', status: 'error', bot: 'tester', title: 'Tests' }] }),
  makeRow({ id: 'r4', task: 'Billing empty state', status: 'done', live: false, startedAt: Date.now() - 3 * 24 * H, ship: { url: 'u', number: 138, merged: true }, costUsd: 0.51 }),
];
const setup = (o: { data?: RunRow[]; schedules?: boolean; onShip?: (id: string) => Promise<void> } = {}) => {
  routeApi({
    'GET /api/squads': { squads: [{ id: 'web', name: 'web', place: 'tether', project: 'w', agents: [], status: 'idle', needs: 0, recent: [], queue: [] }], agents: [] },
    'GET /api/schedules': o.schedules ? { schedules: [{ id: 's1', name: 'Triage failing tests', when: 'every night 02:00', bot: 'tester' }] } : new ApiError('not found', 404),
  });
  const p = { onSelect: vi.fn(), onProbes: vi.fn(), onStart: vi.fn() };
  renderApp(<RunList poll={poll(o.data ?? rows)} probes={false} {...p} onShip={o.onShip} />);
  return p;
};

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('Runs, remade', () => {
  it('puts what needs you first with its action inline, then live, today and earlier', async () => {
    const onShip = vi.fn(async () => {});
    const p = setup({ onShip });
    const needs = screen.getByRole('region', { name: 'Needs you' });
    const card = within(needs).getByRole('group', { name: 'Sign-in returns people to where they were' });
    expect(await within(card).findByText('You approve waits on you · +42 −9 · # web · ticket')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Approve & open PR' }));
    await waitFor(() => expect(onShip).toHaveBeenCalledWith('r1'));
    fireEvent.click(within(card).getByRole('button', { name: 'Review diff' }));
    expect(p.onSelect).toHaveBeenCalledWith('r1');
    const live = screen.getByRole('region', { name: 'Live' });
    expect(within(live).getByText('Bolt on Implement')).toBeTruthy();
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).getByText('Tests failed · Retry from Tests').className).toBe('bad');
    const earlier = screen.getByRole('region', { name: 'Earlier' });
    expect(within(earlier).getByText('PR #138 merged')).toBeTruthy();
    fireEvent.click(within(earlier).getByRole('button', { name: 'Billing empty state, Done' }));
    expect(p.onSelect).toHaveBeenCalledWith('r4');
  });

  it('filters by needs you and live (with counts), team and search; Show all clears them', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Needs you · 1' }));
    expect(screen.queryByText('Dark mode for settings')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Live · 1' }));
    expect(screen.getByText('Dark mode for settings')).toBeTruthy();
    expect(screen.queryByText('Upgrade vite')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await screen.findByRole('option', { name: '# web' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Squad' }), { target: { value: 'web' } });
    expect(screen.queryByText('Upgrade vite')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Squad' }), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Search runs'), { target: { value: 'nothing like this' } });
    expect(screen.getByText('No runs match.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByText('Upgrade vite')).toBeTruthy();
  });

  it('shows the week on the right: runs, merged PRs, spend per day and where runs started', () => {
    setup();
    const rail = screen.getByRole('complementary', { name: 'Overview' });
    expect(within(rail).getByText('PRs merged').previousElementSibling!.textContent).toBe('1');
    expect(within(rail).getByText('runs').previousElementSibling!.textContent).toBe('4');
    expect(within(rail).getByRole('img', { name: /Spend per day, last 7 days/ })).toBeTruthy();
    expect(within(rail).getByText('Tickets 1')).toBeTruthy();
    expect(within(rail).getByText('Other 3')).toBeTruthy();
    expect(within(rail).queryByText('Chats 0')).toBeNull();
  });

  it('shows Scheduled only when the schedules API answers', async () => {
    setup({ schedules: true });
    expect(await screen.findByRole('button', { name: 'Scheduled' })).toBeTruthy();
    expect(within(screen.getByRole('complementary', { name: 'Overview' })).getByText('Triage failing tests')).toBeTruthy();
  });

  it('hides Scheduled without the API, and keeps probe replays in the ⋯ menu', async () => {
    const p = setup();
    await waitFor(() => expect(vi.mocked(api).mock.calls.some((c) => c[1] === '/api/schedules')).toBe(true));
    expect(screen.queryByRole('button', { name: 'Scheduled' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More run filters' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show probe replays' }));
    expect(p.onProbes).toHaveBeenCalledWith(true);
  });

  it('offers New run, and Start a run when there are none', () => {
    const p = setup({ data: [] });
    expect(screen.getByText('No runs yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start a run' }));
    fireEvent.click(screen.getByRole('button', { name: 'New run' }));
    expect(p.onStart).toHaveBeenCalledTimes(2);
  });

  it('keeps the list and offers a compact retry when a later poll fails', () => {
    routeApi({ 'GET /api/squads': { squads: [], agents: [] }, 'GET /api/schedules': new ApiError('nf', 404) });
    const pl = poll(rows, 'down');
    renderApp(<RunList poll={pl} probes={false} onProbes={() => {}} onSelect={() => {}} />);
    expect(screen.getByText('Upgrade vite')).toBeTruthy();
    expect(screen.getByRole('alert').className).toContain('compact');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(pl.refresh).toHaveBeenCalled();
  });
});
