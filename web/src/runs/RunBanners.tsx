import { stepLabel } from '../../../src/runLabels';
import type { RunView } from '../api';
import { useState } from 'react';
import { ApprovalCard } from '../components/beui/agents/approval-card';
import type { RunAct } from '../Runs';
import { InlineError } from '../ui/studio/InlineError';

/** Stream error, run error, one banner per approval step waiting (a worker waiting on its question shows in the question cards), Coach findings. */
export function RunBanners({ run: r, streamError, onRetryStream, onAct }: { run: RunView; streamError?: string; onRetryStream: () => void; onAct: RunAct }) {
  const approvals = r.pipeline.nodes.filter((n) => n.kind === 'approval' && r.nodes[n.id]?.status === 'awaiting');
  const [acting, setActing] = useState<string | null>(null);
  const decide = async (node: string, approved: boolean) => {
    setActing(node);
    try {
      await onAct('approve', { node, approved });
    } finally {
      setActing(null);
    }
  };
  return (
    <>
      {streamError ? <InlineError message={streamError} onRetry={onRetryStream} /> : null}
      {r.error ? <div className="alert error">{r.error}</div> : null}
      {approvals.map((n) => (
        <ApprovalCard
          key={n.id}
          className="run-gate"
          title={`Awaiting approval: ${stepLabel(r.pipeline.nodes, n.id)}`}
          description="The run is paused and holds no process; approve to continue."
          status={acting === n.id ? 'submitting' : 'pending'}
          onApprove={() => void decide(n.id, true)}
          onReject={() => void decide(n.id, false)}
        />
      ))}
      {r.coach?.length ? (
        <div className="coach">
          <b>Coach</b>
          {r.coach.map((f, i) => (
            <div key={i} className="finding">
              <b>{f.title}</b> <span className="muted">{f.detail}</span>
              <div className="small">→ {f.action}</div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
