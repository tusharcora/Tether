import { ChevronRight, Ellipsis, type LucideIcon } from 'lucide-react';
import { useId, useState, type DragEvent, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { Loading } from '../../components/Loading';
import { cn } from '../cn';
import { InlineError } from './InlineError';
import './shell.css';
import { useMenu } from './useMenu';

export type Signal = 'needs' | 'live';

/** What a rail control spreads on itself so the collapsed sidebar can show its label as a tooltip. */
export interface TipProps {
  onPointerEnter: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  'aria-describedby'?: string;
}

/**
 * One dense sidebar row (28 px, 13 px text): a line icon (or a glyph), the label, and on the right a count, a meta or a
 * shortcut hint that shows on hover. The current page is a filled row with aria-current="page". On the collapsed rail only
 * the icon shows: the label moves to the tooltip (the button keeps it as its name) and a count becomes a small dot.
 */
export function SideRow(p: {
  label: string;
  /** The button's accessible name when it should say more than the label (a run's state). */
  name?: string;
  Icon?: LucideIcon;
  lead?: ReactNode;
  current?: boolean;
  /** The row is a page (top items, Workspace, Settings): aria-current="page" when current. */
  page?: boolean;
  count?: { n: number; tone?: Signal };
  meta?: ReactNode;
  /** Shown on hover and focus only (Linear's `G C`). */
  hint?: ReactNode;
  onClick: () => void;
  /** Extra controls on the row's right (a pin's ⋯), outside the button. */
  extra?: ReactNode;
  className?: string;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: () => void;
  /** Drawn on the collapsed rail, with this tooltip wiring. */
  rail?: TipProps;
}) {
  const count = p.count && p.count.n > 0 ? p.count : undefined;
  return (
    <div className={cn('sl-side-row', p.className, { current: !!p.current })} draggable={p.draggable} onDragStart={p.onDragStart} onDragOver={p.onDragOver} onDrop={p.onDrop}>
      <button type="button" className="sl-side-item" aria-label={p.name ?? p.label} aria-current={p.page && p.current ? 'page' : undefined} onClick={p.onClick} {...p.rail}>
        <span className="sl-side-icon" aria-hidden={p.lead ? undefined : true}>
          {p.lead ?? (p.Icon ? <p.Icon size={16} strokeWidth={1.7} aria-hidden="true" /> : null)}
        </span>
        {p.rail ? null : <span className="sl-side-label">{p.label}</span>}
        {!p.rail && p.meta ? <span className="sl-side-meta">{p.meta}</span> : null}
        {!p.rail && count ? <span className={cn('sl-side-count', count.tone)}>{count.n}</span> : null}
        {!p.rail && p.hint ? <span className="sl-side-hint">{p.hint}</span> : null}
        {p.rail && count ? <span className={cn('sl-side-dot', count.tone)} aria-hidden="true" /> : null}
      </button>
      {p.rail ? null : p.extra}
    </div>
  );
}

export interface MenuItem {
  label: string;
  onPick: () => void;
  disabled?: boolean;
}

/** A ⋯ (or other) button and its popup menu. */
export function SideMenu(p: { label: string; items: MenuItem[]; icon?: ReactNode; className?: string }) {
  const menu = useMenu();
  return (
    <span className={cn('sl-side-menu-anchor', p.className)}>
      <button ref={menu.triggerRef} type="button" className="sl-side-icon-btn" aria-label={p.label} title={p.label} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
        {p.icon ?? <Ellipsis size={15} aria-hidden="true" />}
      </button>
      {menu.open ? (
        <div ref={menu.menuRef} className="sl-menu sl-side-menu" role="menu" aria-label={p.label} onKeyDown={menu.onMenuKey}>
          {p.items.map((it) => (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled} onClick={() => (menu.close(), it.onPick())}>
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

const FOLD_KEY = (id: string) => `tether.side.${id}`;
function storedFolded(id: string): boolean {
  try {
    return localStorage.getItem(FOLD_KEY(id)) === 'folded';
  } catch {
    return false;
  }
}

/**
 * A sidebar section (Workspace, Runs, Favorites): its header is a disclosure button that folds the rows, remembered on
 * this device. Hover shows the header's actions (＋, View all) like Linear. Until its list first answers it shows the
 * loading skeleton; a failed first load says so with a retry, never "nothing here".
 */
export function SideSection(p: {
  id: string;
  title: string;
  /** The disclosure's accessible name when the title alone would repeat a nav row's (Runs → "Recent runs"). */
  label?: string;
  count?: number;
  actions?: ReactNode;
  empty?: string;
  loading?: boolean;
  error?: { message: string; onRetry: () => void };
  children: ReactNode[];
}) {
  const [folded, setFolded] = useState(() => storedFolded(p.id));
  const headId = useId();
  const fold = () => {
    setFolded(!folded);
    try {
      localStorage.setItem(FOLD_KEY(p.id), folded ? 'open' : 'folded');
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <section className="sl-side-section" aria-labelledby={headId}>
      <div className="sl-side-section-head">
        <button type="button" id={headId} className="sl-side-disclosure" aria-label={p.label} aria-expanded={!folded} onClick={fold}>
          <span className="sl-side-section-title">{p.title}</span>
          <ChevronRight className="sl-side-chevron" size={12} strokeWidth={2} aria-hidden="true" />
        </button>
        {p.actions ? <span className="sl-side-section-actions">{p.actions}</span> : null}
        {p.count !== undefined && p.count > 0 ? <span className="sl-side-section-count">{p.count}</span> : null}
      </div>
      {folded ? null : (
        <div className="sl-side-rows">
          {p.children.length ? (
            p.children
          ) : p.loading ? (
            <Loading loading lines={2} label={`Loading ${p.title.toLowerCase()}`} className="sl-side-empty" />
          ) : p.error ? (
            <InlineError compact message={p.error.message} onRetry={p.error.onRetry} />
          ) : p.empty ? (
            <p className="sl-side-empty">{p.empty}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
