import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cssRule } from '../../test/css';
import { StatusBadge, StatusGlyph, toneFor } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders a descriptor as a beui badge with its state', () => {
    const { container } = render(<StatusBadge desc={{ of: 'step', status: 'running', kind: 'gate', attempts: 1 }} />);
    const b = container.querySelector('.sl-badge')!;
    expect(b.getAttribute('data-status')).toBe('loading');
    expect(b.textContent).toContain('testing');
    // ui/studio is not a Tailwind source (tw.css), so the accent override is plain CSS
    expect(cssRule('ui/studio/parts.css', '.sl-badge[data-status="loading"]')).toContain('background: var(--accBg)');
    expect(cssRule('ui/studio/parts.css', '.sl-badge[data-status="loading"]')).toContain('color: var(--accInk)');
  });
  it('renders a plain tone label without an icon', () => {
    const { container } = render(<StatusBadge tone="needs" label="agent not available" />);
    expect(container.querySelector('[data-status="warning"]')!.textContent).toBe('agent not available');
    expect(container.querySelector('[data-badge-icon]')).toBeNull();
  });
  it('draws a red cross for a failed run, never a ring', () => {
    render(<StatusGlyph desc={{ of: 'run', status: 'error', live: false, waiting: false }} />);
    expect(screen.getByRole('img', { name: 'Failed' })).toBeTruthy();
  });
  it('keeps toneFor', () => expect(toneFor('error')).toBe('failed'));
});
