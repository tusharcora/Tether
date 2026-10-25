import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cssRule, cssText } from '../../test/css';
import { ListRow } from './ListRow';

describe('ListRow', () => {
  it('lays out lead, title, meta, extra, age and actions in a list item', () => {
    render(
      <ul>
        <ListRow lead={<span>L</span>} title="Fix login" meta="r1 · aorch/r1" extra={<div>track</div>} age="2m ago" actions={<button>Open</button>} />
      </ul>,
    );
    const li = screen.getByRole('listitem');
    expect(li.className).toContain('sl-row');
    for (const t of ['L', 'Fix login', 'r1 · aorch/r1', 'track', '2m ago']) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });
  it('makes the title a button when the row opens something', () => {
    const onOpen = vi.fn();
    render(<ul><ListRow title="Team run" onOpen={onOpen} /></ul>);
    fireEvent.click(screen.getByRole('button', { name: 'Team run' }));
    expect(onOpen).toHaveBeenCalled();
  });
  it('keeps the lead cell in rows without a lead, so titles line up', () => {
    render(
      <ul>
        <ListRow lead={<span>face</span>} title="With a face" />
        <ListRow title="Without one" />
      </ul>,
    );
    const [withLead, without] = screen.getAllByRole('listitem');
    for (const li of [withLead!, without!]) {
      expect(li.children[0]!.className).toBe('sl-row-lead');
      expect(li.children[1]!.className).toBe('sl-row-main');
    }
    // every cell sits in a named grid area behind a fixed lead column, and an empty lead is never collapsed
    const row = cssRule('ui/studio/parts.css', '.sl-row');
    expect(row).toContain('grid-template-columns: var(--row-lead,24px) minmax(0,1fr) auto');
    expect(row).toContain("grid-template-areas: 'lead main side' '. extra extra'");
    for (const [sel, area] of [['.sl-row-lead', 'lead'], ['.sl-row-main', 'main'], ['.sl-row-side', 'side'], ['.sl-row-extra', 'extra']] as const)
      expect(cssRule('ui/studio/parts.css', sel)).toContain(`grid-area: ${area}`);
    expect(cssText('ui/studio/parts.css')).not.toContain('.sl-row-lead:empty');
  });
});
