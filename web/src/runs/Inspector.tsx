import { useEffect, useRef, useState } from 'react';
import { stepLabel } from '../../../src/runLabels';
import { describeEvent, type RunView, type StoredEvent } from '../api';
import { JsonViewer } from '../components/kept/json-viewer/json-viewer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/beui/kit/controls';
import { Timeline, type TimelineEvent } from '../components/kept/timeline/timeline';
import { Loading } from '../components/Loading';
import type { RunAct } from '../Runs';
import { RunDiff } from '../ui/RunDiff';
import { InlineError } from '../ui/studio/InlineError';
import { FileBars } from './FileBars';
import { StepPane } from './StepPane';
import { useDiff } from './useDiff';

export type Pane = 'node' | 'timeline' | 'branch';
const TONE: Record<string, TimelineEvent['tone']> = { done: 'success', error: 'danger' };

/**
 * Step (the selected step), Branch diff (the whole branch, live as steps commit) and Timeline (run events with JSON detail).
 * `pane` is the route's hint: a failed run's link opens on the Timeline.
 */
export function Inspector({ run: r, events, selected, pane: hint, onAct, onOpenFile }: { run: RunView; events: StoredEvent[]; selected?: string; pane?: Pane; onAct: RunAct; /** A changed file's name was picked: open it in Code. */ onOpenFile?: (file: string) => void }) {
  const [pane, setPane] = useState<Pane>(hint ?? 'node');
  // one draft note per step, so a note typed under one step can never be sent with another
  const [notes, setNotes] = useState<Record<string, string>>({});
  const noteKey = `${r.id}\0${selected ?? ''}`;

  // a different run starts on the pane its link asks for, or the step pane; picking another step shows it
  const lastSel = useRef(selected);
  useEffect(() => {
    setPane(hint ?? 'node');
  }, [r.id, hint]);
  useEffect(() => {
    if (selected && selected !== lastSel.current) setPane('node');
    lastSel.current = selected;
  }, [selected]);

  // diff for the selected step's commit, or the whole branch; refetched only when what picks it changes
  const commit = selected ? r.nodes[selected]?.commit : undefined;
  // the branch diff follows every step's commit, so it stays live as later steps commit
  const branchKey = pane === 'branch' ? Object.values(r.nodes).map((n) => n.commit ?? '').join(',') : '';
  const path = pane === 'branch' ? `/api/runs/${r.id}/diff` : selected && commit ? `/api/runs/${r.id}/diff?node=${encodeURIComponent(selected)}` : undefined;
  const diff = useDiff(path, branchKey);

  /** The loaded diff, its load error with a retry (never "no changes" on error), or the skeleton while it loads. */
  const diffBlock = (empty: string) =>
    diff.error ? (
      <InlineError message={diff.error} onRetry={diff.retry} />
    ) : (
      <Loading loading={diff.loading} lines={6} label="Loading diff">
        {diff.text ? (
          <>
            <FileBars diff={diff.text} onOpen={onOpenFile} />
            <RunDiff text={diff.text} />
          </>
        ) : (
          <p className="sl-meta pad">{empty}</p>
        )}
      </Loading>
    );

  const nameOf = (id: string) => stepLabel(r.pipeline.nodes, id);
  const timeline: TimelineEvent[] = events.flatMap((e) => {
    const d = describeEvent(e.event, nameOf);
    return d ? [{ id: String(e.seq), at: e.ts, title: d.text, tone: TONE[d.tone] ?? 'neutral', detail: <JsonViewer data={e.event} label="Event" defaultExpandDepth={1} maxHeight={240} /> }] : [];
  });

  return (
    <Tabs value={pane} onValueChange={(v) => setPane(v as Pane)}>
      <TabsList aria-label="Inspector">
        <TabsTrigger value="node">Step</TabsTrigger>
        <TabsTrigger value="branch">Branch diff</TabsTrigger>
        <TabsTrigger value="timeline">{`Timeline (${events.length})`}</TabsTrigger>
      </TabsList>
      <TabsContent value="timeline">
        <Timeline label="Run events" events={timeline} now={Date.now()} maxHeight={480} />
      </TabsContent>
      <TabsContent value="branch">{pane === 'branch' ? diffBlock('No committed changes on this branch yet.') : null}</TabsContent>
      <TabsContent value="node">
        {selected ? (
          <StepPane
            run={r}
            nodeId={selected}
            diff={pane === 'node' && commit ? diffBlock('This commit changed no files.') : undefined}
            note={notes[noteKey] ?? ''}
            onNote={(t) => setNotes((cur) => ({ ...cur, [noteKey]: t }))}
            onAct={onAct}
          />
        ) : (
          <p className="sl-meta pad">Click a step in the graph to see its output, diff and gate results.</p>
        )}
      </TabsContent>
    </Tabs>
  );
}
