import { useEffect, useState } from 'react';
import { api, type RunRow, type RunView } from './api';
import { Button } from './components/arc/button/button';
import { Loading } from './components/Loading';
import { usePoll } from './hooks';
import { useRunStream } from './runStream';
import { Inspector } from './runs/Inspector';
import { RunBanners } from './runs/RunBanners';
import { RunCentre } from './runs/RunCentre';
import { RunHeader } from './runs/RunHeader';
import { RunList } from './runs/RunList';
import { useNotify } from './ui/notify';
import { EmptyState } from './ui/studio/EmptyState';
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
}

export function Runs(props: RunsProps) {
  const notify = useNotify();
  const [probes, setProbes] = useState(false);
  const list = usePoll<RunRow[]>(probes ? '/api/runs?all=1' : '/api/runs', 2000);
  const { run, setRun, events, error } = useRunStream(props.selected);
  const [selNode, setSelNode] = useState<string | undefined>(props.node);
  // the route names the step; a different run starts with the route's step (none when it names none)
  useEffect(() => setSelNode(props.node), [props.selected, props.node]);
  const pick = (id?: string) => {
    setSelNode(id);
    props.onSelectNode?.(id);
  };

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

  const latest = list.data?.[0];
  const page = run ? (
    <>
      <RunHeader run={run} onAct={act} />
      <RunBanners run={run} streamError={error} onAct={act} />
      <RunCentre run={run} selected={selNode} onSelect={pick} onAct={act} />
      <div className="run-inspector-inline">
        <Inspector run={run} events={events} selected={selNode} pane={props.pane} onAct={act} />
      </div>
    </>
  ) : props.selected && error ? (
    <div className="alert error" role="alert">
      {error}
    </div>
  ) : props.selected ? (
    <Loading loading lines={4} label="Loading run" />
  ) : (
    <EmptyState
      title="No run selected"
      description="Select a run to follow it live."
      action={
        latest ? (
          <Button variant="secondary" size="sm" onClick={() => props.onSelect(latest.id)}>
            Open latest run
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="runs">
      <RunList poll={list} probes={probes} onProbes={setProbes} selected={props.selected} onSelect={props.onSelect} onStart={props.onStart} />
      <section className="run-detail">{page}</section>
    </div>
  );
}
