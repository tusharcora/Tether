import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomBar } from './BottomBar';

describe('BottomBar', () => {
  it('shows five screens and a More menu with Graph, Triggers and Settings', () => {
    const onGo = vi.fn();
    const onSettings = vi.fn();
    render(<BottomBar active="home" onGo={onGo} onSettings={onSettings} />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect([...nav.querySelectorAll(':scope > button')].map((b) => b.textContent)).toEqual(['Home', 'Runs', 'Builder', 'Crew', 'API', 'More']);
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    const more = screen.getByRole('button', { name: 'More' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Graph', 'Triggers', 'Settings']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Graph' }));
    expect(onGo).toHaveBeenCalledWith('graph');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(onSettings).toHaveBeenCalled();
  });

  it('closes the menu with Escape and marks More while a screen inside it is active', () => {
    render(<BottomBar active="triggers" onGo={() => {}} onSettings={() => {}} />);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more.getAttribute('aria-current')).toBe('page');
    fireEvent.click(more);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('closes when the More icon is tapped again or the pointer goes down outside, but not on a menu item', () => {
    const onGo = vi.fn();
    render(<BottomBar active="home" onGo={onGo} onSettings={() => {}} />);
    const more = screen.getByRole('button', { name: 'More' });
    const icon = more.querySelector('svg')!;
    fireEvent.click(more);
    fireEvent.pointerDown(icon);
    fireEvent.click(icon);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(more);
    const triggers = screen.getByRole('menuitem', { name: 'Triggers' });
    fireEvent.pointerDown(triggers.querySelector('svg')!);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.click(triggers);
    expect(onGo).toHaveBeenCalledWith('triggers');
  });

  it('focuses the first menu item on open and moves through the menu with arrows, Home and End', () => {
    render(<BottomBar active="home" onGo={() => {}} onSettings={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const [graph, triggers, settings] = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(graph);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(triggers);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(settings);
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(graph);
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(settings);
  });
});
