import { Check, ChevronDown } from 'lucide-react';
import type { WorkspaceRow } from '../../home/workspaces';
import { cn } from '../cn';
import { Glyph } from './Glyph';
import { InlineError } from './InlineError';
import { Kbd } from './Kbd';
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
 * current project's name; on the collapsed rail, the glyph alone. Its menu lists the projects with small neutral initials
 * (a blue dot on one with a live run), then Open folder… ⌘O, Reveal in Finder (Tether.app) and Remove from Tether.
 */
export function ProjectSwitcher(p: ProjectsProps & { compact?: boolean }) {
  const menu = useMenu();
  const current = p.list.find((w) => w.id === p.current);
  const name = current?.name ?? (p.loading ? 'Loading…' : 'No project');
  if (p.error && !p.list.length && !p.compact) return <InlineError compact message={p.error.message} onRetry={p.error.onRetry} />;
  return (
    <span className="sl-switch-anchor">
      <button ref={menu.triggerRef} type="button" className={cn('sl-switch', { compact: !!p.compact })} aria-label={`Project: ${name}`} title={p.compact ? name : undefined} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
        <Glyph size={20} />
        {p.compact ? null : (
          <>
            <span className="sl-switch-name">{name}</span>
            <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
          </>
        )}
      </button>
      {menu.open ? (
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
