import { AnimatePresence } from 'motion/react';
import { useEffect, useState } from 'react';
import { api, type AttemptsReply, type RunView, type StoredEvent } from '../api';
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
import { useNotify } from '../ui/notify';
import { useMediaQuery } from '../ui/studio/useMediaQuery';
import { Preview } from './Preview';
import { RewindBanner, RewindDialog, StepMenu, stepActions } from './Rewind';
import { StepPane, type StepTab } from './StepPane';
import { StoryList } from './StoryList';
import type { ProcSubscribe } from './Terminal';
import { TryMore } from './TryMore';
import { costParts, defaultStep, storyRows } from './storyModel';

export type InspectorTarget = { mode: 'step'; node: string } | { mode: 'run'; tab: 'changes' | 'timeline' };
/** Wide enough for Preview to open as a pane beside the step instead of a tab. */
export const WIDE = '(min-width: 1280px)';

/**
 * A run's page (board 4): the header, the decision banner when the run waits on the person, then three columns: What
 * happened (the steps as a story), the step (Transcript and Changes, commentable), and the Outcome (check, branch, files,
 * cost, every event). The route's node picks the step; ?pane=timeline opens every event.
 */
export function RunPage(p: { run: RunView; events: StoredEvent[]; streamError?: string; onRetryStream: () => void; onAct: RunAct; node?: string; pane?: 'timeline'; onSelectNode: (node?: string) => void; onBack: () => void; onOpenFile?: (file: string) => void; goals?: GoalView[]; onGo?: (r: Route) => void; /** The Terminal's output on the run's stream. */ onProc?: ProcSubscribe }) {
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
  const notify = useNotify();
  const [tab, setTab] = useState<StepTab>('transcript');
  const wide = useMediaQuery(WIDE);
  const [previewPane, setPreviewPane] = useState(false);
  const [rewinding, setRewinding] = useState<{ node: string; name: string }>();
  const [trying, setTrying] = useState(false);
  const set = usePoll<AttemptsReply>(r.attemptSet ? `/api/attempts/${encodeURIComponent(r.attemptSet)}` : null, 15_000).data;
  /** A step as the rewind dialog and banner name it: its title, else its bot's name. */
  const stepName = (id: string) => {
    const n = r.pipeline.nodes.find((x) => x.id === id);
    return n?.title ?? (n ? nameOf(botOf(n)) : id);
  };
  const select = (id: string, node?: string) => (setPicked(id), p.onSelectNode(node));
  const fork = (node: string) =>
    void api<{ id: string }>('POST', `/api/runs/${encodeURIComponent(r.id)}/fork`, { node }).then((x) => {
      notify.ok('Forked: a new run starts from after this step');
      p.onGo?.({ tab: 'runs', id: x.id });
    }, notify.fail);

  return (
    <div className="run-view">
      <div className="rp">
        <RunHeader
          run={r}
          onAct={p.onAct}
          onBack={p.onBack}
          goal={goal}
          team={teamName}
          onGoal={goal && p.onGo ? () => p.onGo!({ tab: 'goals', id: goal.id }) : undefined}
          onTeam={teamId && p.onGo ? () => p.onGo!({ tab: 'teams', id: teamId }) : undefined}
          onTryMore={p.onGo ? () => setTrying(true) : undefined}
          setSize={set?.runs.length}
          onCompare={r.attemptSet && p.onGo ? () => p.onGo!({ tab: 'attempts', id: r.attemptSet }) : undefined}
        />
        <RunNotices run={r} streamError={p.streamError} onRetryStream={p.onRetryStream} />
        <RewindBanner run={r} name={stepName} onAct={p.onAct} />
        <DecisionBanner run={r} goal={goal} team={!!teamId} comments={comments} open={row?.node} onAct={p.onAct} nameOf={nodeName} botName={nodeName} />
        <LimitBar run={r} onAct={p.onAct} />
        <div className="rp-cols">
          <StoryList
            run={r}
            rows={rows}
            selected={row?.id}
            onAct={p.onAct}
            onSelect={(x) => select(x.id, x.node)}
            menu={(x) => (
              <StepMenu
                label={x.sentence}
                items={stepActions(r, x, {
                  rewind: () => setRewinding({ node: x.node!, name: stepName(x.node!) }),
                  fork: () => fork(x.node!),
                  changes: () => (select(x.id, x.node), setTab('changes')),
                })}
              />
            )}
          />
          <StepPane key={row?.id} run={r} row={row} comments={comments} onAct={p.onAct} onOpenFile={p.onOpenFile} tab={tab} onTab={setTab} onProc={p.onProc} previewPane={wide && previewPane} onPreview={wide ? () => setPreviewPane(!previewPane) : undefined} />
          {wide && previewPane ? <Preview run={r} onClose={() => setPreviewPane(false)} /> : <OutcomeRail run={r} goal={goal} teamName={teamName} cost={costParts(r, botOf, nameOf)} onGo={p.onGo} onOpenFile={p.onOpenFile} onEvents={() => setEvents(true)} />}
        </div>
        {rewinding ? <RewindDialog run={r} node={rewinding.node} name={rewinding.name} onAct={p.onAct} onClose={() => setRewinding(undefined)} /> : null}
        {trying ? <TryMore run={r} onClose={() => setTrying(false)} onStarted={(s) => (setTrying(false), p.onGo?.({ tab: 'attempts', id: s }))} /> : null}
      </div>
      <AnimatePresence>
        {inspect ? <StepInspector key="insp" run={r} events={p.events} target={inspect} onTarget={(t) => (t.mode === 'step' ? (setEvents(false), setPicked(t.node), p.onSelectNode(t.node)) : undefined)} onClose={() => setEvents(false)} onAct={p.onAct} onOpenFile={p.onOpenFile} /> : null}
      </AnimatePresence>
    </div>
  );
}
