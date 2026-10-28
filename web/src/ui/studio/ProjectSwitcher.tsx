import { Check, ChevronDown, PanelLeftOpen } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { WorkspaceRow } from '../../home/workspaces';
import { cn } from '../cn';
import { Glyph } from './Glyph';
import { InlineError } from './InlineError';
import { Kbd } from './Kbd';
import type { TipProps } from './SideParts';
import './shell.css';
import { useMenu } from './useMenu';

/** The project tile's letters: the first letters of the first two words, or the first two letters of one word. */
export const tileLetters = (name: string): string => {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  return ((words.length > 1 ? words[0]![0]! + words[1]![0]! : name.slice(0, 2)) || '?').toUpperCase();
};

export interface ProjectsProps {
  list: WorkspaceRow[];
  current?: string;
  live: ReadonlySet<string>;
  /** The list has not answered yet. */
  loading?: boolean;
  /** The first load failed (nothing to show). */
  error?: { message: string; onRetry: () => void };
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (w: WorkspaceRow) => void;
  /** Tether.app: show the folder in the Finder. */
  onReveal?: (w: WorkspaceRow) => void;
}

/**
 * The sidebar's team-style switcher: the Tether glyph (on a transparent ground: blue is for live state only) and the
 * current project's name. Its menu lists the projects with small neutral initials (a blue dot on one with a live run), then
 * Open folder… ⌘O, Reveal in Finder (Tether.app) and Remove from Tether. On the collapsed rail the glyph stays exactly where
 * it was and becomes the expand control: the expand icon shows on hover or focus, and a click opens the sidebar.
 */
export function ProjectSwitcher(p: ProjectsProps & { collapsed?: boolean; onExpand?: () => void; rail?: TipProps }) {
  const menu = useMenu();
  const current = p.list.find((w) => w.id === p.current);
  const name = current?.name ?? (p.loading ? 'Loading…' : 'No project');
  const closeMenu = useRef(menu.close);
  closeMenu.current = menu.close;
  useEffect(() => {
    if (p.collapsed) closeMenu.current();
  }, [p.collapsed]);
  if (p.error && !p.list.length && !p.collapsed) return <InlineError compact message={p.error.message} onRetry={p.error.onRetry} />;
  return (
    <span className="sl-switch-anchor">
      <button
        ref={menu.triggerRef}
        type="button"
        className="sl-switch"
        aria-label={p.collapsed ? 'Expand sidebar' : `Project: ${name}`}
        aria-haspopup={p.collapsed ? undefined : 'menu'}
        aria-expanded={p.collapsed ? undefined : menu.open}
        onClick={p.collapsed ? p.onExpand : menu.toggle}
        {...(p.collapsed ? p.rail : undefined)}
      >
        <span className="sl-switch-glyph">
          <Glyph size={20} />
          <PanelLeftOpen className="sl-switch-expand" size={16} strokeWidth={1.7} aria-hidden="true" />
        </span>
        <span className="sl-switch-name">{name}</span>
        <ChevronDown className="sl-switch-chev" size={13} strokeWidth={2} aria-hidden="true" />
      </button>
      {menu.open && !p.collapsed ? (
        <div ref={menu.menuRef} className="sl-menu sl-switch-menu" role="menu" aria-label="Projects" onKeyDown={menu.onMenuKey}>
          {p.loading && !p.list.length ? (
            <p className="sl-side-empty" role="status" aria-label="Loading projects">
              Loading projects…
            </p>
          ) : null}
          {p.list.map((w) => (
            <button key={w.id} type="button" role="menuitem" aria-current={w.id === p.current ? 'true' : undefined} onClick={() => (menu.close(), p.onSelect(w.id))}>
              <span className="sl-switch-tile" aria-hidden="true">
                {tileLetters(w.name)}
              </span>
              <span className="sl-side-label">{w.name}</span>
              {p.live.has(w.id) ? <span className="sl-side-live" role="img" aria-label="a run is live" /> : null}
              {w.id === p.current ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          ))}
          {!p.list.length && !p.loading ? <p className="sl-side-empty">No projects yet. Open a folder.</p> : null}
          <div className="sl-menu-rule" role="separator" />
          <button type="button" role="menuitem" onClick={() => (menu.close(), p.onAdd())}>
            <span className="sl-side-label">Open folder…</span>
            <Kbd mod>O</Kbd>
          </button>
          {current && p.onReveal ? (
            <button type="button" role="menuitem" onClick={() => (menu.close(), p.onReveal!(current))}>
              {`Reveal ${current.name} in Finder`}
            </button>
          ) : null}
          {current ? (
            <button type="button" role="menuitem" className={cn('sl-menu-danger')} onClick={() => (menu.close(), p.onRemove(current))}>
              {`Remove ${current.name} from Tether`}
            </button>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
