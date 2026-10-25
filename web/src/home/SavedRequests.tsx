import { useCallback, useEffect, useState } from 'react';
import { ago, ApiError } from '../api';
import { Button } from '../components/arc/button/button';
import { CopyButton } from '../components/arc/copy-button/copy-button';
import { Loading } from '../components/Loading';
import { usePoll, type Poll, type Route } from '../hooks';
import { httpApi, type HistoryRow, type HttpTree, type TreeCollection } from '../http/client';
import { useNotify } from '../ui/notify';
import { EmptyState } from '../ui/studio/EmptyState';
import { InlineError } from '../ui/studio/InlineError';
import { ListRow } from '../ui/studio/ListRow';
import { Panel } from '../ui/studio/Panel';
import { StatusChip } from '../ui/studio/StatusChip';
import { INIT_COMMAND, pickWorkspace, WORKSPACES_MS, WORKSPACES_PATH, type WorkspaceRow } from './workspaces';

const SHOWN = 8;
export interface SavedRow { id: string; name: string; method: string; last?: { status: number; ts: number; ok: boolean | null } }

/** Every saved request in tree order with its newest history row. */
export function savedRows(tree: HttpTree, history: HistoryRow[]): SavedRow[] {
  const newest = new Map<string, HistoryRow>();
  for (const h of history) if (h.request && (newest.get(h.request)?.ts ?? -1) < h.ts) newest.set(h.request, h);
  const out: SavedRow[] = [];
  const walk = (c: TreeCollection) => {
    for (const r of c.requests) {
      const h = newest.get(r.id);
      out.push({ id: r.id, name: r.name, method: r.method, ...(h ? { last: { status: h.status, ts: h.ts, ok: h.ok } } : {}) });
    }
    c.collections.forEach(walk);
  };
  walk(tree.root);
  return out;
}

interface SavedState { rows?: SavedRow[]; error?: string; none?: boolean; loading: boolean }

/**
 * The API tab's saved requests (its workspace choice, falling back to the default) with their last result.
 * `workspaces` is Home's one shared /api/workspaces poll; without it (standalone use) it polls on its own.
 * A `refreshKey` change reloads behind the skeleton; a failed reload keeps the rows and says it could not refresh.
 */
export function SavedRequests(props: { onGo: (r: Route) => void; refreshKey: number; workspaces?: Poll<WorkspaceRow[]> }) {
  const own = usePoll<WorkspaceRow[]>(props.workspaces ? null : WORKSPACES_PATH, WORKSPACES_MS);
  const workspaces = props.workspaces ?? own;
  const notify = useNotify();
  const known = workspaces.data !== undefined || !!workspaces.error;
  const ws = pickWorkspace(workspaces.data ?? [])?.id;
  const [state, setState] = useState<SavedState>({ loading: true });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const [tree, history] = await Promise.all([httpApi.tree(ws), httpApi.history(ws, undefined, 100)]);
      setState({ rows: savedRows(tree, history), loading: false });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setState({ none: true, loading: false });
      else setState((s) => ({ rows: s.rows, error: (e as Error).message, loading: false }));
    }
  }, [ws]);
  useEffect(() => {
    if (known) void load();
  }, [known, load, props.refreshKey]);
  const openApi = () => props.onGo({ tab: 'api' });
  const retry = () => void load();
  const rows = state.rows ?? [];
  const failed = (r: SavedRow) => r.last!.ok === false || r.last!.status >= 400;

  return (
    <Panel
      title="Saved requests"
      count={state.rows ? rows.length : undefined}
      className="s-saved"
      action={
        <Button variant="ghost" size="sm" onClick={openApi}>
          Open API
        </Button>
      }
    >
      <Loading loading={state.loading} lines={4} label="Loading saved requests">
        {state.none ? (
          <EmptyState
            title="No workspace yet"
            description={`Saved requests live in a workspace: run ${INIT_COMMAND} in your project folder.`}
            action={<CopyButton value={INIT_COMMAND} label="Copy command" onCopied={() => notify.ok('Command copied', INIT_COMMAND)} />}
          />
        ) : state.error && !state.rows ? (
          <InlineError message={state.error} onRetry={retry} />
        ) : (
          <>
            {state.error ? <InlineError compact message="Couldn't refresh" onRetry={retry} /> : null}
            {!rows.length ? (
              <EmptyState
                title="No saved requests"
                description="Requests you save in the API tab show up here with their last result."
                action={
                  <Button variant="secondary" size="sm" onClick={openApi}>
                    Open API
                  </Button>
                }
              />
            ) : (
              <ul className="sl-list">
                {rows.slice(0, SHOWN).map((r) => (
                  <ListRow
                    key={r.id}
                    lead={<span className="saved-method">{r.method}</span>}
                    title={r.name}
                    onOpen={openApi}
                    meta={r.last ? `${r.last.status} · ${ago(r.last.ts)}` : 'never sent'}
                    actions={r.last ? <StatusChip tone={failed(r) ? 'failed' : 'done'} label={failed(r) ? 'failed' : 'ok'} /> : null}
                  />
                ))}
              </ul>
            )}
            {rows.length > SHOWN ? <p className="sl-meta">{rows.length - SHOWN} more in the API tab</p> : null}
          </>
        )}
      </Loading>
    </Panel>
  );
}
