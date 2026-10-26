import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteReader } from './NoteReader';

const base = { state: 'idle' as const, missing: false, fresh: false, links: [], onTag: () => {}, onGo: () => {}, onHover: () => {}, onRetry: () => {} };
const note = (path: string, type: string) => ({ path, title: path, type, tags: [], body: '', links: [], backlinks: [] });

describe('NoteReader', () => {
  it('opens a file note’s file in Code, and offers nothing for other notes', () => {
    const onOpenFile = vi.fn();
    const { rerender } = render(<NoteReader {...base} path="Files/src/http/limit.ts.md" note={note('Files/src/http/limit.ts.md', 'file')} onOpenFile={onOpenFile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Code' }));
    expect(onOpenFile).toHaveBeenCalledWith('src/http/limit.ts');
    rerender(<NoteReader {...base} path="Roles/coder.md" note={note('Roles/coder.md', 'role')} onOpenFile={onOpenFile} />);
    expect(screen.queryByRole('button', { name: 'Open in Code' })).toBeNull();
  });
});
