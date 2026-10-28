import { useState } from 'react';
import { ago, api, type AttentionAction, type AttentionItem } from '../api';
import { ApprovalCard } from '../components/beui/agents/approval-card';
import { Button } from '../components/beui/kit/Button';
import { Loading } from '../components/Loading';
import type { Poll, Route } from '../hooks';
import { useNotify } from '../ui/notify';
import { EmptyState } from '../ui/studio/EmptyState';
import { InlineError } from '../ui/studio/InlineError';
import { ListRow } from '../ui/studio/ListRow';
import { Panel } from '../ui/studio/Panel';
import { StatusChip } from '../ui/studio/StatusChip';

const KIND_LABEL: Record<AttentionItem['kind'], string> = { plan_ready: 'plan ready', question: 'question', approval: 'approval', planning_error: 'planning failed', paused: 'paused', interrupted: 'interrupted', failed: 'failed' };
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

export function NeedsYou(props: { poll: Poll<{ items: AttentionItem[] }>; refreshing: boolean; onGo: (r: Route) => void; onChanged: () => Promise<unknown> | void }) {
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
  const act = (item: AttentionItem, a: AttentionAction | 'reject') => {
    if (a === 'approve') return void post(item, 'approve', { node: item.node, approved: true });
    if (a === 'reject') return void post(item, 'approve', { node: item.node, approved: false });
    if (a === 'resume' || a === 'retry') return void post(item, 'resume', {});
    props.onGo(linkFor(item, a));
  };

  return (
    <Panel title="Needs you" count={data ? items.length : undefined} className="s-needs">
      <Loading loading={(data === undefined && !error) || props.refreshing} lines={3} label="Loading what needs you">
        {error && !data ? (
          <InlineError message={error} onRetry={() => void refresh()} />
        ) : (
          <>
            {error ? <InlineError compact message="Couldn't refresh" onRetry={() => void refresh()} /> : null}
            {!items.length ? (
              <EmptyState
                title="Nothing needs you"
                description="Questions, plans and approvals from your runs show up here."
                action={
                  <Button variant="secondary" size="sm" onClick={() => props.onGo({ tab: 'runs' })}>
                    Open Runs
                  </Button>
                }
              />
            ) : (
              <ul className="sl-list">
                {items.map((it) => {
                  // a human gate is an approval card (approve or reject in place); every other item keeps its row actions
                  const gate = it.kind === 'approval' && it.actions.includes('approve');
                  return (
                    <ListRow
                      key={it.id}
                      lead={<StatusChip tone={it.kind === 'failed' || it.kind === 'planning_error' ? 'failed' : 'needs'} label={KIND_LABEL[it.kind]} />}
                      title={it.title}
                      meta={it.meta}
                      age={ago(it.ts)}
                      extra={gate ? <ApprovalCard className="mt-2" status={busy.has(it.id) ? 'submitting' : 'pending'} onApprove={() => act(it, 'approve')} onReject={() => act(it, 'reject')} /> : undefined}
                      actions={it.actions
                        .filter((a) => !(gate && a === 'approve'))
                        .map((a) => (
                          <Button key={a} size="sm" variant={PRIMARY.has(a) ? 'primary' : 'secondary'} disabled={busy.has(it.id)} onClick={() => act(it, a)}>
                            {ACTION_LABEL[a]}
                          </Button>
                        ))}
                    />
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Loading>
    </Panel>
  );
}
