import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../api';
import type { Poll } from '../hooks';
import { makeRow } from '../test/fixtures';
import { filterRuns, RunList } from './RunList';

const poll = (data?: RunRow[], error?: string): Poll<RunRow[]> => ({ data, error, fails: 0, refresh: vi.fn(async () => {}) });
const rows = [
  makeRow({ id: 'r1', pipeline: 'ship', live: true, steps: [{ id: 'a', status: 'done', bot: 'coder' }, { id: 'b', status: 'running', bot: 'coder' }, { id: 'c', status: 'queued', bot: 'tester' }] }),
  makeRow({ id: 'r2', task: 'Second task', kind: 'team', status: 'running', live: true, pending: 2 }),
  makeRow({ id: 'r3', status: 'done', live: false, task: 'Finished one' }),
  makeRow({ id: 'r4', status: 'error', live: false, probe: true, task: 'Probe replay' }),
];
const setup = (o: { data?: RunRow[]; selected?: string; probes?: boolean } = {}) => {
  const p = { onSelect: vi.fn(), onProbes: vi.fn() };
  render(<RunList poll={poll(o.data ?? rows)} probes={o.probes ?? false} selected={o.selected} {...p} />);
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

  it('shows a progress ring, status, title, badges, task, cost and age per row', () => {
    const { container } = render(<RunList poll={poll(rows)} probes={false} onProbes={() => {}} onSelect={() => {}} />);
    expect(container.querySelector('[data-progress="1/3"]')).toBeTruthy();
    expect(screen.getByText('ship')).toBeTruthy();
    expect(screen.getByText('? 2')).toBeTruthy();
    expect(screen.getAllByText('Team').length).toBeGreaterThan(0);
    expect(screen.getByText('probe')).toBeTruthy();
    expect(screen.getAllByText(/\$0\.12 · /).length).toBe(4);
  });

  it('selects a run and draws the moving border only on a selected live run', () => {
    const { container, rerender } = render(<RunList poll={poll(rows)} probes={false} onProbes={() => {}} selected="r1" onSelect={() => {}} />);
    expect(container.querySelector('.run-row[aria-current="true"] .run-live-border')).toBeTruthy();
    rerender(<RunList poll={poll(rows)} probes={false} onProbes={() => {}} selected="r3" onSelect={() => {}} />);
    expect(container.querySelector('.run-live-border')).toBeNull();
    const p = setup({ data: rows });
    fireEvent.click(screen.getAllByText('Second task').at(-1)!);
    expect(p.onSelect).toHaveBeenCalledWith('r2');
  });

  it('toggles probe replays', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('switch', { name: 'show probe replays' }));
    expect(p.onProbes).toHaveBeenCalledWith(true);
  });

  it('says when there are no runs at all, or none for the filter', () => {
    setup({ data: [] });
    expect(screen.getByText('No runs yet')).toBeTruthy();
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
