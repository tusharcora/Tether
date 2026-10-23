import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { applyCrew, type BotDef } from './crewStore';
import { Face } from './Face';

const look = { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: '#3fb97c', accent: 'auto' };
const coder: BotDef = { id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: '', look, pixels: { grid: ['#.', '.#'], colors: { '#': '#3fb97c' } }, mark: { shape: 'bolt', symbol: 'BLT', initials: 'BO' } };

it('draws the pixel look in the pebble style', () => {
  applyCrew([coder], { style: 'pebble' });
  const { container } = render(<Face role="coder" size={40} />);
  expect(screen.getByRole('img', { name: 'Bolt' })).toBeTruthy();
  expect(container.querySelectorAll('rect')).toHaveLength(2);
});

it('draws initials in the orbit style', () => {
  applyCrew([coder], { style: 'orbit' });
  render(<Face role="coder" />);
  expect(screen.getByRole('img', { name: 'Bolt' }).textContent).toContain('BO');
});

it('falls back to the coder for an unknown role', () => {
  applyCrew([coder], { style: 'pebble' });
  render(<Face role="nobody" />);
  expect(screen.getByRole('img', { name: 'Bolt' })).toBeTruthy();
});
