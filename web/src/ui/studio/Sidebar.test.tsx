import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../../api';
import type { ChatSummary } from '../../assistant/api';
import { cssRule } from '../../test/css';
import { Sidebar, sideRuns, type SidebarProps } from './Sidebar';

const w = (id: string) => ({ id, name: id, path: `/code/${id}`, isDefault: false, exists: true, repos: [] });
const run = (id: string, task: string, o: Partial<RunRow> = {}): RunRow =>
  ({ id, task, repo: '/code/shop', status: 'done', live: false, pending: 0, planReady: false, startedAt: 1, pipeline: 'p', costUsd: 0, nodes: {}, kind: 'workflow', mode: 'live', ...o }) as RunRow;
const chat = (id: string, title: string): ChatSummary => ({ id, title, updated: 1, count: 2, last: '', kind: 'answer', outcome: [], faces: [], cites: [] });
const setupProps = (o: Partial<SidebarProps> = {}): SidebarProps => ({
  active: 'home',
  onGo: vi.fn(),
  onSearch: vi.fn(),
  onSettings: vi.fn(),
  onCompose: vi.fn(),
  onCreate: vi.fn(),
  counts: { needs: 2, live: 1, goals: 0 },
  chats: { list: Array.from({ length: 7 }, (_, i) => chat(`c${i + 1}`, `Chat ${i + 1}`)), current: undefined, onNew: vi.fn(), onOpen: vi.fn(), onAll: vi.fn() },
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
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(names(nav)).toEqual(['Search', 'Home', 'Inbox', 'Runs', 'Chats', 'New chat', 'New chat', 'Chat 1', 'Chat 2', 'Chat 3', 'Chat 4', 'Chat 5', 'All chats', 'Workspace', 'Code', 'Builder', 'Crew', 'Goals', 'API client', 'Graph', 'Triggers']);
    const sections = [...document.querySelectorAll('.sl-side-section-title')].map((s) => s.textContent);
    expect(sections).toEqual(['Chats', 'Workspace', 'Runs', 'Favorites']);
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
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New run' }));
    expect(p.onCompose).toHaveBeenCalled();
  });

  it('opens a Create menu of new run, workflow, bot, trigger and request, and hands the pick on', async () => {
    const p = setup();
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create.getAttribute('aria-haspopup')).toBe('menu');
    expect(create.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(create);
    const menu = await screen.findByRole('menu', { name: 'Create' });
    expect(create.getAttribute('aria-expanded')).toBe('true');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.getAttribute('aria-label'))).toEqual(['New run', 'New workflow', 'New bot', 'New trigger', 'New request', 'New goal']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'New bot' }));
    expect(p.onCreate).toHaveBeenCalledWith('bot');
    expect(p.onCompose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('moves through the Create menu with the arrow keys and Escape returns to the button', async () => {
    setup();
    const create = screen.getByRole('button', { name: 'Create' });
    fireEvent.keyDown(create, { key: 'ArrowDown' });
    const menu = await screen.findByRole('menu');
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'New run' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'New workflow' }));
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'New goal' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'New run' }));
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(create);
  });

  it('lists the five latest chats under Chats, marks the open one, and starts, opens or lists chats', () => {
    const p = setup({ chats: { ...setupProps().chats, current: 'c2' } });
    const section = screen.getByRole('region', { name: 'Chats' });
    expect(within(section).queryByRole('button', { name: 'Chat 6' })).toBeNull();
    expect(within(section).getByRole('button', { name: 'Chat 2' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(section).getByRole('button', { name: 'Chat 3' }));
    expect(p.chats.onOpen).toHaveBeenCalledWith('c3');
    for (const b of within(section).getAllByRole('button', { name: 'New chat' })) fireEvent.click(b);
    expect(p.chats.onNew).toHaveBeenCalledTimes(2);
    fireEvent.click(within(section).getByRole('button', { name: 'All chats' }));
    expect(p.chats.onAll).toHaveBeenCalled();
  });

  it('opens All chats from the one chat icon on the rail', () => {
    localStorage.setItem('tether.sidebar', 'collapsed');
    const p = setup({ chats: { ...setupProps().chats, current: '' } });
    const icon = within(screen.getByRole('region', { name: 'Chats' })).getAllByRole('button', { name: 'Chats' }).at(-1)!;
    expect(icon.getAttribute('aria-current')).toBe('page');
    fireEvent.click(icon);
    expect(p.chats.onAll).toHaveBeenCalled();
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
    const hints = ['Code', 'Builder', 'Crew', 'Goals', 'API client', 'Graph', 'Triggers'].map((n) => screen.getByRole('button', { name: n }).querySelector('.sl-side-hint')!.textContent);
    expect(hints).toEqual(['G C', 'G B', 'G R', 'G O', 'G A', 'G G', 'G T']);
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
    const rows = sideRuns([...fin, run('q', 'queued', { status: 'paused' }), run('a', 'approval', { status: 'paused', steps: [{ id: 'ok', status: 'awaiting', bot: 'approval' }] }), run('n', 'waits', { planReady: true, status: 'running', live: true }), run('l', 'live', { live: true, status: 'running' }), run('p', 'probe', { probe: true, live: true })]);
    expect(rows.map((r) => r.run.id)).toEqual(['l', 'a', 'n', 'q', 'f6', 'f5', 'f4', 'f3', 'f2']);
    expect(rows.map((r) => r.state)).toEqual(['running', 'needs', 'needs', 'idle', 'done', 'failed', 'done', 'failed', 'done']);
  });

  it('opens and pins favorites, unpins and moves one with its ⋯ menu, and reorders with the sortable handle', () => {
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
    // a handle per row: with it focused, the arrow keys move the row and the new place is announced
    const handle = screen.getByRole('button', { name: 'Reorder README.md' });
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(p.pins.onReorder).toHaveBeenLastCalledWith([p.pins.list[1], p.pins.list[0]]);
    expect(screen.getByRole('status').textContent).toContain('README.md moved to position 1 of 2.');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder plan-code-review' }), { key: 'End' });
    expect(p.pins.onReorder).toHaveBeenLastCalledWith([p.pins.list[1], p.pins.list[0]]);
  });

  it('keeps the Favorites rows still on the collapsed rail', () => {
    localStorage.setItem('tether.sidebar', 'collapsed');
    setup();
    const handle = screen.getByRole('button', { name: 'Reorder README.md', hidden: true });
    expect((handle as HTMLButtonElement).disabled).toBe(true);
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

  it('is 244 px wide with dense 28 px rows, a 56 px rail collapsed, and animates its width over 240 ms', () => {
    expect(cssRule('ui/studio/shell.css', '.sl-side')).toContain('width: 244px');
    expect(cssRule('ui/studio/shell.css', '.sl-side')).toContain('transition: width 240ms var(--ease)');
    expect(cssRule('ui/studio/shell.css', '.sl-side.collapsed')).toContain('width: 56px');
    expect(cssRule('ui/studio/shell.css', '.sl-side-item')).toContain('height: 28px');
    expect(cssRule('ui/studio/shell.css', '.sl-side-item')).toContain('font-size: 13px');
  });

  it('shows the Tether glyph in the switcher, not a blue initials tile; the menu keeps small neutral initials', () => {
    setup();
    const sw = screen.getByRole('button', { name: 'Project: shop' });
    expect(sw.querySelector('.sl-glyph img')).toBeTruthy();
    expect(sw.querySelector('.sl-switch-tile')).toBeNull();
    expect(cssRule('ui/studio/shell.css', '.sl-switch-tile')).toContain('background: var(--s3)');
    expect(cssRule('ui/studio/shell.css', '.sl-switch-tile')).not.toMatch(/--acc|#2563eb/);
  });

  it('in Tether.app, leaves the traffic lights their corner and moves the window from the strip under them', () => {
    expect(cssRule('ui/studio/shell.css', '.tether-app .sl-side')).toContain('padding-top: 40px');
    expect(cssRule('ui/studio/shell.css', '.tether-app .sl-side::before,.tether-app .welcome::before')).toContain('-webkit-app-region: drag');
  });
});

describe('collapsing to the icon rail', () => {
  const collapse = () => fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

  it('collapses with the panel button and expands from the rail, remembering it on this device', () => {
    const { unmount } = render(<Sidebar {...setupProps()} />);
    collapse();
    const side = document.querySelector('.sl-side')!;
    expect(side.classList.contains('collapsed')).toBe(true);
    expect(localStorage.getItem('tether.sidebar')).toBe('collapsed');
    // the rail is the same markup (spec §6): the same rows, Runs and Favorites included; the glyph is the expand control,
    // the head's actions and the section headers go inert (they clip under the edge or become hairlines)
    expect(screen.queryByRole('button', { name: 'Project: shop' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand sidebar' }).querySelector('.sl-switch-glyph .sl-glyph')).toBeTruthy();
    // Chats folds to one chat icon that opens All chats
    expect(names(screen.getByRole('navigation', { name: 'Main' }))).toEqual(['Search', 'Home', 'Inbox', 'Runs', 'Chats', 'New chat', 'Chats', 'Workspace', 'Code', 'Builder', 'Crew', 'Goals', 'API client', 'Graph', 'Triggers']);
    expect(screen.getByRole('region', { name: 'Recent runs' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'README.md' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(document.querySelector('.sl-side-head-actions')!.hasAttribute('inert')).toBe(true);
    expect([...document.querySelectorAll('.sl-side-section-head')].every((h) => h.hasAttribute('inert'))).toBe(true);
    expect([...document.querySelectorAll('.sl-side-row-extra')].every((h) => h.hasAttribute('inert'))).toBe(true);
    unmount();
    render(<Sidebar {...setupProps()} />);
    expect(document.querySelector('.sl-side.collapsed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(document.querySelector('.sl-side.collapsed')).toBeNull();
    expect(localStorage.getItem('tether.sidebar')).toBe('open');
  });

  it('toggles with ⌘\\', () => {
    setup();
    fireEvent.keyDown(window, { key: '\\', metaKey: true });
    expect(document.querySelector('.sl-side.collapsed')).toBeTruthy();
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true });
    expect(document.querySelector('.sl-side.collapsed')).toBeNull();
  });

  it('turns counts into small dots on the rail (the count fades out, its dot fades in, in the icon cell)', () => {
    setup();
    collapse();
    expect(screen.getByRole('button', { name: 'Inbox' }).querySelector('.sl-side-icon .sl-side-dot.needs')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Runs' }).querySelector('.sl-side-icon .sl-side-dot.live')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Builder' }).querySelector('.sl-side-dot')).toBeNull();
    expect(cssRule('ui/studio/shell.css', '.sl-side-dot')).toContain('opacity: 0');
    expect(cssRule('ui/studio/shell.css', '.sl-side.collapsed .sl-side-dot')).toContain('opacity: 1');
    expect(cssRule('ui/studio/shell.css', '.sl-side.collapsed :is(.sl-side-label,.sl-side-meta,.sl-side-count,.sl-side-hint,.sl-side-chip,.sl-switch-name,.sl-switch-chev,.sl-side-head-actions,.sl-side-row-extra,.sl-side-section-head > *,.sl-side-empty)')).toBe('opacity: 0;');
  });

  it('shows a label tooltip after hover or focus, linked by aria-describedby, gone on Escape; none while expanded', () => {
    vi.useFakeTimers();
    setup();
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Crew' }));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole('tooltip')).toBeNull();
    collapse();
    const crew = screen.getByRole('button', { name: 'Crew' });
    fireEvent.pointerEnter(crew);
    act(() => vi.advanceTimersByTime(300));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('Crew');
    expect(crew.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: /Tushar/ }));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('tooltip').textContent).toBe('Tushar · GitHub connected');
    fireEvent.blur(screen.getByRole('button', { name: /Tushar/ }));
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: 'Expand sidebar' }));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('tooltip').textContent).toMatch(/^Expand sidebar {2}(⌘|Ctrl )\\$/);
    vi.useRealTimers();
  });
});
