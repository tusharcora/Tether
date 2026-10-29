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
import { StatusBadge } from '../ui/studio/StatusBadge';
import type { AccountsView } from '../settings/accountsApi';
import { useOpenRouterConnect } from '../settings/FreeModels';

export const KIND_LABEL: Record<AttentionItem['kind'], string> = { plan_ready: 'Plan ready', question: 'Question', approval: 'Approval', planning_error: 'Planning failed', paused: 'Paused', interrupted: 'Interrupted', failed: 'Failed', free_limit: 'Free limit' };
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

/**
 * First launch (free models spec §7.5): nothing can run a step yet, so the one way to start is offered first. It goes away
 * once anything usable exists (the server's `setup` flag on the OpenRouter account).
 */
function FreeModelsRow(p: { accounts: Poll<AccountsView>; onGo: (r: Route) => void }) {
  const { flow, connect } = useOpenRouterConnect(p.accounts.refresh);
  return (
    <ListRow
      lead={<RunGlyph state="needs" />}
      title="Run Tether on free models"
      meta="Connect OpenRouter once. Approve in your browser, no key to copy. 50 free requests a day."
      actions={
        flow.state === 'pending' ? (
          <StatusBadge tone="needs" label="waiting for you to approve" />
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={() => void connect()}>
              Connect OpenRouter
            </Button>
            <Button size="sm" variant="secondary" onClick={() => p.onGo({ tab: 'settings', id: 'agents' })}>
              I have keys
            </Button>
          </>
        )
      }
    />
  );
}

/** What waits on the person, one row each with its actions in place (Approve posts; Reject lives in Inbox and the run). */
export function NeedsYou(props: { poll: Poll<{ items: AttentionItem[] }>; onGo: (r: Route) => void; onChanged: () => Promise<unknown> | void; accounts?: Poll<AccountsView> }) {
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
  const setup = !!props.accounts?.data?.providers.find((p) => p.id === 'openrouter')?.setup;

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
    <Section title="Needs you" count={data ? items.length + (setup ? 1 : 0) : undefined}>
      <Loading loading={data === undefined && !error} lines={3} label="Loading what needs you">
        {error && !data ? (
          <InlineError message={error} onRetry={() => void refresh()} />
        ) : (
          <>
            {error ? <InlineError compact message="Couldn't refresh" onRetry={() => void refresh()} /> : null}
            {!items.length && !setup ? (
              <QuietLine>Nothing needs you.</QuietLine>
            ) : (
              <RowList label="Needs you">
                {setup && props.accounts ? <FreeModelsRow accounts={props.accounts} onGo={props.onGo} /> : null}
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
