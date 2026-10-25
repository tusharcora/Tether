import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel } from './Panel';

describe('Panel', () => {
  it('is a region named by its heading', () => {
    render(<Panel title="Running" count={2} className="s-running"><p>body</p></Panel>);
    const region = screen.getByRole('region', { name: 'Running' });
    expect(region.className).toContain('sl-panel');
    expect(region.className).toContain('s-running');
    expect(screen.getByText('body')).toBeTruthy();
  });
  it('can have no header', () => {
    const { container } = render(<Panel><p>plain</p></Panel>);
    expect(container.querySelector('h2')).toBeNull();
    expect(screen.getByText('plain')).toBeTruthy();
  });
});
