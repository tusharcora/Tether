import { ChevronRight, File, Folder } from 'lucide-react';
import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { cn } from '../ui/cn';
import type { GitBadge } from './codeApi';
import { keyMove, type Row } from './treeModel';

const GIT: Record<GitBadge, { cls: string; say: string }> = {
  M: { cls: 'g-mod', say: 'modified' },
  A: { cls: 'g-add', say: 'added' },
  D: { cls: 'g-del', say: 'deleted' },
  '?': { cls: 'g-new', say: 'untracked' },
  R: { cls: 'g-new', say: 'renamed' },
};

/** The project's files as an ARIA tree: one tab stop, arrows move and open, Enter opens a file; git badges and a dot for files runs changed. */
export function FileTree(p: { rows: Row[]; expanded: ReadonlySet<string>; current?: string; changed: ReadonlySet<string>; onExpand: (dir: string) => void; onCollapse: (dir: string) => void; onOpen: (path: string) => void }) {
  const [focus, setFocus] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const stop = Math.max(0, Math.min(focus, p.rows.length - 1));
  const act = (r: Row) => (r.kind === 'file' ? p.onOpen(r.path) : p.expanded.has(r.path) ? p.onCollapse(r.path) : p.onExpand(r.path));
  const onKeyDown = (e: KeyboardEvent) => {
    const at = refs.current.findIndex((el) => el === document.activeElement);
    const m = at < 0 ? undefined : keyMove(p.rows, at, e.key, p.expanded);
    if (!m) return;
    e.preventDefault();
    if ('focus' in m) {
      setFocus(m.focus);
      refs.current[m.focus]?.focus();
    } else if ('expand' in m) p.onExpand(m.expand);
    else if ('collapse' in m) p.onCollapse(m.collapse);
    else p.onOpen(m.open);
  };
  return (
    <div className="code-tree-list" role="tree" aria-label="Files" onKeyDown={onKeyDown}>
      {p.rows.map((r, i) => {
        const open = r.kind === 'dir' && p.expanded.has(r.path);
        return (
          <div
            key={r.path}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="treeitem"
            aria-level={r.depth + 1}
            aria-expanded={r.kind === 'dir' ? open : undefined}
            aria-selected={r.path === p.current}
            tabIndex={i === stop ? 0 : -1}
            className={cn('code-row', { current: r.path === p.current, open })}
            style={{ '--depth': r.depth } as CSSProperties}
            onFocus={() => setFocus(i)}
            onClick={() => (setFocus(i), act(r))}
          >
            {r.kind === 'dir' ? <ChevronRight className="code-caret" size={12} aria-hidden="true" /> : <span className="code-caret" />}
            {r.kind === 'dir' ? <Folder size={13} aria-hidden="true" /> : <File size={13} aria-hidden="true" />}
            <span className="code-row-name">{r.name}</span>
            {p.changed.has(r.path) ? (
              <span className="code-run-dot" title="Changed by runs">
                <span className="sl-sr">changed by runs</span>
              </span>
            ) : null}
            {r.git ? (
              <span className={cn('code-git', GIT[r.git].cls)} title={GIT[r.git].say}>
                <span aria-hidden="true">{r.git}</span>
                <span className="sl-sr">{GIT[r.git].say}</span>
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
