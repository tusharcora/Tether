import type { ReactNode } from 'react';
import { cn } from '../cn';
import './parts.css';

export interface ListRowProps {
  lead?: ReactNode;
  title: ReactNode;
  /** The title becomes a button that opens the row's subject. */
  onOpen?: () => void;
  meta?: ReactNode;
  /** A full-width line under the title (a step track, a "what's happening now" line). */
  extra?: ReactNode;
  age?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * A hairline row: leading marker or face, title and mono meta, trailing age and actions. Lives in a `.sl-list`.
 * The lead cell is always rendered (fixed width, `--row-lead`), so rows with and without a lead line up.
 */
export function ListRow(p: ListRowProps) {
  return (
    <li className={cn('sl-row', p.className)}>
      <div className="sl-row-lead">{p.lead}</div>
      <div className="sl-row-main">
        {p.onOpen ? (
          <button type="button" className="sl-row-title" onClick={p.onOpen}>
            {p.title}
          </button>
        ) : (
          <span className="sl-row-title">{p.title}</span>
        )}
        {p.meta ? <span className="sl-row-meta">{p.meta}</span> : null}
      </div>
      <div className="sl-row-side">
        {p.age ? <span className="sl-age">{p.age}</span> : null}
        {p.actions}
      </div>
      {p.extra ? <div className="sl-row-extra">{p.extra}</div> : null}
    </li>
  );
}
