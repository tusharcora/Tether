import { useMemo } from 'react';
import type { VaultGraph } from '../api';
import { DataTable, type Column } from '../components/beui/kit/DataTable';
import { cn } from '../ui/cn';
import { SectionHeading } from '../ui/studio/SectionHeading';
import { GLYPH, typeOf, type GraphType } from './graphModel';

export const LIST_MAX = 300;

type Note = VaultGraph['nodes'][number];

/** Every note by title as a sortable table (title, type): the keyboard path through the vault (↑/↓ between rows, Enter opens). */
export function NoteList(p: { nodes: VaultGraph['nodes']; selected?: string; hiddenTypes: ReadonlySet<GraphType>; onGo: (id: string) => void }) {
  const sorted = useMemo(() => [...p.nodes].sort((a, b) => a.title.localeCompare(b.title)), [p.nodes]);
  const columns = useMemo<Column<Note>[]>(
    () => [
      {
        id: 'title',
        header: 'Note',
        sort: (a, b) => a.title.localeCompare(b.title),
        cell: (n) => {
          const t = typeOf(n.type);
          return (
            <span className={cn('gv-list-item', { off: p.hiddenTypes.has(typeOf(n.type)) })}>
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                <path d={GLYPH[t]} className={cn('gv-glyph', { hollow: t === 'note' })} />
              </svg>
              <span>{n.title}</span>
            </span>
          );
        },
      },
      { id: 'type', header: 'Type', sort: (a, b) => typeOf(a.type).localeCompare(typeOf(b.type)) || a.title.localeCompare(b.title), cell: (n) => <span className={cn('gv-link-kind', { off: p.hiddenTypes.has(typeOf(n.type)) })}>{typeOf(n.type)}</span> },
    ],
    [p.hiddenTypes],
  );
  return (
    <nav className="gv-list" aria-label="All notes">
      <SectionHeading title="All notes" count={p.nodes.length} />
      <DataTable<Note> bare aria-label="Notes" columns={columns} rows={sorted.slice(0, LIST_MAX)} rowKey={(n) => n.id} rowLabel={(n) => n.title} currentKey={p.selected ?? null} onRowClick={(n) => p.onGo(n.id)} />
      {p.nodes.length > LIST_MAX ? (
        <p className="sl-meta">
          Showing the first {LIST_MAX} of {p.nodes.length}. Search to find the rest.
        </p>
      ) : null}
    </nav>
  );
}
