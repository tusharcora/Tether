import { useCallback, useEffect, useState } from 'react';
import type { AttentionItem, RunRow } from '../api';
import { usePoll, type Route } from '../hooks';
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

/**
 * Home (the demo's home screen): a main column (start a run, what needs you, what is running, recent runs) and a 270 px
 * side column (activity, crew) that stacks under it below 1100 px. It polls (no EventSource): runs and attention every
 * 2 s while any run is live (the server's `live` flag), every 10 s otherwise, and the activity feed every 3 s while the
 * tab is visible. It owns the one /api/workspaces poll.
 */
export function Home(props: { onGo: (r: Route) => void; goals?: GoalView[]; onGoal?: (g: GoalView) => void }) {
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
          <NeedsYou poll={attention} onGo={props.onGo} onChanged={refetch} />
          <Running poll={runs} onGo={props.onGo} />
          <Recent poll={runs} onGo={props.onGo} />
        </div>
        <div className="home-side">
          <ActivityFeed feed={feed} />
          <CrewStrip runs={runs.data} />
        </div>
      </div>
    </div>
  );
}
