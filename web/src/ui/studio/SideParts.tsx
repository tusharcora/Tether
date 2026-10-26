import { ChevronRight, Ellipsis, Plus, type LucideIcon } from 'lucide-react';
import { useId, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '../cn';
import './shell.css';
import { useMenu } from './useMenu';

/** What a sidebar control spreads on itself so the collapsed sidebar can show its label as a tooltip. */
export interface TipProps {
  onPointerEnter: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  'aria-describedby'?: string;
}

export type Signal = 'needs' | 'live';

/**
 * One sidebar row: icon and label, the current one as a card. Expanded it shows its meta or count; collapsed, a dot
 * stands in for the count and the label lives in the tooltip (the button keeps it as its name either way).
 */
export function SideItem(p: {
  label: string;
  Icon: LucideIcon;
  open: boolean;
  current?: boolean;
  /** The row is the page being shown (nav tabs): aria-current="page". */
  page?: boolean;
  meta?: ReactNode;
  count?: { n: number; tone: Signal };
  /** A live dot (a project with a run going). */
  live?: boolean;
  small?: boolean;
  onClick: () => void;
  tip: TipProps;
}) {
  const count = p.count && p.count.n > 0 ? p.count : undefined;
  return (
    <button
      type="button"
      className={cn('sl-side-item', { current: !!p.current, small: !!p.small })}
      aria-label={p.label}
      aria-current={p.page && p.current ? 'page' : undefined}
      onClick={p.onClick}
      {...p.tip}
    >
      <p.Icon size={p.small ? 18 : 19} strokeWidth={1.8} aria-hidden="true" />
      {p.open ? <span className="sl-side-label">{p.label}</span> : null}
      {p.open && p.meta ? <span className="sl-side-meta">{p.meta}</span> : null}
      {p.open && count ? <span className={cn('sl-side-count', count.tone)}>{count.n}</span> : null}
      {!p.open && count ? <span className={cn('sl-side-dot', count.tone)} aria-hidden="true" /> : null}
      {p.live ? <span className="sl-side-live" aria-hidden="true" /> : null}
    </button>
  );
}

export interface MenuItem {
  label: string;
  onPick: () => void;
  disabled?: boolean;
}

/** A section's ⋯ button and its menu. */
function SideMenu(p: { label: string; items: MenuItem[] }) {
  const menu = useMenu();
  return (
    <span className="sl-side-menu-anchor">
      <button ref={menu.triggerRef} type="button" className="sl-side-icon-btn" aria-label={p.label} title={p.label} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
        <Ellipsis size={15} aria-hidden="true" />
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

/**
 * A collapsible sidebar section (Projects, Pinned): a disclosure button with a chevron, + and ⋯. Collapsed, the header
 * goes and the rows stay as icons whether or not the section is folded.
 */
export function SideSection(p: { title: string; open: boolean; addLabel: string; addDisabled?: boolean; onAdd: () => void; moreLabel: string; menu: MenuItem[]; empty: string; children: ReactNode[] }) {
  const [expanded, setExpanded] = useState(true);
  const id = useId();
  const show = expanded || !p.open;
  return (
    <section className="sl-side-section" aria-labelledby={p.open ? id : undefined} aria-label={p.open ? undefined : p.title}>
      {p.open ? (
        <div className="sl-side-section-head">
          <button type="button" id={id} className="sl-side-disclosure" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            <ChevronRight className="sl-side-chevron" size={14} strokeWidth={2} aria-hidden="true" />
            {p.title}
          </button>
          <button type="button" className="sl-side-icon-btn" aria-label={p.addLabel} title={p.addLabel} disabled={p.addDisabled} onClick={p.onAdd}>
            <Plus size={16} aria-hidden="true" />
          </button>
          <SideMenu label={p.moreLabel} items={p.menu} />
        </div>
      ) : null}
      {show ? (
        <div className="sl-side-rows">
          {p.children.length ? p.children : p.open ? <p className="sl-side-empty">{p.empty}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
