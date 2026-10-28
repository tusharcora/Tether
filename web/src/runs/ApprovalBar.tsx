import { useState } from 'react';
import type { RunView } from '../api';
import { Button } from '../components/beui/kit/Button';
import type { RunAct } from '../Runs';

/** Every gate and how it went: "npm test passed · tsc failed". */
export function gateSummary(r: RunView): string {
  const gates = r.pipeline.nodes.filter((n) => n.kind === 'gate');
  if (!gates.length) return 'No gates in this run';
  return gates
    .map((n) => {
      const s = r.nodes[n.id];
      const word = s?.status === 'error' || s?.gate?.ok === false ? 'failed' : s?.status === 'done' ? 'passed' : 'not run';
      return `${n.command ?? n.id} ${word}`;
    })
    .join(' · ');
}

/** A sticky bar per approval step that waits: the question, the gates, Review diff, Reject and Approve (spec §7.7, §14.8). */
export function ApprovalBar({ run: r, onAct, onReviewDiff }: { run: RunView; onAct: RunAct; onReviewDiff: () => void }) {
  const [acting, setActing] = useState<string | null>(null);
  const waiting = r.pipeline.nodes.filter((n) => n.kind === 'approval' && r.nodes[n.id]?.status === 'awaiting');
  if (!waiting.length) return null;
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
      {waiting.map((n) => (
        <div key={n.id} className="run-approve">
          <div className="run-approve-q">
            {/* a step titled just "approve" (or untitled) would read "Approve approve?" */}
            <b>{!n.title?.trim() || /^approv/i.test(n.title.trim()) ? 'Approve this step?' : `Approve “${n.title.trim()}”?`}</b>
            <span>{gateSummary(r)}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={onReviewDiff}>
            Review diff
          </Button>
          <Button variant="secondary" size="sm" disabled={!!acting} onClick={() => void decide(n.id, false)}>
            Reject
          </Button>
          <Button variant="primary" size="sm" loading={acting === n.id} disabled={!!acting} onClick={() => void decide(n.id, true)}>
            Approve
          </Button>
        </div>
      ))}
    </>
  );
}
