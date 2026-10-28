import { stepLabel } from '../../../src/runLabels';
import { describeEvent, type RunView, type StoredEvent } from '../api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/beui/kit/controls';
import { JsonViewer } from '../components/kept/json-viewer/json-viewer';
import { Timeline, type TimelineEvent } from '../components/kept/timeline/timeline';
import { Loading } from '../components/Loading';
import { RunDiff } from '../ui/RunDiff';
import { InlineError } from '../ui/studio/InlineError';
import { QuietLine } from '../ui/studio/Section';
import { FileBars } from './FileBars';
import { commitsKey } from './RunFiles';
import { useDiff } from './useDiff';

const TONE: Record<string, TimelineEvent['tone']> = { done: 'success', error: 'danger' };

/** Events as Timeline entries, each with its JSON. */
export function TimelineOf({ run: r, events, label }: { run: RunView; events: StoredEvent[]; label: string }) {
  const nameOf = (id: string) => stepLabel(r.pipeline.nodes, id);
  const items: TimelineEvent[] = events.flatMap((e) => {
    const d = describeEvent(e.event, nameOf);
    return d ? [{ id: String(e.seq), at: e.ts, title: d.text, tone: TONE[d.tone] ?? 'neutral', detail: <JsonViewer data={e.event} label="Event" defaultExpandDepth={1} maxHeight={240} /> }] : [];
  });
  return items.length ? <Timeline label={label} events={items} now={Date.now()} /> : <QuietLine>Nothing happened yet.</QuietLine>;
}

/** A diff's file bars and its files, its error with Retry, or the skeleton while it loads. */
export function DiffView({ diff, empty, onOpenFile }: { diff: ReturnType<typeof useDiff>; empty: string; onOpenFile?: (file: string) => void }) {
  if (diff.error) return <InlineError message={diff.error} onRetry={diff.retry} />;
  return (
    <Loading loading={diff.loading} lines={6} label="Loading diff">
      {diff.text ? (
        <>
          <FileBars diff={diff.text} onOpen={onOpenFile} />
          <RunDiff text={diff.text} />
        </>
      ) : (
        <QuietLine>{empty}</QuietLine>
      )}
    </Loading>
  );
}

/** Run mode: the whole branch's changes (live as steps commit) and every event. */
export function RunDetails({ run: r, events, tab, onTab, onOpenFile }: { run: RunView; events: StoredEvent[]; tab: 'changes' | 'timeline'; onTab: (t: 'changes' | 'timeline') => void; onOpenFile?: (file: string) => void }) {
  const diff = useDiff(`/api/runs/${r.id}/diff`, commitsKey(r));
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as 'changes' | 'timeline')}>
      <TabsList aria-label="Run details">
        <TabsTrigger value="changes">Changes</TabsTrigger>
        <TabsTrigger value="timeline">{`Timeline (${events.length})`}</TabsTrigger>
      </TabsList>
      <TabsContent value="changes" className="insp-body">
        <DiffView diff={diff} empty="No committed changes on this branch yet." onOpenFile={onOpenFile} />
      </TabsContent>
      <TabsContent value="timeline" className="insp-body">
        <TimelineOf run={r} events={events} label="Run events" />
      </TabsContent>
    </Tabs>
  );
}
