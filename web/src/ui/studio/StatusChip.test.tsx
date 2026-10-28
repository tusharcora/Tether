import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
    expect(screen.getByText('running').closest('[data-status]')!.getAttribute('data-status')).toBe('loading');
    expect(container.querySelector('.sl-badge .bg-current')).toBeTruthy();
    rerender(<StatusChip tone="live" label="running" />);
    expect(container.querySelector('.sl-badge .bg-current')).toBeNull();
  });
});
