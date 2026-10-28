import type { ReactNode } from 'react';
import { fmtUsd, type RunView } from '../api';
import { Button } from '../components/beui/kit/Button';
import { runTitle } from '../home/runText';
import type { RunAct } from '../Runs';
import { StatusChip, toneFor } from '../ui/studio/StatusChip';

/** Title, status, interrupted chip, task, cost of budget and branch; Stop / Resume / Retry failed. */
export function RunHeader({ run: r, onAct, extra }: { run: RunView; onAct: RunAct; extra?: ReactNode }) {
  const interrupted = r.status === 'running' && !r.live;
  const cap = r.pipeline.settings.maxCostUsd;
  return (
    <header className="run-head">
      <div className="run-head-main">
        <div className="run-head-title">
          <h2>{runTitle({ kind: r.kind, pipeline: r.pipeline.name })}</h2>
          <StatusChip tone={toneFor(r.status)} label={r.status} pulse={r.live && r.status === 'running'} />
          {r.kind === 'team' ? <StatusChip tone="neutral" label="Team" /> : null}
          {interrupted ? (
            <span title="No process is driving this run. Resume it.">
              <StatusChip tone="needs" label="interrupted" />
            </span>
          ) : null}
        </div>
        <p className="run-head-task">{r.task.split('\n')[0]!.slice(0, 120)}</p>
        <p className="sl-meta">
          {fmtUsd(r.costUsd)}
          {cap ? ` of ${fmtUsd(cap)}` : ''} · {r.branch}
          {r.notes.length ? ` · ${r.notes.length} vault notes` : ''}
        </p>
      </div>
      <div className="run-head-actions">
        {extra}
        {/* a paused run, or a team run waiting on a card or its plan (the server reports it live), can be ended too */}
        {(r.live && r.status === 'running') || r.status === 'paused' ? (
          <Button variant="danger" onClick={() => void onAct('stop')}>
            Stop
          </Button>
        ) : null}
        {!r.live && ['stopped', 'running', 'error'].includes(r.status) ? (
          <Button variant="primary" onClick={() => void onAct('resume')}>
            {r.status === 'error' ? 'Retry failed' : 'Resume'}
          </Button>
        ) : null}
      </div>
    </header>
  );
}
