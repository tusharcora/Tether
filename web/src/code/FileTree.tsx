import type { ReactNode } from 'react';
import { FileTree as BeuiFileTree, FileTreeFile, FileTreeFolder } from '../components/beui/motion/file-tree';
import { cn } from '../ui/cn';
import type { GitBadge } from './codeApi';
import { expandDiff, nestRows, type Row, type TreeNode } from './treeModel';

const GIT: Record<GitBadge, { cls: string; say: string }> = {
  M: { cls: 'g-mod', say: 'modified' },
  A: { cls: 'g-add', say: 'added' },
  D: { cls: 'g-del', say: 'deleted' },
  '?': { cls: 'g-new', say: 'untracked' },
  R: { cls: 'g-new', say: 'renamed' },
};

/**
 * The project's files on beui's FileTree (branch lines, a sliding highlight, arrows move and open, Enter opens a file), driven
 * by Code's own state: expanded folders and the open file. Git badges and a dot for files runs changed ride after the name.
 */
export function FileTree(p: { rows: Row[]; expanded: ReadonlySet<string>; current?: string; changed: ReadonlySet<string>; onExpand: (dir: string) => void; onCollapse: (dir: string) => void; onOpen: (path: string) => void }) {
  const files = new Set(p.rows.filter((r) => r.kind === 'file').map((r) => r.path));
  const trailing = (n: TreeNode): ReactNode => (
    <>
      {p.changed.has(n.path) ? (
        <span className="code-run-dot" title="Changed by runs">
          <span className="sl-sr">changed by runs</span>
        </span>
      ) : null}
      {n.git ? (
        <span className={cn('code-git', GIT[n.git].cls)} title={GIT[n.git].say}>
          <span aria-hidden="true">{n.git}</span>
          <span className="sl-sr">{GIT[n.git].say}</span>
        </span>
      ) : null}
    </>
  );
  // beui reads its folders and files from direct elements, so this is a function, not a component
  const draw = (nodes: TreeNode[]): ReactNode =>
    nodes.map((n) =>
      n.kind === 'dir' ? (
        <FileTreeFolder key={n.path} value={n.path} name={n.name} trailing={trailing(n)}>
          {draw(n.children)}
        </FileTreeFolder>
      ) : (
        <FileTreeFile key={n.path} value={n.path} name={n.name} trailing={trailing(n)} />
      ),
    );
  return (
    <BeuiFileTree
      ariaLabel="Files"
      className="code-tree-list"
      classNames={{ label: 'code-row-name' }}
      expandedIds={[...p.expanded]}
      value={p.current ?? null}
      onExpandedChange={(next) => {
        const d = expandDiff(p.expanded, next);
        if (d.expand) p.onExpand(d.expand);
        else if (d.collapse) p.onCollapse(d.collapse);
      }}
      onValueChange={(v) => files.has(v) && p.onOpen(v)}
    >
      {draw(nestRows(p.rows))}
    </BeuiFileTree>
  );
}
