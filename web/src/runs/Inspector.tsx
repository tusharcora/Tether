import { useEffect, useRef, useState } from 'react';
import { stepLabel } from '../../../src/runLabels';
import { api, describeEvent, fmtDur, fmtUsd, type RunView, type StoredEvent } from '../api';
import { Button } from '../components/arc/button/button';
import { CodeBlock } from '../components/arc/code-block/code-block';
import { Input } from '../components/arc/input/input';
import { JsonViewer } from '../components/arc/json-viewer/json-viewer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/arc/tabs/tabs';
import { Timeline, type TimelineEvent } from '../components/arc/timeline/timeline';
import type { RunAct } from '../Runs';
import { Diff } from '../ui/Diff';
import { StatusChip, toneFor } from '../ui/studio/StatusChip';

export type Pane = 'node' | 'timeline' | 'branch';
const TONE: Record<string, TimelineEvent['tone']> = { done: 'success', error: 'danger' };

/** Step, Branch diff and Timeline tabs. `pane` is the route's hint (a failed run's link opens on the Timeline). */
export function Inspector({ run: r, events, selected, pane: hint, onAct }: { run: RunView; events: StoredEvent[]; selected?: string; pane?: 'timeline'; onAct: RunAct }) {
  const [pane, setPane] = useState<Pane>(hint ?? 'node');
  const [diff, setDiff] = useState<string>();
  // one draft note per step, so a note typed under one step can never be sent with another
  const [fbNotes, setFbNotes] = useState<Record<string, string>>({});
  const fbKey = `${r.id}\0${selected ?? ''}`;
  const fbNote = fbNotes[fbKey] ?? '';
  const setFbNote = (t: string) => setFbNotes((cur) => ({ ...cur, [fbKey]: t }));

  // a different run starts on the pane its link asks for, or the step pane; picking a step later shows it
  const lastSel = useRef(selected);
  useEffect(() => {
    setPane(hint ?? 'node');
    setDiff(undefined);
  }, [r.id, hint]);
  useEffect(() => {
    if (selected && selected !== lastSel.current) setPane('node');
    lastSel.current = selected;
  }, [selected]);

  // diff for the selected step's commit, or the whole branch; refetched only when what picks it changes
  const commit = selected ? r.nodes[selected]?.commit : undefined;
  // the branch diff follows every step's commit, so it stays live as later steps commit
  const branchKey = pane === 'branch' ? Object.values(r.nodes).map((n) => n.commit ?? '').join(',') : '';
  useEffect(() => {
    let cancelled = false;
    const load = (path: string) =>
      api<{ diff: string }>('GET', path)
        .then((d) => !cancelled && setDiff(d.diff))
        .catch(() => !cancelled && setDiff(''));
    if (pane === 'branch') void load(`/api/runs/${r.id}/diff`);
    else if (selected && commit) void load(`/api/runs/${r.id}/diff?node=${encodeURIComponent(selected)}`);
    else setDiff(undefined);
    return () => {
      cancelled = true;
    };
  }, [r.id, selected, pane, commit, branchKey]);

  const nameOf = (id: string) => stepLabel(r.pipeline.nodes, id);
  const node = selected ? r.nodes[selected] : undefined;
  const pnode = r.pipeline.nodes.find((n) => n.id === selected);
  async function feedback(rating: 'up' | 'down') {
    const note = fbNote.trim();
    if (await onAct('feedback', { node: selected, rating, ...(note ? { note } : {}) })) setFbNote('');
  }
  const timeline: TimelineEvent[] = events.flatMap((e) => {
    const d = describeEvent(e.event, nameOf);
    return d ? [{ id: String(e.seq), at: e.ts, title: d.text, tone: TONE[d.tone] ?? 'neutral', detail: <JsonViewer data={e.event} label="Event" defaultExpandDepth={1} maxHeight={240} /> }] : [];
  });

  return (
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
        {node && selected ? (
          <div className="node-detail">
            <h4>
              {nameOf(selected)} <StatusChip tone={toneFor(node.status)} label={node.status} pulse={node.status === 'running'} />
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
            {pnode?.kind === 'agent' && !pnode.readOnly && node.status === 'done' && !node.commit ? <p className="muted small">This step finished without changing any files.</p> : null}
            {pnode?.kind === 'agent' && (node.status === 'done' || node.status === 'error') && !r.probe ? (
              <div className="row feedback" title="Evolve learns from this: a note says why">
                <span className="muted small">Was this step good?{node.feedback ? ` You said ${node.feedback.rating === 'up' ? 'good' : 'bad'}.` : ''}</span>
                <Input label="Why (optional)" maxLength={500} value={fbNote} onChange={(e) => setFbNote(e.target.value)} />
                <Button variant="secondary" size="sm" onClick={() => void feedback('up')}>
                  Good
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void feedback('down')}>
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
  );
}
