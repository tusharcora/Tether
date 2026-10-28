import { stepLabel } from '../../../src/runLabels';
import type { RunView } from '../api';
import { Button } from '../components/beui/kit/Button';
import type { RunAct } from '../Runs';
import { InlineError } from '../ui/studio/InlineError';

/** Stream error, run error, one banner per approval step waiting (a worker waiting on its question shows in the question cards), Coach findings. */
export function RunBanners({ run: r, streamError, onRetryStream, onAct }: { run: RunView; streamError?: string; onRetryStream: () => void; onAct: RunAct }) {
  const approvals = r.pipeline.nodes.filter((n) => n.kind === 'approval' && r.nodes[n.id]?.status === 'awaiting');
  return (
    <>
      {streamError ? <InlineError message={streamError} onRetry={onRetryStream} /> : null}
      {r.error ? <div className="alert error">{r.error}</div> : null}
      {approvals.map((n) => (
        <div key={n.id} className="alert wait">
          <div>
            <b>Awaiting approval:</b> {stepLabel(r.pipeline.nodes, n.id)}
            <span className="muted small"> — the run is paused and holds no process; approve to continue.</span>
          </div>
          <div className="row">
            <Button variant="primary" onClick={() => void onAct('approve', { node: n.id, approved: true })}>
              Approve
            </Button>
            <Button variant="danger" onClick={() => void onAct('approve', { node: n.id, approved: false })}>
              Reject
            </Button>
          </div>
        </div>
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
