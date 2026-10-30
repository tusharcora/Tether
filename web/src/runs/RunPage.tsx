import { AnimatePresence } from 'motion/react';
import { useEffect, useState } from 'react';
import type { RunView, StoredEvent } from '../api';
import { crewFor, useCrew } from '../crewStore';
import type { GoalView } from '../goals/goalsApi';
import { usePoll, type Route } from '../hooks';
import type { RunAct } from '../Runs';
import { TEAMS_PATH, type TeamsReply } from '../teams/teamsApi';
import { useComments } from './comments';
import { DecisionBanner } from './DecisionBanner';
import { LimitBar } from './LimitBar';
import { OutcomeRail } from './OutcomeRail';
import { RunHeader } from './RunHeader';
import { RunNotices } from './RunNotices';
import { StepInspector } from './StepInspector';
import { StepPane } from './StepPane';
import { StoryList } from './StoryList';
import { costParts, defaultStep, storyRows } from './storyModel';

export type InspectorTarget = { mode: 'step'; node: string } | { mode: 'run'; tab: 'changes' | 'timeline' };

/**
 * A run's page (board 4): the header, the decision banner when the run waits on the person, then three columns: What
 * happened (the steps as a story), the step (Transcript and Changes, commentable), and the Outcome (check, branch, files,
 * cost, every event). The route's node picks the step; ?pane=timeline opens every event.
 */
export function RunPage(p: { run: RunView; events: StoredEvent[]; streamError?: string; onRetryStream: () => void; onAct: RunAct; node?: string; pane?: 'timeline'; onSelectNode: (node?: string) => void; onBack: () => void; onOpenFile?: (file: string) => void; goals?: GoalView[]; onGo?: (r: Route) => void }) {
  const r = p.run;
  const { crew } = useCrew();
  const botOf = (n: { kind: string; role?: string }) => crewFor(n, crew);
  const nameOf = (b: string) => (b === 'tether' ? 'Tether' : (crew[b]?.name ?? b));
  const rows = storyRows(r, botOf, nameOf);
  const [picked, setPicked] = useState<string>();
  const selected = p.node ?? picked ?? defaultStep(r, rows);
  const row = rows.find((x) => x.id === selected) ?? (p.node ? { id: p.node, node: p.node, sentence: p.node, line: '', state: 'queued' as const } : undefined);
  const [events, setEvents] = useState(!!p.pane);
  // the route leads: ?pane=timeline opens every event
  useEffect(() => setEvents(!!p.pane), [p.pane]);
  const comments = useComments(r.id);
  const goal = p.goals?.find((g) => g.items.some((i) => i.runId === r.id)) ?? (r.origin?.kind === 'goal' ? p.goals?.find((g) => g.id === r.origin!.id) : undefined);
  const teamId = r.origin?.team;
  const teams = usePoll<TeamsReply>(teamId ? TEAMS_PATH : null, 60_000).data;
  const teamName = teamId ? (teams?.teams.find((t) => t.id === teamId)?.name ?? teamId) : undefined;
  const nodeName = (id: string) => {
    const n = r.pipeline.nodes.find((x) => x.id === id);
    return n ? nameOf(botOf(n)) : id;
  };
  const inspect: InspectorTarget | undefined = events ? { mode: 'run', tab: 'timeline' } : undefined;

  return (
    <div className="run-view">
      <div className="rp">
        <RunHeader run={r} onAct={p.onAct} onBack={p.onBack} goal={goal} team={teamName} onGoal={goal && p.onGo ? () => p.onGo!({ tab: 'goals', id: goal.id }) : undefined} onTeam={teamId && p.onGo ? () => p.onGo!({ tab: 'teams', id: teamId }) : undefined} />
        <RunNotices run={r} streamError={p.streamError} onRetryStream={p.onRetryStream} />
        <DecisionBanner run={r} goal={goal} team={!!teamId} comments={comments} open={row?.node} onAct={p.onAct} nameOf={nodeName} botName={nodeName} />
        <LimitBar run={r} onAct={p.onAct} />
        <div className="rp-cols">
          <StoryList
            run={r}
            rows={rows}
            selected={row?.id}
            onAct={p.onAct}
            onSelect={(x) => {
              setPicked(x.id);
              p.onSelectNode(x.node);
            }}
          />
          <StepPane key={row?.id} run={r} row={row} comments={comments} onAct={p.onAct} onOpenFile={p.onOpenFile} />
          <OutcomeRail run={r} goal={goal} teamName={teamName} cost={costParts(r, botOf, nameOf)} onGo={p.onGo} onOpenFile={p.onOpenFile} onEvents={() => setEvents(true)} />
        </div>
      </div>
      <AnimatePresence>
        {inspect ? <StepInspector key="insp" run={r} events={p.events} target={inspect} onTarget={(t) => (t.mode === 'step' ? (setEvents(false), setPicked(t.node), p.onSelectNode(t.node)) : undefined)} onClose={() => setEvents(false)} onAct={p.onAct} onOpenFile={p.onOpenFile} /> : null}
      </AnimatePresence>
    </div>
  );
}
