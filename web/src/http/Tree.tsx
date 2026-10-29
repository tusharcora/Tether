import { Button } from '../components/beui/kit/Button';
import { DataTable, type Column } from '../components/beui/kit/DataTable';
import { SearchField } from '../components/beui/kit/fields';
import { ago } from '../api';
import type { HistoryRow, HttpTree, TreeCollection, TreeRequest } from './client';

/** A send that took this long or longer is "slow" (amber in the latency strip). */
export const SLOW_MS = 1000;

/** The path of a URL (or the URL as written when it is not one, as with an unresolved {{base}}). */
const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};

/** The send history as a table: what was sent, how it went, how long it took, and when. A row opens that exchange. */
const HISTORY_COLUMNS: Column<HistoryRow>[] = [
  { id: 'request', header: 'Request', sort: (a, b) => pathOf(a.url).localeCompare(pathOf(b.url)), cell: (h) => (
    <span className="hist-req" title={h.url}>
      <span className="method" data-method={h.method} aria-hidden="true">{h.method}</span>
      <span className="hist-path">{pathOf(h.url)}</span>
    </span>
  ) },
  { id: 'status', header: 'Status', align: 'right', sort: (a, b) => a.status - b.status, cell: (h) => <span className="pill" data-tone={h.status === 0 || h.status >= 400 ? 'bad' : h.status >= 300 ? 'warn' : 'ok'}>{h.status || 'error'}</span> },
  { id: 'ms', header: 'Time', align: 'right', sort: (a, b) => a.ms - b.ms, cell: (h) => <span className="mono">{`${h.ms} ms`}</span> },
  { id: 'when', header: 'When', align: 'right', sort: (a, b) => a.ts - b.ts, cell: (h) => <span className="hint">{ago(h.ts)}</span> },
];

/** The last 20 sends, oldest first, scaled to the slowest; 4xx/5xx, network errors and slow ones are amber. */
export function latencyBars(history: HistoryRow[]): { id: number; pct: number; amber: boolean; label: string }[] {
  const last = history.slice(0, 20).reverse();
  const max = Math.max(1, ...last.map((h) => h.ms));
  return last.map((h) => ({ id: h.id, pct: Math.max(2, Math.round((h.ms / max) * 100)), amber: h.status === 0 || h.status >= 400 || h.ms >= SLOW_MS, label: `${h.method} ${h.status || 'error'} · ${h.ms} ms` }));
}

const matches = (r: TreeRequest, q: string) => !q || `${r.id} ${r.name} ${r.url}`.toLowerCase().includes(q.toLowerCase());
const hasMatch = (c: TreeCollection, q: string): boolean => c.requests.some((r) => matches(r, q)) || c.collections.some((x) => hasMatch(x, q));

function Branch({ c, q, selected, onOpen }: { c: TreeCollection; q: string; selected?: string; onOpen: (id: string) => void }) {
  return (
    <ul className="tree-list">
      {c.collections
        .filter((x) => hasMatch(x, q))
        .map((x) => (
          <li key={x.path}>
            <details open>
              <summary className="coll">{x.name}</summary>
              <Branch c={x} q={q} selected={selected} onOpen={onOpen} />
            </details>
          </li>
        ))}
      {c.requests
        .filter((r) => matches(r, q))
        .map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className="req-row"
              aria-label={r.invalid ? `${r.name} (invalid file)` : `${r.method} ${r.name}`}
              aria-current={selected === r.id ? 'true' : undefined}
              data-invalid={r.invalid ? '' : undefined}
              title={r.invalid ?? r.url}
              onClick={() => onOpen(r.id)}
            >
              <span className="method" data-method={r.method} aria-hidden="true">
                {r.method === '?' ? '!' : r.method}
              </span>
              <span className="req-label">{r.name}</span>
            </button>
          </li>
        ))}
    </ul>
  );
}

export interface TreeProps {
  tree?: HttpTree;
  selected?: string;
  filter: string;
  onFilter: (q: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
}

/** The left dock (spec §8): a filter, the saved requests by folder, and New request at its foot. */
export function Tree(p: TreeProps) {
  return (
    <div className="tree">
      <SearchField label="Filter requests" value={p.filter} onValueChange={p.onFilter} placeholder="Filter requests" />
      <nav className="tree-scroll" aria-label="Saved requests">
        {p.tree ? <Branch c={p.tree.root} q={p.filter} selected={p.selected} onOpen={p.onOpen} /> : null}
      </nav>
      <Button size="sm" variant="secondary" onClick={p.onNew}>
        New request
      </Button>
    </div>
  );
}

/** The response card's History tab: the last 20 sends as a strip (amber when slow or failed) and as a sortable table; a pick opens that exchange. */
export function History(p: { history: HistoryRow[]; shownHistory?: number; onHistory: (row: HistoryRow) => void; historyError?: string }) {
  const bars = latencyBars(p.history);
  const byId = new Map(p.history.map((h) => [h.id, h]));
  if (p.historyError) return <p className="resp-error" role="alert">{`History: ${p.historyError}`}</p>;
  if (!p.history.length) return <p className="sl-quiet">No sends yet.</p>;
  return (
    <div className="history">
      <div className="latency" role="group" aria-label="Last 20 sends">
        {bars.map((b) => (
          <button key={b.id} type="button" className="lat" data-amber={b.amber ? '' : undefined} aria-pressed={p.shownHistory === b.id} aria-label={b.label} title={b.label} style={{ height: `${b.pct}%` }} onClick={() => p.onHistory(byId.get(b.id)!)} />
        ))}
      </div>
      <DataTable<HistoryRow>
        bare
        aria-label="Send history"
        className="history-table"
        columns={HISTORY_COLUMNS}
        rows={p.history.slice(0, 20)}
        rowKey={(h) => String(h.id)}
        defaultSort={{ id: 'when', dir: 'desc' }}
        rowLabel={(h) => `${h.method} ${pathOf(h.url)}, ${h.status || 'error'}`}
        selectedKey={p.shownHistory === undefined ? null : String(p.shownHistory)}
        onRowClick={p.onHistory}
      />
    </div>
  );
}
