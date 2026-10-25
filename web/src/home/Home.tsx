import { useCallback, useEffect, useState } from 'react';
import type { AttentionItem, RunRow } from '../api';
import { Button } from '../components/arc/button/button';
import { usePoll, type Route } from '../hooks';
import { useNotify } from '../ui/notify';
import { ScreenHeader } from '../ui/studio/ScreenHeader';
import { NeedsYou } from './NeedsYou';
import { Recent } from './Recent';
import { Running } from './Running';
import { StartRun } from './StartRun';
import { WORKSPACES_MS, WORKSPACES_PATH, type WorkspaceRow } from './workspaces';
import './home.css';

export const LIVE_MS = 2000;
export const IDLE_MS = 10_000;

/**
 * Home: what needs you, what is running, and where to start the next run. It polls (no EventSource): runs and attention
 * every 2 s while any run is live (the server's `live` flag), every 10 s otherwise. It owns the one /api/workspaces poll
 * its sections share.
 */
export function Home(props: { onGo: (r: Route) => void }) {
  const notify = useNotify();
  const workspaces = usePoll<WorkspaceRow[]>(WORKSPACES_PATH, WORKSPACES_MS);
  const [ms, setMs] = useState(IDLE_MS);
  const runs = usePoll<RunRow[]>('/api/runs', ms);
  const attention = usePoll<{ items: AttentionItem[] }>('/api/attention', ms);
  const anyLive = !!runs.data?.some((r) => r.live);
  useEffect(() => setMs(anyLive ? LIVE_MS : IDLE_MS), [anyLive]);

  const [refreshing, setRefreshing] = useState(false);
  const { refresh: refreshRuns } = runs;
  const { refresh: refreshAttention } = attention;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshRuns(), refreshAttention()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshRuns, refreshAttention]);
  const refetch = useCallback(() => void Promise.all([refreshAttention(), refreshRuns()]), [refreshAttention, refreshRuns]);

  const liveCount = runs.data?.filter((r) => r.live).length ?? 0;
  const needs = attention.data?.items.length ?? 0;

  return (
    <div className="home">
      <ScreenHeader
        meta={`${liveCount} running · ${needs} need${needs === 1 ? 's' : ''} you`}
        title="Home"
        summary="What needs you, what is running, and a place to start the next run."
        actions={
          <Button variant="secondary" size="sm" disabled={refreshing} onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />
      <div className="home-grid">
        <NeedsYou poll={attention} refreshing={refreshing} onGo={props.onGo} onChanged={refetch} />
        <StartRun
          workspaces={workspaces}
          onGo={props.onGo}
          onStarted={(id) => {
            notify.ok('Run started', id);
            refetch();
          }}
        />
        <Running poll={runs} refreshing={refreshing} onGo={props.onGo} />
        <Recent poll={runs} refreshing={refreshing} onGo={props.onGo} />
      </div>
    </div>
  );
}
