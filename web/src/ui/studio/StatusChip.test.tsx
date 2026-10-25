import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cssRule } from '../../test/css';
import { StatusChip, toneFor } from './StatusChip';

describe('StatusChip', () => {
  it('maps run and step statuses to meaning colours', () => {
    expect(toneFor('running')).toBe('live');
    expect(toneFor('awaiting')).toBe('needs');
    expect(toneFor('paused')).toBe('needs');
    expect(toneFor('done')).toBe('done');
    expect(toneFor('error')).toBe('failed');
    expect(toneFor('stopped')).toBe('neutral');
    expect(toneFor(undefined)).toBe('neutral');
  });
  it('always pairs the colour with its text, and pulses only when asked', () => {
    const { container, rerender } = render(<StatusChip tone="live" label="running" pulse />);
    expect(screen.getByText('running').closest('.sl-chip')!.className).toContain('t-live');
    expect(container.querySelector('.sl-dot.pulse')).toBeTruthy();
    rerender(<StatusChip tone="done" label="done" />);
    expect(container.querySelector('.sl-dot.pulse')).toBeNull();
    expect(container.querySelector('.sl-dot')!.getAttribute('aria-hidden')).toBe('true');
  });
  it('writes live text in the accent ink, never the fill colour', () => {
    expect(cssRule('ui/studio/parts.css', '.sl-chip.t-live')).toContain('color: var(--accInk)');
    expect(cssRule('ui/studio/parts.css', '.sl-dot.pulse')).toMatch(/animation: sl-pulse [\d.]+s var\(--ease\) infinite/);
  });
});
