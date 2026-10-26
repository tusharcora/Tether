import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../../api';
import { cssRule } from '../../test/css';
import { Sidebar, sideRuns, useSidebarDock, type SidebarProps } from './Sidebar';

const w = (id: string) => ({ id, name: id, path: `/code/${id}`, isDefault: false, exists: true, repos: [] });
const run = (id: string, task: string, o: Partial<RunRow> = {}): RunRow =>
  ({ id, task, repo: '/code/shop', status: 'done', live: false, pending: 0, planReady: false, startedAt: 1, pipeline: 'p', costUsd: 0, nodes: {}, kind: 'workflow', mode: 'live', ...o }) as RunRow;
const setupProps = (o: Partial<SidebarProps> = {}): SidebarProps => ({
  active: 'home',
  onGo: vi.fn(),
  onSearch: vi.fn(),
  onSettings: vi.fn(),
  onCompose: vi.fn(),
  counts: { needs: 2, live: 1 },
  runs: { list: [run('rmh0aaa1144', 'Tune the limit window', { live: true, status: 'running' }), run('rmh0aaa1142', 'Plan auth flow', { pending: 1, status: 'paused' }), run('rmh0aaa1141', 'Add rate limiting', { finishedAt: 5 })], onOpen: vi.fn() },
  projects: { list: [w('shop'), w('blog')], current: 'shop', live: new Set(['blog']), onSelect: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn() },
  pins: { list: [{ kind: 'workflow', id: 'plan-code-review', label: 'plan-code-review' }, { kind: 'file', id: 'README.md', label: 'README.md', ws: 'shop' }], canPin: true, onPin: vi.fn(), onOpen: vi.fn(), onUnpin: vi.fn(), onReorder: vi.fn() },
  account: { name: 'Tushar', provider: 'GitHub', onOpen: vi.fn() },
  ...o,
});
const setup = (o: Partial<SidebarProps> = {}) => {
  const p = setupProps(o);
  render(<Sidebar {...p} />);
  return p;
};
const names = (el: HTMLElement) => within(el).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);

beforeEach(() => localStorage.clear());

describe('Sidebar', () => {
  it('lays out the switcher and compose, Search · Home · Inbox · Runs, Workspace, Runs, Favorites, then Settings and the account', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Project: shop' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New run' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(names(nav)).toEqual(['Search', 'Home', 'Inbox', 'Runs', 'Workspace', 'Code', 'Builder', 'Crew', 'API client', 'Graph', 'Triggers']);
    const sections = [...document.querySelectorAll('.sl-side-section-title')].map((s) => s.textContent);
    expect(sections).toEqual(['Workspace', 'Runs', 'Favorites']);
    const foot = document.querySelector('.sl-side-foot') as HTMLElement;
    expect(names(foot)).toEqual(['Settings', 'Tushar: GitHub connected. Open Accounts']);
  });

  it('marks the current page, goes where clicked, opens ⌘K, Settings and compose', () => {
    const p = setup({ active: 'inbox' });
    expect(screen.getByRole('button', { name: 'Inbox' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Crew' }));
    expect(p.onGo).toHaveBeenCalledWith('crew');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(p.onSearch).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(p.onSettings).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'New run' }));
    expect(p.onCompose).toHaveBeenCalled();
  });

  it('marks Settings while its drawer is open', () => {
    setup({ active: 'api', settingsOpen: true });
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'API client' }).getAttribute('aria-current')).toBeNull();
  });

  it('counts what needs you in amber on Inbox and live runs in blue on Runs; Workspace rows carry their G shortcut', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Inbox' }).querySelector('.sl-side-count.needs')!.textContent).toBe('2');
    expect(screen.getByRole('button', { name: 'Runs' }).querySelector('.sl-side-count.live')!.textContent).toBe('1');
    const hints = ['Code', 'Builder', 'Crew', 'API client', 'Graph', 'Triggers'].map((n) => screen.getByRole('button', { name: n }).querySelector('.sl-side-hint')!.textContent);
    expect(hints).toEqual(['G C', 'G B', 'G R', 'G A', 'G G', 'G T']);
    expect(screen.getByRole('button', { name: 'Home' }).querySelector('.sl-side-hint')!.textContent).toBe('G H');
  });

  it('lists the runs with labelled status glyphs and short ids; a click opens one, View all goes to Runs', () => {
    const p = setup();
    const runs = screen.getByRole('region', { name: 'Recent runs' });
    expect(within(runs).getAllByRole('img').map((g) => g.getAttribute('aria-label'))).toEqual(['Running', 'Needs you', 'Done']);
    expect(within(runs).getByText('R-1144')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Plan auth flow · Needs you · R-1142' }));
    expect(p.runs.onOpen).toHaveBeenCalledWith('rmh0aaa1142');
    fireEvent.click(within(runs).getByRole('button', { name: 'View all' }));
    expect(p.onGo).toHaveBeenCalledWith('runs');
  });

  it('orders runs live, waiting, queued, then the last five finished (newest first), without probes', () => {
    const fin = Array.from({ length: 7 }, (_, i) => run(`f${i}`, `done ${i}`, { finishedAt: 10 + i, status: i % 2 ? 'error' : 'done' }));
    const rows = sideRuns([...fin, run('q', 'queued', { status: 'paused' }), run('n', 'waits', { planReady: true, status: 'running', live: true }), run('l', 'live', { live: true, status: 'running' }), run('p', 'probe', { probe: true, live: true })]);
    expect(rows.map((r) => r.run.id)).toEqual(['l', 'n', 'q', 'f6', 'f5', 'f4', 'f3', 'f2']);
    expect(rows.map((r) => r.state)).toEqual(['running', 'needs', 'idle', 'done', 'failed', 'done', 'failed', 'done']);
  });

  it('opens and pins favorites, unpins and moves one with its ⋯ menu, and reorders by drag', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'README.md' }));
    expect(p.pins.onOpen).toHaveBeenCalledWith(p.pins.list[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Pin what is open' }));
    expect(p.pins.onPin).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'plan-code-review options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(p.pins.onReorder).toHaveBeenLastCalledWith([p.pins.list[1], p.pins.list[0]]);
    fireEvent.click(screen.getByRole('button', { name: 'README.md options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin README.md' }));
    expect(p.pins.onUnpin).toHaveBeenCalledWith(p.pins.list[1]);
    const rows = document.querySelectorAll('.sl-side-row.pin');
    fireEvent.dragStart(rows[1]!);
    fireEvent.drop(rows[0]!);
    expect(p.pins.onReorder).toHaveBeenLastCalledWith([p.pins.list[1], p.pins.list[0]]);
  });

  it('says how to fill empty Runs and Favorites, and pinning waits for something open', () => {
    setup({ runs: { list: [], onOpen: vi.fn() }, pins: { list: [], canPin: false, onPin: vi.fn(), onOpen: vi.fn(), onUnpin: vi.fn(), onReorder: vi.fn() } });
    expect(screen.getByText('No runs in this project yet.')).toBeTruthy();
    expect(screen.getByText(/Pin a run, a request, a workflow or a file/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open a run, request, workflow or file to pin it' }).hasAttribute('disabled')).toBe(true);
  });

  it('folds sections with their disclosure header and remembers it on this device', () => {
    const { unmount } = render(<Sidebar {...setupProps()} />);
    const head = screen.getByRole('button', { name: 'Favorites' });
    expect(head.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'README.md' })).toBeNull();
    unmount();
    render(<Sidebar {...setupProps()} />);
    expect(screen.getByRole('button', { name: 'Favorites' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Recent runs' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('switches project from the switcher menu, which also opens a folder, reveals and removes the current project', () => {
    const onReveal = vi.fn();
    const p = setup({ projects: { ...setupProps().projects, onReveal } });
    fireEvent.click(screen.getByRole('button', { name: 'Project: shop' }));
    const menu = screen.getByRole('menu', { name: 'Projects' });
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['SHshop', 'BLblog', expect.stringMatching(/^Open folder…(⌘|Ctrl )O$/), 'Reveal shop in Finder', 'Remove shop from Tether']);
    expect(within(menu).getByRole('img', { name: 'a run is live' })).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /blog/ }));
    expect(p.projects.onSelect).toHaveBeenCalledWith('blog');
    fireEvent.click(screen.getByRole('button', { name: 'Project: shop' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Open folder/ }));
    expect(p.projects.onAdd).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Project: shop' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reveal shop in Finder' }));
    expect(onReveal).toHaveBeenCalledWith(expect.objectContaining({ id: 'shop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Project: shop' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove shop from Tether' }));
    expect(p.projects.onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'shop' }));
  });

  it('says the projects are loading, and offers Retry when the first load failed', () => {
    const base = { list: [], live: new Set<string>(), onSelect: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn() };
    const { rerender } = render(<Sidebar {...setupProps()} projects={{ ...base, loading: true }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Project: Loading…' }));
    expect(screen.getByRole('status', { name: 'Loading projects' })).toBeTruthy();
    const onRetry = vi.fn();
    rerender(<Sidebar {...setupProps()} projects={{ ...base, error: { message: "Couldn't load projects", onRetry } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows the account chip: GitHub with a green dot when connected, Connect otherwise; both open Accounts', () => {
    const p = setup();
    const row = screen.getByRole('button', { name: /Tushar/ });
    expect(row.querySelector('.sl-side-chip-dot')).toBeTruthy();
    expect(row.textContent).toContain('GitHub');
    fireEvent.click(row);
    expect(p.account.onOpen).toHaveBeenCalled();
    render(<Sidebar {...setupProps({ account: { name: 'tushar', onOpen: vi.fn() } })} />);
    const off = screen.getByRole('button', { name: 'tushar: no account connected. Open Accounts' });
    expect(off.querySelector('.sl-side-chip-dot')).toBeNull();
    expect(off.textContent).toContain('Connect');
  });

  it('is 244 px wide with dense 28 px rows, and floats while peeking', () => {
    expect(cssRule('ui/studio/shell.css', '.sl-side')).toContain('width: 244px');
    expect(cssRule('ui/studio/shell.css', '.sl-side-item')).toContain('height: 28px');
    expect(cssRule('ui/studio/shell.css', '.sl-side-item')).toContain('font-size: 13px');
    expect(cssRule('ui/studio/shell.css', '.sl-side.floating')).toContain('position: fixed');
    setup({ floating: true });
    expect(document.querySelector('.sl-side.floating')).toBeTruthy();
  });

  it('in Tether.app, leaves the traffic lights their corner and moves the window from the strip under them', () => {
    expect(cssRule('ui/studio/shell.css', '.tether-app .sl-side:not(.floating)')).toContain('padding-top: 40px');
    expect(cssRule('ui/studio/shell.css', '.tether-app .sl-side::before,.tether-app .welcome::before')).toContain('-webkit-app-region: drag');
  });
});

describe('useSidebarDock', () => {
  it('hides and docks with ⌘\\, remembers it, and peeks only while hidden', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useSidebarDock());
    expect(result.current.hidden).toBe(false);
    act(() => result.current.peekIn());
    expect(result.current.peek).toBe(false);
    act(() => void fireEvent.keyDown(window, { key: '\\', metaKey: true }));
    expect(result.current.hidden).toBe(true);
    expect(localStorage.getItem('tether.sidebar')).toBe('hidden');
    act(() => result.current.peekIn());
    expect(result.current.peek).toBe(true);
    act(() => result.current.peekOut());
    act(() => result.current.peekIn());
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.peek).toBe(true);
    act(() => result.current.peekOut());
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.peek).toBe(false);
    unmount();
    const again = renderHook(() => useSidebarDock());
    expect(again.result.current.hidden).toBe(true);
    act(() => again.result.current.toggle());
    expect(again.result.current.hidden).toBe(false);
    expect(localStorage.getItem('tether.sidebar')).toBe('docked');
    vi.useRealTimers();
  });
});
