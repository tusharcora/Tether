import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cssRule } from '../../test/css';
import { Sidebar, type SidebarProps } from './Sidebar';

const w = (id: string) => ({ id, name: id, path: `/code/${id}`, isDefault: false, exists: true, repos: [] });
const setup = (o: Partial<SidebarProps> = {}) => {
  const p: SidebarProps = {
    active: 'home',
    onGo: vi.fn(),
    onSearch: vi.fn(),
    onSettings: vi.fn(),
    counts: { needs: 2, live: 1 },
    projects: { list: [w('shop'), w('blog')], current: 'shop', live: new Set(['blog']), onSelect: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn() },
    pins: { list: [{ kind: 'run', id: 'r1', label: 'Add rate limiting' }], canPin: true, onPin: vi.fn(), onOpen: vi.fn(), onUnpin: vi.fn() },
    ...o,
  };
  render(<Sidebar {...p} />);
  return p;
};
const narrow = () =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 1199px)', media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
const collapse = () => fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

beforeEach(() => localStorage.clear());

describe('Sidebar', () => {
  it('holds the mark, search, the screens in order with labels, the sections and Settings', () => {
    setup();
    expect(screen.getByText('Tether')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Home', 'Runs', 'Code', 'Builder', 'Crew', 'API client', 'Graph', 'Triggers']);
    expect(screen.getByRole('region', { name: 'Projects' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Pinned' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });

  it('marks the current screen as the page and goes where it is clicked; search opens ⌘K', () => {
    const p = setup({ active: 'runs' });
    expect(screen.getByRole('button', { name: 'Runs' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Crew' }));
    expect(p.onGo).toHaveBeenCalledWith('crew');
    fireEvent.click(screen.getByRole('button', { name: 'Search or jump to' }));
    expect(p.onSearch).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(p.onSettings).toHaveBeenCalled();
  });

  it('marks Settings while its drawer is open', () => {
    setup({ active: 'api', settingsOpen: true });
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'API client' }).getAttribute('aria-current')).toBeNull();
  });

  it('counts what needs you in amber and live runs in blue; collapsed, a dot stands in', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Home' }).querySelector('.sl-side-count.needs')!.textContent).toBe('2');
    expect(screen.getByRole('button', { name: 'Runs' }).querySelector('.sl-side-count.live')!.textContent).toBe('1');
    expect(screen.getByRole('button', { name: 'Builder' }).querySelector('.sl-side-count')).toBeNull();
    collapse();
    expect(screen.getByRole('button', { name: 'Home' }).querySelector('.sl-side-count')).toBeNull();
    expect(screen.getByRole('button', { name: 'Home' }).querySelector('.sl-side-dot.needs')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Runs' }).querySelector('.sl-side-dot.live')).toBeTruthy();
  });

  it('collapses and expands with its button and ⌘\\, and remembers the choice on this device', () => {
    setup();
    collapse();
    const side = document.querySelector('.sl-side')!;
    expect(side.classList.contains('collapsed')).toBe(true);
    expect(screen.queryByText('Tether')).toBeNull();
    expect(screen.getByRole('button', { name: 'Home' }).textContent).toBe('');
    expect(localStorage.getItem('aorch.sidebar')).toBe('closed');
    fireEvent.keyDown(window, { key: '\\', metaKey: true });
    expect(side.classList.contains('collapsed')).toBe(false);
    expect(localStorage.getItem('aorch.sidebar')).toBe('open');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(side.classList.contains('collapsed')).toBe(false);
  });

  it('starts collapsed when remembered so, and always below 1200 px', () => {
    localStorage.setItem('aorch.sidebar', 'closed');
    const { unmount } = render(<SidebarHost />);
    expect(document.querySelector('.sl-side.collapsed')).toBeTruthy();
    unmount();
    localStorage.setItem('aorch.sidebar', 'open');
    narrow();
    render(<SidebarHost />);
    expect(document.querySelector('.sl-side.collapsed')).toBeTruthy();
  });

  it('collapsed: shows a label tooltip after hover or focus, linked by aria-describedby, gone on Escape', () => {
    vi.useFakeTimers();
    setup();
    collapse();
    const crew = screen.getByRole('button', { name: 'Crew' });
    fireEvent.pointerEnter(crew);
    act(() => vi.advanceTimersByTime(300));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('Crew');
    expect(crew.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: 'blog' }));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('tooltip').textContent).toBe('blog');
    fireEvent.blur(screen.getByRole('button', { name: 'blog' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows no tooltip while expanded', () => {
    vi.useFakeTimers();
    setup();
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Crew' }));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('folds and unfolds its sections with disclosure buttons; collapsed, the rows stay as icons', () => {
    setup();
    const projects = screen.getByRole('button', { name: 'Projects' });
    expect(projects.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(projects);
    expect(projects.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'shop' })).toBeNull();
    collapse();
    expect(screen.getByRole('button', { name: 'shop' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Projects' })).toBeNull();
  });

  it('switches project, marks the current one and the one with a live run, opens a folder and removes the current project', () => {
    const p = setup();
    expect(screen.getByRole('button', { name: 'shop' }).classList.contains('current')).toBe(true);
    expect(screen.getByRole('button', { name: 'blog' }).querySelector('.sl-side-live')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'blog' }));
    expect(p.projects.onSelect).toHaveBeenCalledWith('blog');
    fireEvent.click(screen.getByRole('button', { name: 'Open folder…' }));
    expect(p.projects.onAdd).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Project options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove shop from Tether' }));
    expect(p.projects.onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'shop' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('pins the current run or request, opens and unpins pins', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pin this run or request' }));
    expect(p.pins.onPin).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add rate limiting' }));
    expect(p.pins.onOpen).toHaveBeenCalledWith(p.pins.list[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Pinned options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin Add rate limiting' }));
    expect(p.pins.onUnpin).toHaveBeenCalledWith(p.pins.list[0]);
  });

  it('says how to fill an empty section, and pinning waits for something to pin', () => {
    setup({ projects: { list: [], live: new Set(), onSelect: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn() }, pins: { list: [], canPin: false, onPin: vi.fn(), onOpen: vi.fn(), onUnpin: vi.fn() } });
    expect(screen.getByText(/No projects yet/)).toBeTruthy();
    expect(screen.getByText(/Pin a run or a saved request/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open a run or a saved request to pin it' }).hasAttribute('disabled')).toBe(true);
  });

  it('animates its width over 260 ms', () => {
    expect(cssRule('ui/studio/shell.css', '.sl-side')).toContain('transition: width 260ms var(--ease)');
    expect(cssRule('ui/studio/shell.css', '.sl-side')).toContain('width: 300px');
    expect(cssRule('ui/studio/shell.css', '.sl-side.collapsed')).toContain('width: 76px');
  });
});

function SidebarHost() {
  return (
    <Sidebar
      active="home"
      onGo={() => {}}
      onSearch={() => {}}
      onSettings={() => {}}
      counts={{ needs: 0, live: 0 }}
      projects={{ list: [], live: new Set(), onSelect: () => {}, onAdd: () => {}, onRemove: () => {} }}
      pins={{ list: [], canPin: false, onPin: () => {}, onOpen: () => {}, onUnpin: () => {} }}
    />
  );
}
