import { useEffect, useState } from 'react';
import { ApprovalCard } from '../components/beui/agents/approval-card';
import type { ApprovalCardAnswers } from '../components/beui/agents/approval-card/types';
import { ToolApproval } from '../components/beui/agents/tool-approval';
import type { RunRow } from '../api';
import { useCrew } from '../crewStore';
import { usePoll, type Route } from '../hooks';
import { StepTodos } from '../ui/studio/StepTodos';
import { useNotify } from '../ui/notify';
import type { ChatMessage, Proposal, ToolAsk } from './api';
import type { Assistant } from './useAssistant';

/** The started run's steps as a live to-do list: polled while the run lives, one last time when it ends. */
export function LiveRunSteps({ runId }: { runId: string }) {
  const { crew } = useCrew();
  const [over, setOver] = useState(false);
  const poll = usePoll<RunRow[]>(over ? null : '/api/runs', 2500);
  const run = poll.data?.find((r) => r.id === runId);
  useEffect(() => {
    if (run && !run.live && run.status !== 'running') setOver(true);
  }, [run]);
  if (!run) return null;
  if (!run.steps.length) return run.kind === 'team' && run.live ? <p className="m-0 mt-2 text-xs text-muted-foreground">Tether is planning…</p> : null;
  return <StepTodos className="mt-2" title="Run progress" steps={run.steps.map((s) => ({ id: s.id, status: s.status, title: `${crew[s.bot]?.name ?? s.bot} · ${s.id}` }))} />;
}

/** A run Tether proposes, as an approval card in review mode. Nothing starts until Start run is clicked. */
export function ProposalCard({ proposal: p, chat, onGo }: { proposal: Proposal; chat: Assistant; onGo: (r: Route) => void }) {
  const notify = useNotify();
  const decide = (d: 'start' | 'dismiss') => void chat.decide(p, d).then((n) => n.status === 'started' && n.runId && notify.ok('Run started'), notify.fail);
  const status = p.status === 'proposed' ? 'pending' : p.status === 'started' ? 'approved' : 'rejected';
  return (
    <div className="mt-2">
      <ApprovalCard
        title={p.kind === 'workflow' ? `Run the ${p.workflow} workflow?` : `Start a ${p.mode ?? 'team'} run?`}
        description={p.why}
        status={status}
        approveLabel="Start run"
        onApprove={() => decide('start')}
        onReject={() => decide('dismiss')}
        result={p.status === 'started' ? 'Run started' : p.status === 'failed' ? (p.note ?? 'Could not start') : p.status === 'dismissed' ? 'Dismissed' : undefined}
      >
        <p className="m-0 whitespace-pre-wrap text-sm">{p.task}</p>
      </ApprovalCard>
      {p.status === 'started' && p.runId ? (
        <button type="button" className="mt-1.5 border-0 bg-transparent p-0 text-sm text-foreground underline underline-offset-4" onClick={() => onGo({ tab: 'runs', id: p.runId })}>
          Open run
        </button>
      ) : null}
      {p.status === 'started' && p.runId ? <LiveRunSteps runId={p.runId} /> : null}
    </div>
  );
}

/** Questions before Tether goes on: one card, a single choice moves on by itself; the answers go back as the next message. */
export function AskCardView({ message: m, chat }: { message: ChatMessage; chat: Assistant }) {
  const ask = m.ask!;
  const submit = (a: ApprovalCardAnswers) => {
    const label = (qid: string, v: string) => ask.questions.find((q) => q.id === qid)?.options.find((o) => o.id === v)?.label ?? v;
    const lines = ask.questions.map((q) => {
      const x = a[q.id];
      const vals = [...(x?.selected ?? []).map((v) => label(q.id, v)), ...(x?.custom ? [x.custom] : [])];
      return `${q.title}: ${vals.join(', ') || 'no answer'}`;
    });
    const result = lines.map((l) => l.split(': ').slice(1).join(': ')).join(' · ');
    chat.answered(m.id, result);
    void chat.send(lines.join('\n'), { answer: { message: m.id, result } });
  };
  return (
    <div className="mt-2">
      <ApprovalCard
        title="A question first"
        status={ask.status === 'answered' ? 'answered' : 'pending'}
        result={ask.result}
        questions={ask.questions.map((q) => ({ id: q.id, title: q.title, description: q.desc, multiple: q.multi, autoAdvance: !q.multi, options: q.options.map((o) => ({ value: o.id, label: o.label, description: o.desc })) }))}
        onSubmit={submit}
      />
    </div>
  );
}

/** A call to the outside world that Code Mode refused for lack of approval: allow once, always, or deny. */
export function ToolAskCard({ ask, onDecide }: { ask: ToolAsk; onDecide: (d: 'once' | 'always' | 'deny') => Promise<void> }) {
  const notify = useNotify();
  const go = (d: 'once' | 'always' | 'deny') => void onDecide(d).catch(notify.fail);
  return (
    <div className="mt-2">
      <ToolApproval
        tool="run_code"
        description={ask.what}
        status={ask.status === 'pending' ? 'pending' : ask.status === 'denied' ? 'denied' : 'approved'}
        defaultOpen
        onApprove={() => go('once')}
        onAlwaysAllow={() => go('always')}
        onDeny={() => go('deny')}
      />
    </div>
  );
}
