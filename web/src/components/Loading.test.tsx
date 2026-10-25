import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Loading } from './Loading';

const motion = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));

describe('Loading', () => {
  it('shows a dithered skeleton inside the reveal while loading, then the content', () => {
    motion(false);
    const { container, rerender } = render(<Loading loading lines={3}><p>done</p></Loading>);
    expect(container.querySelector('[data-ascii-reveal]')!.getAttribute('data-loading')).toBe('true');
    const sk = container.querySelector('[data-ascii-skeleton]')!;
    expect(sk.getAttribute('data-variant')).toBe('dither');
    expect(sk.getAttribute('data-animate')).toBe('true');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByText('done')).toBeNull();
    rerender(<Loading loading={false} lines={3}><p>done</p></Loading>);
    expect(screen.getByText('done')).toBeTruthy();
    expect(container.querySelector('[data-ascii-reveal]')!.getAttribute('data-loading')).toBe('false');
  });

  it('under reduced motion: a still skeleton, no reveal, content at once', () => {
    motion(true);
    const { container, rerender } = render(<Loading loading rows={6}><p>done</p></Loading>);
    expect(container.querySelector('[data-ascii-reveal]')).toBeNull();
    expect(container.querySelector('[data-ascii-skeleton]')!.getAttribute('data-animate')).toBe('false');
    rerender(<Loading loading={false} rows={6}><p>done</p></Loading>);
    expect(screen.getByText('done')).toBeTruthy();
  });
});
