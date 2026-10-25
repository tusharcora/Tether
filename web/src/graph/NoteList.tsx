import { useMemo, type KeyboardEvent } from 'react';
import type { VaultGraph } from '../api';
import { cn } from '../ui/cn';
import { SectionHeading } from '../ui/studio/SectionHeading';
import { GLYPH, typeOf, type GraphType } from './graphModel';

export const LIST_MAX = 300;

/** Every note by title: the keyboard path through the vault (↑/↓ between rows, Enter opens). */
export function NoteList(p: { nodes: VaultGraph['nodes']; selected?: string; hiddenTypes: ReadonlySet<GraphType>; onGo: (id: string) => void }) {
  const sorted = useMemo(() => [...p.nodes].sort((a, b) => a.title.localeCompare(b.title)), [p.nodes]);
  const move = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  return (
    <nav className="gv-list" aria-label="All notes">
      <SectionHeading title="All notes" count={p.nodes.length} />
      <ul className="sl-list" onKeyDown={move}>
        {sorted.slice(0, LIST_MAX).map((n) => {
          const t = typeOf(n.type);
          const on = p.selected === n.id;
          return (
            <li key={n.id}>
              <button type="button" className={cn('gv-list-item', { on, off: p.hiddenTypes.has(t) })} aria-current={on ? 'true' : undefined} onClick={() => p.onGo(n.id)}>
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                  <path d={GLYPH[t]} className={cn('gv-glyph', { hollow: t === 'note' })} />
                </svg>
                <span>{n.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {p.nodes.length > LIST_MAX ? (
        <p className="sl-meta">
          Showing the first {LIST_MAX} of {p.nodes.length}. Search to find the rest.
        </p>
      ) : null}
    </nav>
  );
}
