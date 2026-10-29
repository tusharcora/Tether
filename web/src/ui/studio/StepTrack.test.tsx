import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cssRule } from '../../test/css';
import { segmentsFor, trackLabel } from './steps';
import { StepTrack } from './StepTrack';

describe('StepTrack', () => {
  const steps = [
    { id: 'plan', status: 'done', title: 'Plan' },
    { id: 'code', status: 'running', title: 'Implement' },
    { id: 'ok', status: 'awaiting', title: 'Ship it' },
    { id: 'lint', status: 'skipped' },
    { id: 'gate', status: 'queued' },
    { id: 'rev', status: 'error' },
  ];
  it('maps statuses to segment states; an approval still ahead is a gate', () => {
    expect(segmentsFor(steps).map((s) => s.state)).toEqual(['done', 'working', 'waiting', 'skipped', 'queued', 'failed']);
    expect(segmentsFor([{ id: 'ok', status: 'queued', kind: 'approval' }, { id: 'ok2', status: 'awaiting', kind: 'approval' }]).map((s) => s.state)).toEqual(['gate', 'waiting']);
  });
  it('shows one planning segment for a team run before its plan is approved', () => {
    expect(segmentsFor([], { planning: true })).toEqual([{ id: 'planning', state: 'planning', label: 'planning' }]);
    expect(segmentsFor([])).toEqual([]);
  });
  it('renders a dot per step joined by lines, with an accessible summary', () => {
    const all = [...steps, { id: 'ship', status: 'queued', kind: 'approval' }];
    const { container } = render(<StepTrack steps={all} />);
    expect(trackLabel(segmentsFor(all))).toBe('1 of 7 steps done, 1 working, 1 waiting, 1 failed, 1 asks first');
    expect(screen.getByRole('img', { name: trackLabel(segmentsFor(all)) })).toBeTruthy();
    expect(container.querySelectorAll('.sl-seg')).toHaveLength(7);
    expect(container.querySelectorAll('.sl-link')).toHaveLength(6);
    expect(container.querySelector('.sl-link.done')).toBeTruthy();
    expect(container.querySelector('.sl-seg.s-done')!.textContent).toBe('✓');
    expect(container.querySelector('.sl-seg.s-gate')!.textContent).toBe('◆');
  });
  it('colours by meaning: green done, blue working, amber waiting and gates, the 3:1 edge for queued', () => {
    expect(cssRule('ui/studio/parts.css', '.sl-seg.s-done')).toContain('background: var(--ok)');
    expect(cssRule('ui/studio/parts.css', '.sl-seg.s-working,.sl-seg.s-planning')).toContain('border-color: var(--acc)');
    expect(cssRule('ui/studio/parts.css', '.sl-seg.s-waiting')).toContain('var(--warn)');
    expect(cssRule('ui/studio/parts.css', '.sl-seg.s-gate')).toContain('color: var(--warn)');
    expect(cssRule('ui/studio/parts.css', '.sl-seg')).toContain('border: 2px solid var(--edge)');
  });
});
