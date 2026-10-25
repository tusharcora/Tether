import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScreenHeader } from './ScreenHeader';

describe('ScreenHeader', () => {
  it('shows the meta line, the title as the page heading, the summary and the actions', () => {
    render(<ScreenHeader meta="2 running · 1 needs you" title="Home" summary="What is going on" actions={<button>Refresh</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
    expect(screen.getByText('2 running · 1 needs you').className).toContain('sl-meta');
    expect(screen.getByText('What is going on')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });
  it('leaves out what is not given', () => {
    const { container } = render(<ScreenHeader title="Runs" />);
    expect(container.querySelector('.sl-meta')).toBeNull();
    expect(container.querySelector('.sl-actions')).toBeNull();
  });
});
