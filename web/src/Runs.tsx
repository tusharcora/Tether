import { useState } from 'react';
import { api, type RunRow, type RunView } from './api';
import { Loading } from './components/Loading';
import { usePoll } from './hooks';
import { useRunStream } from './runStream';
import type { WorkspaceRow } from './home/workspaces';
import type { GoalView } from './goals/goalsApi';
import type { Route } from './hooks';
import { RunList } from './runs/RunList';
import { RunPage } from './runs/RunPage';
import { useNotify } from './ui/notify';
import { InlineError } from './ui/studio/InlineError';
import './runs/runs.css';

/** Post an action to the selected run. Resolves true when it went through; a failure is toasted. */
export type RunAct = (path: string, body?: unknown) => Promise<boolean>;

export interface RunsProps {
  selected?: string;
  /** A step of the selected run (from #/runs/<id>/<node>). */
  node?: string;
  /** Open the run on this pane instead of the step pane (from #/runs/<id>?pane=timeline). */
  pane?: 'timeline';
  onSelect: (id?: string) => void;
  onSelectNode?: (node?: string) => void;
  /** The empty list's action: go and start a run. */
  onStart?: () => void;
  /** The current project, for the list's "only this project" switch. */
  project?: WorkspaceRow;
  /** Open a file a run changed in Code: the run's folder and the file's path in its repo. */
  onOpenFile?: (repo: string, file: string) => void;
  /** The goals, for search by goal and a run's goal chip. */
  goals?: GoalView[];
  /** Go elsewhere: a run's goal, its team's room, its chat, its worktree in Code. */
  onGo?: (r: Route) => void;
}

/** The runs list full width, or one run's page (`selected`). One EventSource: the selected run's. */
export function Runs(props: RunsProps) {
  const notify = useNotify();
  const [probes, setProbes] = useState(false);
  const list = usePoll<RunRow[]>(probes ? '/api/runs?all=1' : '/api/runs', 2000);
  const { run, setRun, events, error, retry, onProc } = useRunStream(props.selected);

  const act: RunAct = async (path, body = {}) => {
    try {
      setRun(await api<RunView>('POST', `/api/runs/${props.selected}/${path}`, body));
      void list.refresh();
      return true;
    } catch (e) {
      notify.fail(e);
      return false;
    }
  };

  // no run open: the list alone, full width (spec §7: no "No run selected" pane)
  const ship = (id: string) => api('POST', `/api/runs/${id}/ship`, { merge: false }).then(() => notify.ok('Approved: the PR opens when the run finishes'), notify.fail);
  if (!props.selected) return <div className="runs-list-page"><RunList poll={list} probes={probes} onProbes={setProbes} onSelect={props.onSelect} onStart={props.onStart} project={props.project} goals={props.goals} onShip={ship} onCompare={props.onGo && ((set) => props.onGo!({ tab: 'attempts', id: set }))} /></div>;
  if (!run) return <div className="run-page">{error ? <InlineError message={error} onRetry={retry} /> : <Loading loading lines={4} label="Loading run" />}</div>;
  return (
    <RunPage
      key={run.id}
      run={run}
      events={events}
      streamError={error}
      onRetryStream={retry}
      onAct={act}
      node={props.node}
      pane={props.pane}
      onSelectNode={(n) => props.onSelectNode?.(n)}
      onBack={() => props.onSelect(undefined)}
      onOpenFile={props.onOpenFile && ((f) => props.onOpenFile!(run.repo, f))}
      goals={props.goals}
      onGo={props.onGo}
      onProc={onProc}
    />
  );
}
