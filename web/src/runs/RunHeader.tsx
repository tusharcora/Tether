import type { Allowance } from '../../../src/openrouter';
import { fmtDur, fmtUsd, type RunView } from '../api';
import { usePoll } from '../hooks';
import { ALLOWANCE_MS, ALLOWANCE_PATH } from '../settings/accountsApi';
import { Button } from '../components/beui/kit/Button';
import { useNow } from '../home/Elapsed';
import { fmtClock, taskTitle } from '../home/runText';
import type { RunAct } from '../Runs';
import { shortRunId } from '../ui/studio/RunGlyph';
import { Tag } from '../ui/studio/Section';
import { viewDesc } from '../ui/studio/status';
import { StatusBadge } from '../ui/studio/StatusBadge';

/** ← Runs; the task as the title with its badge and kind; one mono line (id · kind · time · cost of budget); Run details, Stop / Resume / Retry failed. */
export function RunHeader({ run: r, onAct, onBack, onDetails }: { run: RunView; onAct: RunAct; onBack: () => void; onDetails: () => void }) {
  const ticking = r.live && r.status === 'running';
  const now = useNow(ticking);
  const ms = (r.finishedAt ?? now) - r.startedAt;
  const cap = r.pipeline.settings.maxCostUsd;
  // a run on OpenRouter shows the free requests used today (spec §7.6)
  const free = usePoll<Allowance>(r.pipeline.nodes.some((n) => n.agent === 'openrouter') ? ALLOWANCE_PATH : null, ALLOWANCE_MS).data;
  // a live clock while the run works; a finished or stalled run reads as a duration (3d 16h)
  const line = `${shortRunId(r.id)} · ${r.kind === 'team' ? 'team run' : r.pipeline.name} · ${ticking ? fmtClock(ms) : fmtDur(ms)} · ${fmtUsd(r.costUsd)}${cap ? ` of ${fmtUsd(cap)}` : ''}${free ? ` · ${free.used}/${free.limit} free requests` : ''}`;
  return (
    <header className="run-head">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Runs
        </Button>
      </div>
      <div className="run-head-row">
        <h1>{taskTitle({ task: r.task, kind: r.kind, pipeline: r.pipeline.name })}</h1>
        <StatusBadge desc={viewDesc(r)} />
        <Tag>{r.kind === 'team' ? 'Team' : r.pipeline.name}</Tag>
        <div className="run-head-actions">
          <Button variant="secondary" size="sm" onClick={onDetails}>
            Run details
          </Button>
          {/* a paused run, or a team run waiting on a card or its plan (the server reports it live), can be ended too */}
          {(r.live && r.status === 'running') || r.status === 'paused' ? (
            <Button variant="danger" size="sm" onClick={() => void onAct('stop')}>
              Stop
            </Button>
          ) : null}
          {!r.live && ['stopped', 'running', 'error'].includes(r.status) ? (
            <Button variant="primary" size="sm" onClick={() => void onAct('resume')}>
              {r.status === 'error' ? 'Retry failed' : 'Resume'}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="run-head-line">{line}</p>
    </header>
  );
}
