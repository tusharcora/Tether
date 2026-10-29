import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ActionNode, DOT, fanSpots, ride } from './ActionNode';

// Read from disk: vitest blanks CSS imports. The base goes through a variable so Vite leaves the URL alone.
const here = import.meta.url;

describe('the action node fan', () => {
  it('rides the card outline: along the top edge, round the corner, down the right edge, always the same distance out', () => {
    const corner = 12, off = 22;
    // left of the corner arc: straight along the top edge, `off` above it
    expect(ride(-30, corner, off)).toMatchObject({ x: -corner - 30, y: -off, nx: 0, ny: -1 });
    // past the arc: down the right edge, `off` to its right
    const len = ((corner + off) * Math.PI) / 2;
    expect(ride(len + 30, corner, off)).toMatchObject({ x: off, y: corner + 30, nx: 1, ny: 0 });
    // on the arc: exactly corner + off from the arc's centre
    const p = ride(len / 2, corner, off);
    expect(Math.hypot(p.x + corner, p.y - corner)).toBeCloseTo(corner + off, 5);
  });

  it('spreads the buttons a button and a gap apart, symmetrically about the corner', () => {
    const spots = fanSpots(4, 12);
    expect(spots).toHaveLength(4);
    for (let i = 1; i < spots.length; i++) expect(Math.hypot(spots[i]!.x - spots[i - 1]!.x, spots[i]!.y - spots[i - 1]!.y)).toBeGreaterThan(DOT);
    // the first button is over the top edge, the last beside the right edge
    expect(spots[0]!.y).toBeLessThan(0);
    expect(spots[3]!.x).toBeGreaterThan(0);
  });

  it('is a toolbar of named buttons that run their action without leaking the click, and skips disabled ones with the arrows', () => {
    const run = vi.fn(), del = vi.fn(), outer = vi.fn();
    render(
      <div onClick={outer}>
        <ActionNode
          label="Step actions"
          tabbable
          actions={[
            { id: 'a', label: 'Run from here', icon: <i />, onSelect: run },
            { id: 'b', label: 'Edit step', icon: <i />, onSelect: () => {}, disabled: true },
            { id: 'c', label: 'Delete step', icon: <i />, danger: true, onSelect: del },
          ]}
        >
          <p>card</p>
        </ActionNode>
      </div>,
    );
    const bar = screen.getByRole('toolbar', { name: 'Step actions' });
    expect(bar.querySelectorAll('button').length).toBe(3);
    const first = screen.getByRole('button', { name: 'Run from here' });
    first.focus();
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete step' }));
    fireEvent.click(document.activeElement!);
    expect(del).toHaveBeenCalledTimes(1);
    fireEvent.click(first);
    expect(run).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Edit step' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the compact variant is a 16 px corner card with a mark, a title, a line and a named status dot', () => {
    render(<ActionNode compact tone="needs" toneLabel="Needs you" mark={<i />} title="Next run" line="Fix it" actions={[{ id: 'a', label: 'Duplicate', icon: <i />, onSelect: () => {} }]} />);
    expect(screen.getByRole('img', { name: 'Needs you' }).className).toContain('t-needs');
    expect(screen.getByText('Next run')).toBeTruthy();
    expect(screen.getByRole('toolbar').parentElement!.style.borderRadius).toBe('16px');
    expect(readFileSync(new URL('./ActionNode.css', here), 'utf8')).toMatch(/\.nod-compact \{ width: 300px/);
  });

  it('opens on hover, focus and the host flag, folds in reverse order, and draws opaque buttons from tokens', () => {
    const css = readFileSync(new URL('./ActionNode.css', here), 'utf8');
    expect(css).toMatch(/\.nod-host:hover > \.nod-fan > \.nod-act/);
    expect(css).toMatch(/\.nod-host:focus-within > \.nod-fan > \.nod-act/);
    expect(css).toMatch(/\.nod-host\[data-fan-open\] > \.nod-fan > \.nod-act/);
    // forgiving: folding waits 350 ms after the pointer leaves, then runs last out first back; opening waits for nothing
    expect(css).toMatch(/calc\(350ms \+ \(var\(--n\) - 1 - var\(--i\)\) \* 24ms\)/);
    // the pocket over the fan's area lingers as long, so a hand that slips off on the way to a button keeps the fan
    expect(css).toMatch(/\.nod-pad \{[^}]*visibility: hidden;[^}]*transition: visibility 0s linear 350ms/);
    // a fan folded into a list row keeps closing at once
    expect(css).toMatch(/\.nod-fan\.inset > \.nod-pad \{[^}]*transition: none/);
    expect(css).toContain('background: var(--s1)');
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  it('lg size renders 40px buttons on a wider fan with an invisible hit ring', () => {
    render(<ActionNode size="lg" label="Goal actions" actions={['Copy link', 'Add a step', 'Duplicate', 'Settings'].map((l) => ({ id: l, label: l, icon: <i />, onSelect: () => {} }))} />);
    const bar = screen.getByRole('toolbar', { name: 'Goal actions' });
    expect(bar.className).toContain('lg');
    const at = [...bar.querySelectorAll<HTMLButtonElement>('button')].map((b) => ({ x: parseFloat(b.style.getPropertyValue('--x')), y: parseFloat(b.style.getPropertyValue('--y')) }));
    for (let i = 1; i < at.length; i++) expect(Math.hypot(at[i]!.x - at[i - 1]!.x, at[i]!.y - at[i - 1]!.y)).toBeGreaterThan(40);
    const css = readFileSync(new URL('./ActionNode.css', here), 'utf8');
    expect(css).toMatch(/\.nod-fan\.lg > \.nod-act \{[^}]*width: 40px; height: 40px/);
    expect(css).toMatch(/\.nod-fan\.lg > \.nod-act::before \{[^}]*inset: -8px/);
  });

  it('fan buttons have accessible labels and are reachable by Tab when tabbable', () => {
    const acts = ['Copy link', 'Settings'].map((l) => ({ id: l, label: l, icon: <i />, onSelect: () => {} }));
    const { rerender } = render(<ActionNode size="lg" tabbable label="Goal actions" actions={acts} />);
    for (const b of screen.getByRole('toolbar', { name: 'Goal actions' }).querySelectorAll('button')) {
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.tabIndex).toBe(0);
    }
    rerender(<ActionNode size="lg" label="Goal actions" actions={acts} />);
    for (const b of screen.getByRole('toolbar', { name: 'Goal actions' }).querySelectorAll('button')) expect(b.tabIndex).toBe(-1);
  });
});
