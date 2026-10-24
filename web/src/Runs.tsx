import { useEffect, useState } from 'react';
import { ago, api, describeEvent, fmtDur, fmtUsd, type RunRow, type RunView } from './api';
import { Canvas } from './Canvas';
import { Badge, type BadgeTone } from './components/arc/badge/badge';
import { Button } from './components/arc/button/button';
import { CodeBlock } from './components/arc/code-block/code-block';
import { EmptyState } from './components/arc/empty-state/empty-state';
import { Input } from './components/arc/input/input';
import { JsonViewer } from './components/arc/json-viewer/json-viewer';
import { Skeleton } from './components/arc/skeleton/skeleton';
import { Stepper } from './components/arc/stepper/stepper';
import { Switch } from './components/arc/switch/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/arc/tabs/tabs';
import { Timeline, type TimelineEvent } from './components/arc/timeline/timeline';
import { usePoll } from './hooks';
import { useRunStream } from './runStream';
import { TeamPanel } from './Team';
import { cn } from './ui/cn';
import { Diff } from './ui/Diff';
import { useNotify } from './ui/notify';

type Pane = 'node' | 'timeline' | 'branch';

const STATUS_TONE: Record<string, BadgeTone> = { running: 'info', done: 'success', error: 'danger', paused: 'warning', stopped: 'neutral' };
const TONE: Record<string, TimelineEvent['tone']> = { done: 'success', error: 'danger' };

export function Runs(props: { selected?: string; onSelect: (id: string) => void }) {
  const notify = useNotify();
  const [probes, setProbes] = useState(false);
  const list = usePoll<RunRow[]>(probes ? '/api/runs?all=1' : '/api/runs', 2000);
  const runs = list.data ?? [];

  const { run, setRun, events, error } = useRunStream(props.selected);
  const [selNode, setSelNode] = useState<string | undefined>();
  const [diff, setDiff] = useState<string | undefined>();
  const [pane, setPane] = useState<Pane>('node');
  // one draft note per step, so a note typed under one step can never be sent with another
  const [fbNotes, setFbNotes] = useState<Record<string, string>>({});
  const fbKey = `${props.selected ?? ''}\0${selNode ?? ''}`;
  const fbNote = fbNotes[fbKey] ?? '';
  const setFbNote = (t: string) => setFbNotes((cur) => ({ ...cur, [fbKey]: t }));

  // a different run starts with no step picked, no diff and the step pane
  useEffect(() => {
    setSelNode(undefined);
    setDiff(undefined);
    setPane('node');
  }, [props.selected]);

  // diff for the selected node's commit, or the whole branch; refetched only when what picks it changes
  const commit = selNode ? run?.nodes[selNode]?.commit : undefined;
  const hasRun = !!run;
  // the branch diff follows every step's commit, so it stays live as later steps commit
  const branchKey = pane === 'branch' && run ? Object.values(run.nodes).map((n) => n.commit ?? '').join(',') : '';
  useEffect(() => {
    const id = props.selected;
    if (!hasRun || !id) return;
    let cancelled = false;
    const load = (path: string) =>
      api<{ diff: string }>('GET', path)
        .then((d) => !cancelled && setDiff(d.diff))
        .catch(() => !cancelled && setDiff(''));
    if (pane === 'branch') void load(`/api/runs/${id}/diff`);
    else if (selNode && commit) void load(`/api/runs/${id}/diff?node=${encodeURIComponent(selNode)}`);
    else setDiff(undefined);
    return () => {
      cancelled = true;
    };
  }, [props.selected, selNode, pane, commit, hasRun, branchKey]);

  const nameOf = (id: string) => {
    const n = run?.pipeline.nodes.find((x) => x.id === id);
    return n ? `${n.title ?? n.role ?? n.kind} (${id})` : id;
  };
  const awaiting = run ? Object.entries(run.nodes).filter(([, n]) => n.status === 'awaiting').map(([id]) => id) : [];
  const node = run && selNode ? run.nodes[selNode] : undefined;
  const pnode = run?.pipeline.nodes.find((n) => n.id === selNode);

  /** Post an action to the selected run. Resolves true when it went through; a failure is toasted. */
  async function act(path: string, body: unknown = {}): Promise<boolean> {
    try {
      setRun(await api<RunView>('POST', `/api/runs/${props.selected}/${path}`, body));
      void list.refresh();
      return true;
    } catch (e) {
      notify.fail(e);
      return false;
    }
  }

  async function feedback(rating: 'up' | 'down') {
    const note = fbNote.trim();
    if (await act('feedback', { node: selNode, rating, ...(note ? { note } : {}) })) setFbNote('');
  }

  const timeline: TimelineEvent[] = events.flatMap((e) => {
    const d = describeEvent(e.event, nameOf);
    return d
      ? [{ id: String(e.seq), at: e.ts, title: d.text, tone: TONE[d.tone] ?? 'neutral', detail: <JsonViewer data={e.event} label="Event" defaultExpandDepth={1} maxHeight={240} /> }]
      : [];
  });

  const detail = (r: RunView) => (
    <>
      <header className="run-head">
        <div>
          <h3>
            {r.kind === 'team' ? 'Team run' : r.pipeline.name} <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
            {r.kind === 'team' ? <Badge tone="info">Team</Badge> : null}
            {r.status === 'running' && !r.live ? (
              <Badge tone="danger" title="No process is driving this run. Resume it.">
                interrupted
              </Badge>
            ) : null}
          </h3>
          <p className="muted small">
            {r.task.split('\n')[0]!.slice(0, 120)} · {fmtUsd(r.costUsd)}
            {r.pipeline.settings.maxCostUsd ? ` of ${fmtUsd(r.pipeline.settings.maxCostUsd)}` : ''} · <code>{r.branch}</code>
            {r.notes.length ? <> · {r.notes.length} vault notes</> : null}
          </p>
        </div>
        <div className="row">
          {/* a paused run, or a team run waiting on a card or its plan (the server reports it live), can be ended too */}
          {(r.live && r.status === 'running') || r.status === 'paused' ? (
            <Button variant="danger" onClick={() => act('stop')}>
              Stop
            </Button>
          ) : null}
          {!r.live && ['stopped', 'running', 'error'].includes(r.status) ? (
            <Button variant="primary" onClick={() => act('resume')}>
              {r.status === 'error' ? 'Retry failed' : 'Resume'}
            </Button>
          ) : null}
        </div>
      </header>

      {error ? <div className="alert error">{error}</div> : null}
      {r.kind === 'team' ? <TeamPanel run={r} send={(path, body) => act(path, body)} /> : null}
      {r.error ? <div className="alert error">{r.error}</div> : null}

      {awaiting.map((id) => (
        <div key={id} className="alert wait">
          <div>
            <b>Awaiting approval:</b> {nameOf(id)}
            <span className="muted small"> — the run is paused and holds no process; approve to continue.</span>
          </div>
          <div className="row">
            <Button variant="primary" onClick={() => act('approve', { node: id, approved: true })}>
              Approve
            </Button>
            <Button variant="danger" onClick={() => act('approve', { node: id, approved: false })}>
              Reject
            </Button>
          </div>
        </div>
      ))}

      {r.coach?.length ? (
        <div className="coach">
          <b>Coach</b>
          {r.coach.map((f, i) => (
            <div key={i} className="finding">
              <b>{f.title}</b> <span className="muted">{f.detail}</span>
              <div className="small">→ {f.action}</div>
            </div>
          ))}
        </div>
      ) : null}

      {r.pipeline.nodes.length > 0 ? (
        <Stepper
          compact
          label="Steps"
          steps={r.pipeline.nodes.map((n) => ({
            id: n.id,
            label: n.title ?? n.role ?? n.kind,
            error: r.nodes[n.id]?.status === 'error' ? (r.nodes[n.id]?.error ?? 'failed') : undefined,
          }))}
          current={(() => {
            const i = r.pipeline.nodes.findIndex((n) => !['done', 'skipped'].includes(r.nodes[n.id]?.status ?? ''));
            return i < 0 ? r.pipeline.nodes.length : i;
          })()}
        />
      ) : null}

      <div className="run-graph">
        <Canvas
          nodes={r.pipeline.nodes}
          edges={r.pipeline.edges}
          statuses={r.nodes}
          selected={selNode}
          onSelect={(id) => {
            setSelNode(id);
            if (id) setPane('node');
          }}
        />
      </div>

      <Tabs value={pane} onValueChange={(v) => setPane(v as Pane)}>
        <TabsList>
          <TabsTrigger value="node">Step</TabsTrigger>
          <TabsTrigger value="branch">Branch diff</TabsTrigger>
          <TabsTrigger value="timeline">{`Timeline (${events.length})`}</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline">
          <Timeline label="Run events" events={timeline} now={Date.now()} maxHeight={480} />
        </TabsContent>

        <TabsContent value="branch">{diff ? <Diff text={diff} /> : <p className="muted pad">No committed changes on this branch yet.</p>}</TabsContent>

        <TabsContent value="node">
          {node ? (
            <div className="node-detail">
              <h4>
                {nameOf(selNode!)} <Badge tone={STATUS_TONE[node.status] ?? 'neutral'}>{node.status}</Badge>
              </h4>
              <p className="muted small">
                {node.attempts} attempt{node.attempts === 1 ? '' : 's'}
                {node.loops ? ` · ${node.loops} fix loop${node.loops === 1 ? '' : 's'}` : ''}
                {node.costUsd ? ` · ${fmtUsd(node.costUsd)}` : ''}
                {node.startedAt && node.finishedAt ? ` · ${fmtDur(node.finishedAt - node.startedAt)}` : ''}
                {node.verdict ? ` · VERDICT ${node.verdict}` : ''}
                {node.commit ? ' · commit ' : ''}
                {node.commit ? <code>{node.commit.slice(0, 7)}</code> : null}
              </p>
              {node.error ? <div className="alert error">{node.error}</div> : null}
              {node.live ? (
                <>
                  <h5>Live output</h5>
                  <pre className="out live">{node.live}</pre>
                </>
              ) : null}
              {pnode?.kind === 'gate' && node.gate ? (
                <>
                  <h5>
                    Gate · {pnode.command} · {node.gate.ok ? 'passed' : `failed (exit ${node.gate.exitCode})`}
                  </h5>
                  <CodeBlock code={node.gate.output || '(no output)'} filename={pnode.command} language="text" maxLines={40} />
                </>
              ) : null}
              {node.output && pnode?.kind === 'agent' ? (
                <>
                  <h5>Output</h5>
                  <CodeBlock code={node.output} language="text" maxLines={40} />
                </>
              ) : null}
              {diff ? (
                <>
                  <h5>Changes this step committed</h5>
                  <Diff text={diff} />
                </>
              ) : null}
              {pnode?.kind === 'agent' && !pnode.readOnly && node.status === 'done' && !node.commit ? (
                <p className="muted small">This step finished without changing any files.</p>
              ) : null}
              {pnode?.kind === 'agent' && (node.status === 'done' || node.status === 'error') && !r.probe ? (
                <div className="row feedback" title="Evolve learns from this: a note says why">
                  <span className="muted small">Was this step good?{node.feedback ? ` You said ${node.feedback.rating === 'up' ? 'good' : 'bad'}.` : ''}</span>
                  <Input label="Why (optional)" maxLength={500} value={fbNote} onChange={(e) => setFbNote(e.target.value)} />
                  <Button variant="secondary" size="sm" onClick={() => feedback('up')}>
                    Good
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => feedback('down')}>
                    Bad
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="muted pad">Click a step in the graph to see its output, diff and gate results.</p>
          )}
        </TabsContent>
      </Tabs>
    </>
  );

  return (
    <div className="runs">
      <aside className="run-list">
        <h4>Runs</h4>
        <div className="check small pad" title="Evolve probe replays are experiments and are hidden by default; aorch probes --clean deletes finished ones">
          <Switch label="show probe replays" checked={probes} onCheckedChange={(c) => setProbes(c === true)} />
        </div>
        {list.error && !list.data ? (
          <div className="alert error pad" role="alert">
            {list.error}{' '}
            <Button variant="secondary" size="sm" onClick={() => void list.refresh()}>
              Retry
            </Button>
          </div>
        ) : runs.length === 0 ? (
          <p className="muted small pad">No runs yet. Build a pipeline and press Run.</p>
        ) : null}
        {runs.map((r) => (
          <button key={r.id} className={cn('run-item', { active: props.selected === r.id })} onClick={() => props.onSelect(r.id)}>
            <span className={cn(`dot s-${r.status}`, { pulse: r.live && r.status === 'running' })} />
            <span className="run-main">
              <b>
                {r.kind === 'team' ? 'Team run' : r.pipeline}
                {r.kind === 'team' ? (
                  <Badge size="sm" tone="info">
                    Team
                  </Badge>
                ) : null}
                {r.probe ? (
                  <Badge size="sm" tone="neutral" title="Evolve probe replay">
                    probe
                  </Badge>
                ) : null}
                {(r.pending > 0 || r.planReady) && (r.status === 'running' || r.status === 'paused') ? (
                  <Badge size="sm" tone="warning" title={r.planReady ? 'A plan is waiting for your approval' : 'A question is waiting for you'}>
                    {r.planReady ? 'plan' : `? ${r.pending}`}
                  </Badge>
                ) : null}
              </b>
              <small>{r.task.split('\n')[0]!.slice(0, 60)}</small>
            </span>
            <span className="run-side">
              <small>{fmtUsd(r.costUsd)}</small>
              <small>{ago(r.startedAt)}</small>
            </span>
          </button>
        ))}
      </aside>

      <section className="run-detail">
        {run ? (
          detail(run)
        ) : props.selected && error ? (
          <div className="alert error" role="alert">{error}</div>
        ) : props.selected ? (
          <Skeleton lines={4} label="Loading run" />
        ) : (
          <EmptyState title="No run selected" description="Select a run to follow it live." />
        )}
      </section>
    </div>
  );
}
