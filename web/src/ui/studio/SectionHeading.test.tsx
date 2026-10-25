import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionHeading } from './SectionHeading';

describe('SectionHeading', () => {
  it('shows the title, a mono count and an action', () => {
    render(<SectionHeading id="h" title="Needs you" count={3} action={<button>See all</button>} />);
    const h = screen.getByRole('heading', { level: 2, name: 'Needs you' });
    expect(h.id).toBe('h');
    expect(screen.getByText('3').className).toContain('sl-count');
    expect(screen.getByRole('button', { name: 'See all' })).toBeTruthy();
  });
  it('shows a zero count but no count when none is given', () => {
    const { rerender, container } = render(<SectionHeading title="Recent" count={0} />);
    expect(screen.getByText('0')).toBeTruthy();
    rerender(<SectionHeading title="Recent" />);
    expect(container.querySelector('.sl-count')).toBeNull();
  });
});
