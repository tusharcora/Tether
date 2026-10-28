import { ApprovalCard } from '../components/beui/agents/approval-card';
import type { ApprovalCardAnswers } from '../components/beui/agents/approval-card/types';
import { ToolApproval } from '../components/beui/agents/tool-approval';
import type { Route } from '../hooks';
import { useNotify } from '../ui/notify';
import type { ChatMessage, Proposal, ToolAsk } from './api';
import type { Assistant } from './useAssistant';

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
        {p.status === 'started' && p.runId ? (
          <button type="button" className="mt-2 text-sm underline underline-offset-4" onClick={() => onGo({ tab: 'runs', id: p.runId })}>
            Open run
          </button>
        ) : null}
      </ApprovalCard>
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
