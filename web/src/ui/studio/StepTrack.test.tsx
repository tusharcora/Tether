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
  it('maps statuses to segment states', () => {
    expect(segmentsFor(steps).map((s) => s.state)).toEqual(['done', 'working', 'waiting', 'skipped', 'queued', 'failed']);
  });
  it('shows one planning segment for a team run before its plan is approved', () => {
    expect(segmentsFor([], { planning: true })).toEqual([{ id: 'planning', state: 'planning', label: 'planning' }]);
    expect(segmentsFor([])).toEqual([]);
  });
  it('renders segments with an accessible summary', () => {
    const { container } = render(<StepTrack steps={steps} />);
    expect(screen.getByRole('img', { name: trackLabel(segmentsFor(steps)) })).toBeTruthy();
    expect(trackLabel(segmentsFor(steps))).toBe('1 of 6 steps done, 1 working, 1 waiting, 1 failed');
    expect(container.querySelectorAll('.sl-seg')).toHaveLength(6);
    expect(container.querySelector('.sl-seg.s-working')).toBeTruthy();
    expect(container.querySelector('.sl-seg.s-skipped')).toBeTruthy();
  });
  it('draws queued and skipped steps in the 3:1 edge colour so they stay visible', () => {
    expect(cssRule('ui/studio/parts.css', '.sl-seg.s-queued')).toContain('background: var(--edge)');
    expect(cssRule('ui/studio/parts.css', '.sl-seg.s-skipped')).toContain('background: var(--edge)');
  });
  it('moves the working stripes through a mask, never a gradient fill', () => {
    const stripes = cssRule('ui/studio/parts.css', '.sl-seg.s-working::after,.sl-seg.s-planning::after');
    expect(stripes).toContain('background: var(--acc)');
    expect(stripes).toContain('mask-image: repeating-linear-gradient');
    expect(stripes).not.toMatch(/background[\w-]*: [^;]*gradient/);
  });
});
