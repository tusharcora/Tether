import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type AttentionItem, type RunView } from '../api';
import { ApprovalCard } from '../components/beui/agents/approval-card';
import { Button } from '../components/beui/kit/Button';
import { Loading, useReducedMotionPref } from '../components/Loading';
import { usePoll, type Route } from '../hooks';
import { PlanReview, TeamQuestions, type TeamSend } from '../Team';
import { cn } from '../ui/cn';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import { shortRunId } from '../ui/studio/RunGlyph';
import { ScreenHeader } from '../ui/studio/ScreenHeader';
import { ApproveButton } from '../goals/Goals';
import { goalMeta, goalsApi, type GoalView } from '../goals/goalsApi';
import { waitingGoals } from '../goals/GoalsNeedYou';
import { QuietLine } from '../ui/studio/Section';
import { StatusBadge } from '../ui/studio/StatusBadge';
import { ACTION_WORD, groupInbox, nextSelection, type InboxEntry } from './inboxModel';
import { KIND_LABEL, linkFor } from './NeedsYou';
import './home.css';

/** How often the Inbox refreshes while it is open. */
export const INBOX_MS = 3000;

const failedKind = (k: AttentionItem['kind']) => k === 'failed' || k === 'planning_error';

/** The open entry: questions paged, the plan in full, the approval card, or the item's own actions; then Open run. */
function Detail({ entry: e, onGo, onChanged }: { entry: InboxEntry; onGo: (r: Route) => void; onChanged: () => Promise<unknown> }) {
  const notify = useNotify();
  const it = e.items[0]!;
  const needsRun = e.kind === 'question' || e.kind === 'plan_ready';
  const view = usePoll<RunView>(needsRun ? `/api/runs/${encodeURIComponent(e.runId)}` : null, INBOX_MS);
  const [busy, setBusy] = useState(false);
  const post = async (path: string, body: unknown): Promise<boolean> => {
    setBusy(true);
    try {
      await api('POST', `/api/runs/${encodeURIComponent(e.runId)}/${path}`, body);
      await Promise.all([onChanged(), needsRun ? view.refresh() : undefined]);
      return true;
    } catch (err) {
      notify.fail(err);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const send: TeamSend = (path, body) => post(path, body);

  let body;
  if (needsRun)
    body =
      view.error && !view.data ? (
        <InlineError message={view.error} onRetry={() => void view.refresh()} />
      ) : (
        <Loading loading={!view.data} lines={5} label="Loading the run">
          {view.data ? (
            e.kind === 'question' ? (
              <>
                <p className="inbox-eyebrow">NEEDS YOUR ANSWER</p>
                <TeamQuestions run={view.data} send={send} paged />
              </>
            ) : (
              <PlanReview run={view.data} send={send} />
            )
          ) : null}
        </Loading>
      );
  else if (e.kind === 'approval')
    body = <ApprovalCard title={it.title} description={it.meta} status={busy ? 'submitting' : 'pending'} onApprove={() => void post('approve', { node: it.node, approved: true })} onReject={() => void post('approve', { node: it.node, approved: false })} />;
  else
    body = (
      <>
        <h2 className="inbox-title">{it.title}</h2>
        <p className="sl-meta">{it.meta}</p>
        <div className="inbox-acts">
          {it.actions.includes('resume') || it.actions.includes('retry') ? (
            <Button variant="primary" size="sm" loading={busy} onClick={() => void post('resume', {})}>
              {it.actions.includes('retry') ? 'Retry' : 'Resume'}
            </Button>
          ) : null}
        </div>
      </>
    );

  return (
    <div className="inbox-detail">
      {body}
      <div>
        <Button variant="ghost" size="sm" onClick={() => onGo(linkFor(it, 'open'))}>
          Open run
        </Button>
      </div>
    </div>
  );
}

/** A goal's proposed run: what it will do, and the same Approve run as the Goals list; or skip it. */
function GoalDetail({ goal: g, onGo, onDone }: { goal: GoalView; onGo: (r: Route) => void; onDone: (g: GoalView) => void }) {
  const notify = useNotify();
  return (
    <div className="inbox-detail">
      <h2>{g.title}</h2>
      <p className="sl-meta">{goalMeta(g)}</p>
      <p>{g.pending?.task}</p>
      <div className="row">
        <ApproveButton goal={g} onDone={onDone} />
        <Button variant="secondary" size="sm" onClick={() => void goalsApi.next(g.id, 'skip').then(onDone, notify.fail)}>
          Skip
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onGo({ tab: 'goals', id: g.id })}>
          Open goal
        </Button>
      </div>
    </div>
  );
}

/**
 * Inbox (`#/inbox`, the demo's): what needs you on the left, the open item on the right. A run's questions are one entry,
 * answered page by page; a plan is reviewed in full; approvals, paused, interrupted and failed runs act in place. When the
 * open item goes (answered elsewhere, the run moved on), the neighbour opens.
 */
export function Inbox(props: { onGo: (r: Route) => void; goals?: GoalView[]; onGoal?: (g: GoalView) => void }) {
  const attention = usePoll<{ items: AttentionItem[] }>('/api/attention', INBOX_MS);
  const reduce = useReducedMotionPref();
  const entries = useMemo(() => groupInbox(attention.data?.items ?? []), [attention.data]);
  const [selected, setSelected] = useState<string>();
  const prev = useRef<InboxEntry[]>([]);
  useEffect(() => {
    // the updater runs later, so it gets the list as it was now, not prev.current
    const before = prev.current;
    prev.current = entries;
    setSelected((s) => nextSelection(before, entries, s));
  }, [entries]);
  const waiting = waitingGoals(props.goals);
  /** A goal's proposed run is open on the right instead of a run's entry. */
  const [goalSel, setGoalSel] = useState<string>();
  const openGoal = waiting.find((g) => g.id === goalSel);
  const open = openGoal ? undefined : entries.find((e) => e.key === selected);
  const none = !entries.length && !waiting.length;

  return (
    <div className="home inbox">
      <ScreenHeader title="Inbox" />
      <div className="home-grid">
        <Loading loading={!attention.data && !attention.error} lines={4} label="Loading the inbox">
          {attention.error && !attention.data ? (
            <InlineError message={attention.error} onRetry={() => void attention.refresh()} />
          ) : none ? (
            <QuietLine>Nothing needs you.</QuietLine>
          ) : (
            <div className="inbox-cols">
              <ul className="sl-rows inbox-list" aria-label="Inbox">
                {waiting.map((g) => (
                  <li key={g.id}>
                    <button type="button" className="inbox-row" aria-current={g.id === goalSel ? 'true' : undefined} onClick={() => setGoalSel(g.id)}>
                      <span className="sl-dot pulse inbox-dot" aria-hidden="true" />
                      <span className="inbox-row-main">
                        <span className="sl-row-title">{g.title}</span>
                        <span className="sl-row-meta">Goal · next run</span>
                      </span>
                      <StatusBadge tone="needs" label="approve run" />
                    </button>
                  </li>
                ))}
                <AnimatePresence initial={false}>
                  {entries.map((e) => (
                    <motion.li key={e.key} exit={reduce ? undefined : { opacity: 0, height: 0 }} transition={{ duration: 0.18 }}>
                      <button type="button" className="inbox-row" aria-current={!openGoal && e.key === selected ? 'true' : undefined} onClick={() => (setGoalSel(undefined), setSelected(e.key))}>
                        <span className={cn('sl-dot pulse inbox-dot', { bad: failedKind(e.kind) })} aria-hidden="true" />
                        <span className="inbox-row-main">
                          <span className="sl-row-title">{e.items[0]!.title}</span>
                          <span className="sl-row-meta">{e.kind === 'question' ? `Question 1 of ${e.items.length} · ${shortRunId(e.runId)}` : `${KIND_LABEL[e.kind]} · ${shortRunId(e.runId)}`}</span>
                        </span>
                        <StatusBadge tone={failedKind(e.kind) ? 'failed' : 'needs'} label={ACTION_WORD[e.kind]} />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
              {openGoal ? <GoalDetail goal={openGoal} onGo={props.onGo} onDone={(g) => props.onGoal?.(g)} /> : open ? <Detail key={open.key} entry={open} onGo={props.onGo} onChanged={() => attention.refresh()} /> : null}
            </div>
          )}
        </Loading>
      </div>
    </div>
  );
}
