import { useEffect, useRef, useState } from 'react';
import { stepLabel } from '../../../src/runLabels';
import { api, describeEvent, type RunView, type StoredEvent } from '../api';
import { JsonViewer } from '../components/arc/json-viewer/json-viewer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/arc/tabs/tabs';
import { Timeline, type TimelineEvent } from '../components/arc/timeline/timeline';
import { Loading } from '../components/Loading';
import type { RunAct } from '../Runs';
import { Diff } from '../ui/Diff';
import { InlineError } from '../ui/studio/InlineError';
import { FileBars } from './FileBars';
import { StepPane } from './StepPane';

export type Pane = 'node' | 'timeline' | 'branch';
const TONE: Record<string, TimelineEvent['tone']> = { done: 'success', error: 'danger' };

/** The diff on show: the path it came from, its text once loaded, or the load error. */
interface DiffState {
  path?: string;
  text?: string;
  error?: string;
}

/**
 * Step (the selected step), Branch diff (the whole branch, live as steps commit) and Timeline (run events with JSON detail).
 * `pane` is the route's hint: a failed run's link opens on the Timeline.
 */
export function Inspector({ run: r, events, selected, pane: hint, onAct }: { run: RunView; events: StoredEvent[]; selected?: string; pane?: 'timeline'; onAct: RunAct }) {
  const [pane, setPane] = useState<Pane>(hint ?? 'node');
  const [diff, setDiff] = useState<DiffState>({});
  const [retries, setRetries] = useState(0);
  // one draft note per step, so a note typed under one step can never be sent with another
  const [notes, setNotes] = useState<Record<string, string>>({});
  const noteKey = `${r.id}\0${selected ?? ''}`;

  // a different run starts on the pane its link asks for, or the step pane; picking another step shows it
  const lastSel = useRef(selected);
  useEffect(() => {
    setPane(hint ?? 'node');
    setDiff({});
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
  useEffect(() => {
    if (!path) return setDiff({});
    let cancelled = false;
    // a refetch of the same diff keeps showing the old text; a different diff starts from the skeleton
    setDiff((d) => (d.path === path && d.text !== undefined ? { path, text: d.text } : { path }));
    api<{ diff: string }>('GET', path)
      .then((d) => !cancelled && setDiff({ path, text: d.diff }))
      .catch((e: unknown) => !cancelled && setDiff({ path, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [path, branchKey, retries]);

  /** The loaded diff, its load error with a retry (never "no changes" on error), or the skeleton while it loads. */
  // until the effect catches up, a diff from another path (the previous step's) counts as loading
  const stale = diff.path !== path;
  const diffBlock = (empty: string) =>
    !stale && diff.error ? (
      <InlineError message={diff.error} onRetry={() => setRetries((n) => n + 1)} />
    ) : (
      <Loading loading={stale || diff.text === undefined} lines={6} label="Loading diff">
        {!stale && diff.text ? (
          <>
            <FileBars diff={diff.text} />
            <Diff text={diff.text} />
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
