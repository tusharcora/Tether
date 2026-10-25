import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Rail } from './Rail';

const setup = (o: { active?: Parameters<typeof Rail>[0]['active']; settingsOpen?: boolean } = {}) => {
  const p = { onGo: vi.fn(), onSearch: vi.fn(), onSettings: vi.fn() };
  render(<Rail active={o.active ?? 'home'} settingsOpen={o.settingsOpen} {...p} />);
  return p;
};

describe('Rail', () => {
  it('is the main navigation with every screen, search on top and Settings at the bottom', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const names = [...nav.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Search or jump to', 'Home', 'Runs', 'Builder', 'Crew', 'API', 'Graph', 'Triggers', 'Settings']);
  });

  it('marks the active screen and goes where it is clicked', () => {
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
    expect(screen.getByRole('button', { name: 'API' }).getAttribute('aria-current')).toBeNull();
  });

  it('moves focus with arrow keys, Home and End (roving tabindex)', () => {
    setup({ active: 'home' });
    const home = screen.getByRole('button', { name: 'Home' });
    expect(home.tabIndex).toBe(0);
    expect(screen.getByRole('button', { name: 'Runs' }).tabIndex).toBe(-1);
    home.focus();
    fireEvent.keyDown(home, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Runs' }));
    expect(screen.getByRole('button', { name: 'Runs' }).tabIndex).toBe(0);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search or jump to' }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search or jump to' }));
  });

  it('shows the label tooltip 300 ms after hover or focus', () => {
    vi.useFakeTimers();
    setup();
    const crew = screen.getByRole('button', { name: 'Crew' });
    fireEvent.pointerEnter(crew);
    act(() => vi.advanceTimersByTime(299));
    expect(document.querySelector('.sl-rail-tip')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(document.querySelector('.sl-rail-tip')!.textContent).toBe('Crew');
    fireEvent.pointerLeave(crew);
    expect(document.querySelector('.sl-rail-tip')).toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: 'Graph' }));
    act(() => vi.advanceTimersByTime(300));
    expect(document.querySelector('.sl-rail-tip')!.textContent).toBe('Graph');
  });
});
