import { useState } from 'react';
import { api, type AttentionAction, type AttentionItem } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Loading } from '../components/Loading';
import type { Poll, Route } from '../hooks';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import { ListRow } from '../ui/studio/ListRow';
import { RunGlyph } from '../ui/studio/RunGlyph';
import { QuietLine, RowList, Section } from '../ui/studio/Section';

export const KIND_LABEL: Record<AttentionItem['kind'], string> = { plan_ready: 'Plan ready', question: 'Question', approval: 'Approval', planning_error: 'Planning failed', paused: 'Paused', interrupted: 'Interrupted', failed: 'Failed' };
const ACTION_LABEL: Record<AttentionAction, string> = { answer: 'Answer', review: 'Review plan', approve: 'Approve', resume: 'Resume', retry: 'Retry', open: 'Open' };
const PRIMARY = new Set<AttentionAction>(['answer', 'review', 'approve']);

/**
 * Where a link action goes: a worker's question or an approval opens its step, a failed run opens on its Timeline,
 * everything else opens the run.
 */
export function linkFor(item: AttentionItem, a: AttentionAction): Route {
  if ((a === 'answer' || a === 'open') && item.node) return { tab: 'runs', id: item.runId, node: item.node };
  if (a === 'open' && item.kind === 'failed') return { tab: 'runs', id: item.runId, pane: 'timeline' };
  return { tab: 'runs', id: item.runId };
}

/** What waits on the person, one row each with its actions in place (Approve posts; Reject lives in Inbox and the run). */
export function NeedsYou(props: { poll: Poll<{ items: AttentionItem[] }>; onGo: (r: Route) => void; onChanged: () => Promise<unknown> | void }) {
  const notify = useNotify();
  // ids with an action in flight; an id stays busy until the re-fetch lands, so its row can't be approved twice
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const mark = (id: string, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const { data, error, refresh } = props.poll;
  const items = data?.items ?? [];

  async function post(item: AttentionItem, path: 'approve' | 'resume', body: unknown) {
    if (busy.has(item.id)) return;
    mark(item.id, true);
    try {
      await api('POST', `/api/runs/${encodeURIComponent(item.runId)}/${path}`, body);
      await props.onChanged();
    } catch (e) {
      notify.fail(e);
    } finally {
      mark(item.id, false);
    }
  }
  const act = (item: AttentionItem, a: AttentionAction) => {
    if (a === 'approve') return void post(item, 'approve', { node: item.node, approved: true });
    if (a === 'resume' || a === 'retry') return void post(item, 'resume', {});
    props.onGo(linkFor(item, a));
  };

  return (
    <Section title="Needs you" count={data ? items.length : undefined}>
      <Loading loading={data === undefined && !error} lines={3} label="Loading what needs you">
        {error && !data ? (
          <InlineError message={error} onRetry={() => void refresh()} />
        ) : (
          <>
            {error ? <InlineError compact message="Couldn't refresh" onRetry={() => void refresh()} /> : null}
            {!items.length ? (
              <QuietLine>Nothing needs you.</QuietLine>
            ) : (
              <RowList label="Needs you">
                {items.map((it) => (
                  <ListRow
                    key={it.id}
                    lead={<RunGlyph state={it.kind === 'failed' || it.kind === 'planning_error' ? 'failed' : 'needs'} />}
                    title={it.title}
                    meta={it.meta}
                    actions={it.actions.map((a) => (
                      <Button key={a} size="sm" variant={PRIMARY.has(a) ? 'primary' : 'secondary'} disabled={busy.has(it.id)} onClick={() => act(it, a)}>
                        {ACTION_LABEL[a]}
                      </Button>
                    ))}
                  />
                ))}
              </RowList>
            )}
          </>
        )}
      </Loading>
    </Section>
  );
}
