import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../lib/utils';

export interface Column<T> {
  id: string;
  header: ReactNode;
  /** Cell content. */
  cell: (row: T) => ReactNode;
  /** Makes the column sortable: a comparison of two rows, ascending. */
  sort?: (a: T, b: T) => number;
  align?: 'left' | 'right';
  /** Visually hide the header text (the column keeps its accessible name). */
  hideHeader?: boolean;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  'aria-label': string;
  /** Sort applied first: a column id and its direction. */
  defaultSort?: { id: string; dir: 'asc' | 'desc' };
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  selectedKey?: string | null;
  empty?: ReactNode;
  className?: string;
  /** Extra class for a row (for example a status tint). */
  rowClassName?: (row: T) => string | undefined;
}

/**
 * A compact data table on Studio tokens (the beui/aicss table look: hairline rows, quiet header). Real table semantics:
 * sortable headers are buttons that set aria-sort, rows with an action are focusable and answer Enter and Space.
 * Sorting is stable and happens in the browser, so a screen keeps its own order until the reader asks for another.
 */
export function DataTable<T>({ columns, rows, rowKey, 'aria-label': label, defaultSort, onRowClick, rowLabel, selectedKey, empty, className, rowClassName }: DataTableProps<T>) {
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.id === sort.id) : undefined;
    if (!sort || !col?.sort) return rows;
    const sign = sort.dir === 'asc' ? 1 : -1;
    return rows.map((row, i) => ({ row, i })).sort((a, b) => sign * col.sort!(a.row, b.row) || a.i - b.i).map((x) => x.row);
  }, [rows, columns, sort]);
  const toggle = (id: string) => setSort((s) => (s?.id === id ? (s.dir === 'asc' ? { id, dir: 'desc' } : null) : { id, dir: 'asc' }));
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick?.(row);
    }
  };
  return (
    <div className={cn('min-w-0 overflow-x-auto rounded-lg border border-border bg-card', className)}>
      <table aria-label={label} className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => {
              const active = sort?.id === c.id ? sort.dir : null;
              return (
                <th key={c.id} scope="col" aria-sort={c.sort ? (active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none') : undefined} className={cn('whitespace-nowrap px-3 py-2 text-xs font-medium text-muted-foreground', c.align === 'right' ? 'text-right' : 'text-left', c.className)}>
                  {c.sort ? (
                    <button type="button" onClick={() => toggle(c.id)} className="inline-flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent p-0 text-inherit font-inherit hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                      <span className={c.hideHeader ? 'sr-only' : undefined}>{c.header}</span>
                      {active === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : active === 'desc' ? <ArrowDown size={12} aria-hidden="true" /> : <ChevronsUpDown size={12} aria-hidden="true" className="opacity-50" />}
                    </button>
                  ) : (
                    <span className={c.hideHeader ? 'sr-only' : undefined}>{c.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">{empty ?? 'Nothing here yet.'}</td></tr>
          ) : (
            sorted.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick ? rowLabel?.(row) : undefined}
                  aria-selected={selectedKey === undefined ? undefined : selectedKey === key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => onKey(e, row) : undefined}
                  className={cn('border-b border-border last:border-b-0 transition-colors', onRowClick && 'cursor-pointer hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', selectedKey === key && 'bg-muted', rowClassName?.(row))}
                >
                  {columns.map((c) => <td key={c.id} className={cn('px-3 py-2 align-middle', c.align === 'right' && 'text-right tabular-nums', c.className)}>{c.cell(row)}</td>)}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
