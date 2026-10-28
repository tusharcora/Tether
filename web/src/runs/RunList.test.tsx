import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../api';
import type { Poll } from '../hooks';
import { makeRow } from '../test/fixtures';
import { filterRuns, RunList } from './RunList';

const poll = (data?: RunRow[], error?: string): Poll<RunRow[]> => ({ data, error, fails: 0, refresh: vi.fn(async () => {}) });
const rows = [
  makeRow({ id: 'r1', pipeline: 'ship', live: true, steps: [{ id: 'a', status: 'done', bot: 'coder' }, { id: 'b', status: 'running', bot: 'coder' }, { id: 'c', status: 'queued', bot: 'tester' }] }),
  makeRow({ id: 'r2', task: 'Second task', kind: 'team', status: 'running', live: true, pending: 2, startedAt: Date.now() - 120_000 }),
  makeRow({ id: 'r3', status: 'done', live: false, task: 'Finished one' }),
  makeRow({ id: 'r4', status: 'error', live: false, probe: true, task: 'Probe replay' }),
];
const setup = (o: { data?: RunRow[]; probes?: boolean } = {}) => {
  const p = { onSelect: vi.fn(), onProbes: vi.fn() };
  render(<RunList poll={poll(o.data ?? rows)} probes={o.probes ?? false} {...p} />);
  return p;
};

describe('RunList', () => {
  it('narrows to the current project with a switch, and Show all lifts every filter', () => {
    const data = [makeRow({ id: 'a', task: 'In shop', repo: '/code/shop/api' }), makeRow({ id: 'b', task: 'In blog', repo: '/code/blog' }), makeRow({ id: 'c', task: 'Shopfront', repo: '/code/shopfront' })];
    render(<RunList poll={poll(data)} probes={false} onProbes={vi.fn()} onSelect={vi.fn()} project={{ id: 'shop', name: 'shop', path: '/code/shop', isDefault: true, exists: true, repos: [] }} />);
    expect(screen.getByText('In blog')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'only shop' }));
    expect(screen.getByText('In shop')).toBeTruthy();
    expect(screen.queryByText('In blog')).toBeNull();
    expect(screen.queryByText('Shopfront')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('No finished runs in shop.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByText('In blog')).toBeTruthy();
  });

  it('filters All / Live / Done', () => {
    expect(filterRuns(rows, 'live').map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(filterRuns(rows, 'done').map((r) => r.id)).toEqual(['r3', 'r4']);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('Finished one')).toBeTruthy();
    expect(screen.queryByText('Second task')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(screen.getByText('Second task')).toBeTruthy();
  });

  it('titles rows by task text with a kind tag, a badge and cost · when', async () => {
    setup({ data: [makeRow({ task: 'Add rate limiting\nmore' }), makeRow({ id: 'r2', task: 'Second task', kind: 'team', pending: 1 })] });
    expect(await screen.findByText('Add rate limiting')).toBeTruthy();
    expect(screen.getByText('plan-code-review').className).toBe('sl-tag');
    expect(screen.getByText('Team').className).toBe('sl-tag');
    const r2 = screen.getByText('Second task').closest('tr')!;
    expect(r2.querySelector('[data-status="warning"]')!.textContent).toContain('needs you');
    expect(screen.queryByText('? 1')).toBeNull();
    expect(screen.getAllByText(/\$0\.12 · /).length).toBe(2);
  });

  it('draws a failed run with the failed glyph', () => {
    const { container } = render(<RunList poll={poll([makeRow({ status: 'error', live: false, steps: [{ id: 'a', status: 'done', bot: 'x' }] })])} probes={false} onProbes={() => {}} onSelect={() => {}} />);
    expect(screen.getByRole('img', { name: 'Failed' })).toBeTruthy();
    expect(container.querySelector('.prog-ring')).toBeNull();
  });

  it('tags probe replays', () => {
    setup();
    expect(screen.getByText('probe').getAttribute('title')).toBe('Evolve probe replay');
  });

  it('keeps the filters in one compact row under the page title', async () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Runs' })).toBeTruthy();
    const row = (await screen.findByRole('group', { name: 'Filter runs' })).closest('.run-list-filters')!;
    expect(within(row as HTMLElement).getByLabelText('show probe replays')).toBeTruthy();
  });

  it('selects a run from its row', () => {
    const p = setup({ data: rows });
    fireEvent.click(screen.getAllByText('Second task').at(-1)!);
    expect(p.onSelect).toHaveBeenCalledWith('r2');
  });

  it('is a table of runs: sortable by run and by status, a row opens a run from the keyboard', () => {
    const p = setup({ data: rows });
    const table = screen.getByRole('table', { name: 'Run list' });
    const order = () => within(table).getAllByRole('row').slice(1).map((r) => r.getAttribute('aria-label'));
    expect(order()).toHaveLength(4);
    const before = order();
    fireEvent.click(within(table).getByRole('button', { name: /^Status/ }));
    expect(within(table).getByRole('columnheader', { name: /Status/ }).getAttribute('aria-sort')).toBe('ascending');
    expect(order()[0]).toMatch(/running/);
    fireEvent.click(within(table).getByRole('button', { name: /^Status/ }));
    expect(within(table).getByRole('columnheader', { name: /Status/ }).getAttribute('aria-sort')).toBe('descending');
    expect(order()[0]).toMatch(/done/);
    fireEvent.click(within(table).getByRole('button', { name: /^Status/ }));
    expect(within(table).getByRole('columnheader', { name: /Status/ }).getAttribute('aria-sort')).toBe('ascending');
    expect(order()).not.toEqual(before.slice().reverse());
    expect(order()[0]).toMatch(/running/);
    const first = within(table).getAllByRole('row')[1]!;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(within(table).getAllByRole('row')[2]);
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(p.onSelect).toHaveBeenCalled();
  });

  it('toggles probe replays', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('switch', { name: 'show probe replays' }));
    expect(p.onProbes).toHaveBeenCalledWith(true);
  });

  it('says when there are no runs at all, or none for the filter', () => {
    setup({ data: [] });
    expect(screen.getByText('No runs yet.').className).toBe('sl-quiet');
  });

  it('says so when a filter matches nothing', () => {
    setup({ data: [rows[2]!] });
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(screen.getByText('No live runs.')).toBeTruthy();
  });

  it('offers to start a run when there are none, and to show all when a filter matches nothing (F14)', () => {
    const onStart = vi.fn();
    render(<RunList poll={poll([])} probes={false} onProbes={() => {}} onSelect={() => {}} onStart={onStart} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start a run' }));
    expect(onStart).toHaveBeenCalled();
  });

  it('shows all runs again from an empty filter', () => {
    setup({ data: [rows[2]!] });
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByText('Finished one')).toBeTruthy();
  });

  it('keeps the list and offers a compact retry when a later poll fails (F23)', () => {
    const p = poll(rows, 'down');
    render(<RunList poll={p} probes={false} onProbes={() => {}} onSelect={() => {}} />);
    expect(screen.getByText('Finished one')).toBeTruthy();
    expect(screen.getByRole('alert').className).toContain('compact');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(p.refresh).toHaveBeenCalled();
  });
});
