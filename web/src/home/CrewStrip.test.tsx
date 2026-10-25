import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeRow } from '../test/fixtures';
import { CrewStrip } from './CrewStrip';

describe('Crew strip', () => {
  it('breathes the bots of running steps in live runs and dims the rest', () => {
    const runs = [makeRow({ live: true, steps: [{ id: 'code', status: 'running', bot: 'coder' }, { id: 'rev', status: 'queued', bot: 'reviewer' }] }), makeRow({ id: 'r2', live: false, status: 'running', steps: [{ id: 'p', status: 'running', bot: 'planner' }] })];
    const { container } = render(<CrewStrip runs={runs} />);
    expect(screen.getByRole('region', { name: 'Crew' })).toBeTruthy();
    const bolt = screen.getByRole('img', { name: 'Bolt, busy' });
    expect(bolt.getAttribute('data-mood')).toBe('working');
    expect(bolt.closest('li')!.className).not.toContain('idle');
    expect(screen.getByRole('img', { name: 'Scout' }).closest('li')!.className).toContain('idle');
    expect(container.querySelectorAll('li.crew-face:not(.idle)')).toHaveLength(1);
    expect(screen.getByText('Lens')).toBeTruthy();
  });
});
