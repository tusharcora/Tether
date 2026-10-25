import { Button } from '../components/arc/button/button';
import { SearchField } from '../components/arc/search-field/search-field';
import SegmentedControl from '../components/arc/segmented-control/segmented-control';
import { NONE } from '../ui/cn';
import type { HistoryRow, HttpTree, TreeCollection, TreeRequest } from './client';

const ENV_DOTS = ['var(--acc)', 'var(--ok)', 'var(--warn)', 'var(--bad)', 'var(--mut)'];
/** A send that took this long or longer is "slow" (amber in the latency strip). */
export const SLOW_MS = 1000;

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
  onImport: () => void;
  onSecrets: () => void;
  onEnv: (name: string | null) => void;
  onEditEnv: (name?: string) => void;
  history: HistoryRow[];
  /** The history entry shown in the response view, if one was opened from the strip. */
  shownHistory?: number;
  onHistory: (row: HistoryRow) => void;
  /** The history could not be loaded: said instead of an empty strip. */
  historyError?: string;
}

export function Tree(p: TreeProps) {
  const envs = p.tree?.environments ?? [];
  const bars = latencyBars(p.history);
  const byId = new Map(p.history.map((h) => [h.id, h]));
  return (
    <div className="tree">
      <div className="env-switch">
        <SegmentedControl
          label="Environment"
          options={[{ value: NONE, label: 'No env' }, ...envs.map((e, i) => ({ value: e, label: e, accessory: <span className="env-dot" style={{ background: ENV_DOTS[i % ENV_DOTS.length] }} aria-hidden="true" /> }))]}
          value={p.tree?.activeEnv ?? NONE}
          onValueChange={(v) => p.onEnv(v === NONE ? null : v)}
        />
        <div className="row">
          {p.tree?.activeEnv ? (
            <Button size="sm" variant="ghost" onClick={() => p.onEditEnv(p.tree!.activeEnv!)}>
              Edit env
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => p.onEditEnv()}>
            New env
          </Button>
          <Button size="sm" variant="ghost" onClick={p.onSecrets}>
            Secrets
          </Button>
        </div>
      </div>
      <SearchField label="Filter requests" value={p.filter} onValueChange={p.onFilter} />
      <div className="row">
        <Button size="sm" variant="secondary" onClick={p.onNew}>
          New request
        </Button>
        <Button size="sm" variant="ghost" onClick={p.onImport}>
          Import
        </Button>
      </div>
      <nav className="tree-scroll" aria-label="Saved requests">
        {p.tree ? <Branch c={p.tree.root} q={p.filter} selected={p.selected} onOpen={p.onOpen} /> : null}
      </nav>
      {p.historyError ? (
        <p className="resp-error" role="alert">{`History: ${p.historyError}`}</p>
      ) : (
        <div className="latency" role="group" aria-label="Last 20 sends">
          {bars.map((b) => (
            <button key={b.id} type="button" className="lat" data-amber={b.amber ? '' : undefined} aria-pressed={p.shownHistory === b.id} aria-label={b.label} title={b.label} style={{ height: `${b.pct}%` }} onClick={() => p.onHistory(byId.get(b.id)!)} />
          ))}
        </div>
      )}
    </div>
  );
}
