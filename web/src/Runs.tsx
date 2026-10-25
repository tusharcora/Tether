import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type RunRow, type RunView } from './api';
import { Button } from './components/arc/button/button';
import { Drawer, DrawerContent } from './components/arc/drawer/drawer';
import SegmentedControl from './components/arc/segmented-control/segmented-control';
import { Loading } from './components/Loading';
import { usePoll } from './hooks';
import { useRunStream } from './runStream';
import { Inspector } from './runs/Inspector';
import { RunBanners } from './runs/RunBanners';
import { RunCentre } from './runs/RunCentre';
import { RunHeader } from './runs/RunHeader';
import { RunList } from './runs/RunList';
import { cn } from './ui/cn';
import { useNotify } from './ui/notify';
import { EmptyState } from './ui/studio/EmptyState';
import { BELOW_WIDE, PHONE, useMediaQuery } from './ui/studio/useMediaQuery';
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

type PhoneView = 'graph' | 'inspector';

/** Three panes from 1200 px; list + centre with the Inspector in a drawer from 900 px; a stack below. One EventSource: the selected run's. */
export function Runs(props: RunsProps) {
  const notify = useNotify();
  const [probes, setProbes] = useState(false);
  const list = usePoll<RunRow[]>(probes ? '/api/runs?all=1' : '/api/runs', 2000);
  const { run, setRun, events, error } = useRunStream(props.selected);
  const [selNode, setSelNode] = useState<string | undefined>(props.node);
  const belowWide = useMediaQuery(BELOW_WIDE);
  const phone = useMediaQuery(PHONE);
  // a link asking for a pane (the Timeline) opens the Inspector: in the drawer, or on a phone its view
  const [drawer, setDrawer] = useState(!!props.pane);
  const [phoneView, setPhoneView] = useState<PhoneView>(props.pane ? 'inspector' : 'graph');

  // the route names the step; a different run starts with the route's step (none when it names none)
  useEffect(() => setSelNode(props.node), [props.selected, props.node]);
  // a different run starts closed on the Graph, or open when its link asks for a pane
  useEffect(() => {
    setDrawer(!!props.pane);
    setPhoneView(props.pane ? 'inspector' : 'graph');
    // keyed on the run only: picking a step drops the pane hint from the route and must not close anything
  }, [props.selected]);
  // a pane hint only ever opens the Inspector, never closes it
  useEffect(() => {
    if (props.pane) {
      setDrawer(true);
      setPhoneView('inspector');
    }
  }, [props.pane]);
  const pick = (id?: string) => {
    setSelNode(id);
    props.onSelectNode?.(id);
    if (id) {
      setDrawer(true);
      setPhoneView('inspector');
    }
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
  const listPane = <RunList poll={list} probes={probes} onProbes={setProbes} selected={props.selected} onSelect={props.onSelect} onStart={props.onStart} />;
  const placeholder =
    props.selected && error ? (
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
  const inspector = run ? <Inspector run={run} events={events} selected={selNode} pane={props.pane} onAct={act} /> : null;
  const centre = run ? <RunCentre run={run} selected={selNode} onSelect={pick} onAct={act} /> : null;

  if (phone) {
    if (!props.selected) return <div className="runs stacked">{listPane}</div>;
    return (
      <div className="runs stacked">
        <section className="run-detail">
          <div className="run-back">
            <Button variant="ghost" size="sm" onClick={() => props.onSelect(undefined)}>
              <ArrowLeft size={14} aria-hidden="true" /> Runs
            </Button>
          </div>
          {run ? (
            <>
              <RunHeader run={run} onAct={act} />
              <RunBanners run={run} streamError={error} onAct={act} />
              <div className="run-phone-switch">
                <SegmentedControl
                  label="Run view"
                  options={[
                    { value: 'graph', label: 'Graph' },
                    { value: 'inspector', label: 'Inspector' },
                  ]}
                  value={phoneView}
                  onValueChange={(v) => setPhoneView(v as PhoneView)}
                />
              </div>
              {phoneView === 'graph' ? centre : <div className="run-inspector-inline">{inspector}</div>}
            </>
          ) : (
            placeholder
          )}
        </section>
      </div>
    );
  }

  return (
    <div className={cn('runs', { mid: belowWide })}>
      {listPane}
      <section className="run-detail">
        {run ? (
          <>
            <RunHeader
              run={run}
              onAct={act}
              extra={
                belowWide ? (
                  <Button variant="secondary" onClick={() => setDrawer(true)}>
                    Inspector
                  </Button>
                ) : null
              }
            />
            <RunBanners run={run} streamError={error} onAct={act} />
            {centre}
          </>
        ) : (
          placeholder
        )}
      </section>
      {belowWide ? (
        <Drawer open={drawer && !!run} onOpenChange={setDrawer}>
          <DrawerContent side="right" title="Inspector">
            {inspector}
          </DrawerContent>
        </Drawer>
      ) : run ? (
        <aside className="run-inspector" aria-label="Inspector">
          {inspector}
        </aside>
      ) : null}
    </div>
  );
}
