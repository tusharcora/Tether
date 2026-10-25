import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cssRule } from '../../test/css';
import { FaceStack } from './FaceStack';

describe('FaceStack', () => {
  it('overlaps faces with names and breathes only the working bot', () => {
    const { container } = render(<FaceStack bots={['planner', 'coder', 'reviewer']} working="coder" />);
    expect(screen.getByRole('img', { name: 'Bolt' }).getAttribute('data-mood')).toBe('working');
    expect(screen.getByRole('img', { name: 'Scout' }).getAttribute('data-mood')).toBe('idle');
    // only the working face is the animated (span) form
    expect(container.querySelectorAll('span.face')).toHaveLength(1);
  });
  it('folds faces past the maximum into a count', () => {
    render(<FaceStack bots={['planner', 'coder', 'reviewer', 'architect']} max={2} />);
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByLabelText('and 2 more')).toBeTruthy();
  });
  it('keeps the working bot visible when it sits past the maximum', () => {
    const { container } = render(<FaceStack bots={['planner', 'architect', 'reviewer', 'coder']} working="coder" max={2} />);
    expect(screen.getByRole('img', { name: 'Bolt' }).getAttribute('data-mood')).toBe('working');
    expect(screen.getByRole('img', { name: 'Scout' })).toBeTruthy();
    expect(container.querySelectorAll('.face')).toHaveLength(2);
    expect(screen.getByLabelText('and 2 more')).toBeTruthy();
  });
  it('draws a bot listed twice once', () => {
    const { container } = render(<FaceStack bots={['coder', 'coder', 'planner']} />);
    expect(container.querySelectorAll('.face')).toHaveLength(2);
  });
  it('draws nothing for no bots', () => {
    const { container } = render(<FaceStack bots={[]} />);
    expect(container.firstChild).toBeNull();
  });
  it('rings each face with the 3:1 edge colour, not the decorative hairline', () => {
    const ring = cssRule('ui/studio/parts.css', '.sl-facestack > .face');
    expect(ring).toContain('box-shadow: 0 0 0 1px var(--edge),0 0 0 3px var(--s1)');
    expect(ring).not.toContain('--line2');
  });
});
