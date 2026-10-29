import { useEffect, useState } from 'react';
import type { RunView } from '../api';
import { taskTitle } from '../home/runText';
import { usePoll } from '../hooks';
import { cn } from '../ui/cn';
import { Tag } from '../ui/studio/Section';
import { StepDot, StepTrack } from '../ui/studio/StepTrack';
import { costLine, PLAN_DOT, planRows } from './planModel';
import './runs.css';

/**
 * A run's live plan (spec §6.3, agent-work board): its steps in order, the time each finished one took, the current one
 * with its latest activity (newest highlighted), pending steps dimmed, approvals as Asks first, spend in the header.
 * `compact` (the run page, above the graph): the step track and the current step in one line.
 */
export function PlanCard({ run, compact }: { run: RunView; compact?: boolean }) {
  const rows = planRows(run);
  const live = rows.find((r) => r.state === 'live' || r.state === 'waiting');
  const planning = run.kind === 'team' && !rows.length && run.planning;
  if (compact) {
    const newest = live?.subs.at(-1)?.text;
    return (
      <section className="plan-card compact" aria-label="Plan">
        <StepTrack steps={run.pipeline.nodes.map((n) => ({ id: n.id, status: run.nodes[n.id]?.status ?? 'queued', title: n.title ?? n.role ?? n.kind, kind: n.kind }))} planning={planning} className="plan-track" />
        <span className="plan-now" aria-live="polite">
          {live ? `${live.title} · ${newest ?? live.right}` : planning ? 'Tether is planning…' : `${rows.filter((r) => r.state === 'done').length} of ${rows.length} steps done`}
        </span>
        <span className="plan-cost">{costLine(run)}</span>
      </section>
    );
  }
  return (
    <section className="plan-card" aria-label="Plan">
      <header className="plan-head">
        <b>{taskTitle({ task: run.task, kind: run.kind, pipeline: run.pipeline.name })}</b>
        <span className="plan-cost">{costLine(run)}</span>
      </header>
      {!rows.length ? (
        <p className="sl-quiet">{planning ? 'Tether is planning…' : 'No steps yet.'}</p>
      ) : (
        <ol className="plan-steps">
          {rows.map((r) => (
            <li key={r.id} className={cn('plan-step', `p-${r.state}`)}>
              <div className="plan-row">
                <StepDot state={PLAN_DOT[r.state]} label />
                <span className="plan-title">{r.title}</span>
                {r.state === 'gate' ? <Tag tone="asks">Asks first</Tag> : r.right ? <span className="plan-right">{r.right}</span> : null}
              </div>
              {r.subs.length ? (
                <ul className="plan-subs" aria-label={`${r.title}: latest`} aria-live="polite">
                  {r.subs.map((s, i) => (
                    <li key={`${i}:${s.text}`} className={cn(s.newest && 'newest')}>
                      {s.text}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The plan of a run that may still be going: read every 2.5 s while it lives, one last time when it ends. */
export function LivePlan({ runId }: { runId: string }) {
  const [over, setOver] = useState(false);
  const poll = usePoll<RunView>(over ? null : `/api/runs/${encodeURIComponent(runId)}`, 2500);
  const run = poll.data;
  useEffect(() => {
    if (run && !run.live && run.status !== 'running') setOver(true);
  }, [run]);
  return run ? <PlanCard run={run} /> : null;
}
