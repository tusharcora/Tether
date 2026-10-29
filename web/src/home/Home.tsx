import { useCallback, useEffect, useState } from 'react';
import type { AttentionItem, RunRow } from '../api';
import { ActivityGraph } from '../components/assistant-ui/elements/activity-graph';
import { usePoll, type Poll, type Route } from '../hooks';
import type { AccountsView } from '../settings/accountsApi';
import { useNotify } from '../ui/notify';
import { ScreenHeader } from '../ui/studio/ScreenHeader';
import { ActivityFeed, useActivity } from './ActivityFeed';
import { CrewStrip } from './CrewStrip';
import { GoalsNeedYou } from '../goals/GoalsNeedYou';
import type { GoalView } from '../goals/goalsApi';
import { NeedsYou } from './NeedsYou';
import { Recent } from './Recent';
import { Running } from './Running';
import { StartRun } from './StartRun';
import { WORKSPACES_MS, WORKSPACES_PATH, type WorkspaceRow } from './workspaces';
import './home.css';

export const LIVE_MS = 2000;
export const IDLE_MS = 10_000;
const WEEKS = 26;

/** Runs started per local day over the last `weeks` weeks (the activity graph), and how many that is. */
export function runActivity(runs: { startedAt: number }[], now = new Date(), weeks = WEEKS) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weeks * 7 + 1);
  const by = new Map<string, number>();
  for (const r of runs) {
    const d = new Date(r.startedAt);
    if (d < start) continue;
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    by.set(day, (by.get(day) ?? 0) + 1);
  }
  const data = [...by].map(([date, count]) => ({ date, count }));
  return { data, start, end: now, total: data.reduce((a, x) => a + x.count, 0) };
}

/**
 * Home (the demo's home screen): a main column (start a run, what needs you, what is running, recent runs) and a 270 px
 * side column (activity, crew) that stacks under it below 1100 px. It polls (no EventSource): runs and attention every
 * 2 s while any run is live (the server's `live` flag), every 10 s otherwise, and the activity feed every 3 s while the
 * tab is visible. It owns the one /api/workspaces poll.
 */
export function Home(props: { onGo: (r: Route) => void; goals?: GoalView[]; onGoal?: (g: GoalView) => void; accounts?: Poll<AccountsView> }) {
  const notify = useNotify();
  const workspaces = usePoll<WorkspaceRow[]>(WORKSPACES_PATH, WORKSPACES_MS);
  const [ms, setMs] = useState(IDLE_MS);
  const runs = usePoll<RunRow[]>('/api/runs', ms);
  const attention = usePoll<{ items: AttentionItem[] }>('/api/attention', ms);
  const anyLive = !!runs.data?.some((r) => r.live);
  useEffect(() => setMs(anyLive ? LIVE_MS : IDLE_MS), [anyLive]);
  const feed = useActivity(false);
  const { refresh: refreshRuns } = runs;
  const { refresh: refreshAttention } = attention;
  const refetch = useCallback(() => Promise.all([refreshAttention(), refreshRuns()]), [refreshAttention, refreshRuns]);

  return (
    <div className="home">
      <ScreenHeader title="Home" />
      <div className="home-cols">
        <div className="home-main">
          <StartRun
            workspaces={workspaces}
            onGo={props.onGo}
            onStarted={(id) => {
              notify.ok('Run started', id);
              void refetch();
            }}
          />
          <GoalsNeedYou goals={props.goals} onGo={props.onGo} onDone={(g) => props.onGoal?.(g)} />
          <NeedsYou poll={attention} onGo={props.onGo} onChanged={refetch} accounts={props.accounts} />
          <Running poll={runs} onGo={props.onGo} />
          <Recent poll={runs} onGo={props.onGo} />
        </div>
        <div className="home-side">
          <ActivityFeed feed={feed} />
          <CrewStrip runs={runs.data} />
          {runs.data ? <RunsGraph runs={runs.data} /> : null}
        </div>
      </div>
    </div>
  );
}

function RunsGraph({ runs }: { runs: RunRow[] }) {
  const a = runActivity(runs);
  return <ActivityGraph className="home-graph" data={a.data} start={a.start} end={a.end} title="Runs" total={`${a.total} in ${WEEKS} weeks`} />;
}
