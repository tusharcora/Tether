import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cssRule } from '../../test/css';
import { Disclosure, QuietLine, RowList, Section, Tag } from './Section';

describe('Section primitives', () => {
  it('labels a section with its count and an optional live dot', () => {
    render(<Section title="Needs you" count={2} live><RowList label="Needs you"><li>x</li></RowList></Section>);
    const region = screen.getByRole('region', { name: /Needs you/ });
    expect(region.querySelector('.sl-sec-count')!.textContent).toBe('2');
    expect(region.querySelector('.sl-sec .sl-dot.pulse')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Needs you' }).className).toContain('sl-rows');
  });
  it('shows an empty section as one quiet line', () => {
    render(<QuietLine>Nothing needs you.</QuietLine>);
    expect(screen.getByText('Nothing needs you.').className).toBe('sl-quiet');
  });
  it('tags with a small muted label', () => {
    render(<Tag title="Evolve probe replay">probe</Tag>);
    expect(screen.getByText('probe').className).toBe('sl-tag');
    expect(screen.getByText('probe').getAttribute('title')).toBe('Evolve probe replay');
  });
  it('keeps a disclosure collapsed until clicked', () => {
    render(<Disclosure label="Planning" meta="5 answers"><p>inside</p></Disclosure>);
    const b = screen.getByRole('button', { name: /Planning · 5 answers/ });
    expect(b.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(b);
    expect(b.getAttribute('aria-expanded')).toBe('true');
  });
  it('draws boxed lists with hairline rows', () => {
    expect(cssRule('ui/studio/parts.css', '.sl-rows')).toContain('border: 1px solid var(--line)');
    expect(cssRule('ui/studio/parts.css', '.sl-rows > .sl-row')).toContain('padding: 11px 14px');
    expect(cssRule('ui/studio/parts.css', '.sl-sec')).toContain('font-size: 12px');
  });
});
