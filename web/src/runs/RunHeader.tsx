import type { Allowance } from '../../../src/openrouter';
import { fmtDur, fmtUsd, type RunView } from '../api';
import { usePoll } from '../hooks';
import { ALLOWANCE_MS, ALLOWANCE_PATH } from '../settings/accountsApi';
import { Button } from '../components/beui/kit/Button';
import type { GoalView } from '../goals/goalsApi';
import { TYPE_GLYPH } from '../goals/goalsApi';
import { useNow } from '../home/Elapsed';
import { fmtClock, taskTitle } from '../home/runText';
import type { RunAct } from '../Runs';
import { shortRunId } from '../ui/studio/RunGlyph';
import { viewDesc } from '../ui/studio/status';
import { StatusBadge } from '../ui/studio/StatusBadge';

/** Which try of its goal a run is: "try 2 of 4" (of the runs so far when the goal has no run cap). */
export function goalTry(g: GoalView, runId: string): string {
  const runs = g.items.filter((i) => i.kind === 'run');
  const n = runs.findIndex((i) => i.runId === runId) + 1;
  return `try ${n} of ${g.maxRuns ?? runs.length}`;
}

/**
 * The run's head (board 4): ← Runs / its team / its short id; the task as the title with its status and its goal ("Goal ·
 * try 1 of 3"); one mono line (time · cost of its cap); Open in # team for a team's run; Stop / Resume / Retry failed.
 */
export function RunHeader({ run: r, onAct, onBack, goal, team, onGoal, onTeam, onTryMore, setSize, onCompare }: { run: RunView; onAct: RunAct; onBack: () => void; goal?: GoalView; team?: string; onGoal?: () => void; onTeam?: () => void; /** Try 2 more ways (board 6). */ onTryMore?: () => void; /** The run's attempt set: how many, and its Compare page. */ setSize?: number; onCompare?: () => void }) {
  const ticking = r.live && r.status === 'running';
  const now = useNow(ticking);
  const ms = (r.finishedAt ?? now) - r.startedAt;
  const cap = r.pipeline.settings.maxCostUsd ?? r.team?.budgetUsd;
  // a run on OpenRouter shows the free requests used today (spec §7.6)
  const free = usePoll<Allowance>(r.pipeline.nodes.some((n) => n.agent === 'openrouter') ? ALLOWANCE_PATH : null, ALLOWANCE_MS).data;
  // a live clock while the run works; a finished or stalled run reads as a duration (3d 16h)
  const line = `${ticking ? fmtClock(ms) : fmtDur(ms)} · ${fmtUsd(r.costUsd)}${cap ? ` of ${fmtUsd(cap)}` : ''}${free ? ` · ${free.used}/${free.limit} free requests` : ''}`;
  return (
    <header className="rp-head">
      <nav className="rp-crumbs" aria-label="Breadcrumb">
        <button type="button" className="rp-link" onClick={onBack}>
          ← Runs
        </button>
        <span aria-hidden="true">/</span>
        {team ? (
          <>
            {onTeam ? (
              <button type="button" className="rp-link" onClick={onTeam}>{`# ${team}`}</button>
            ) : (
              <span>{`# ${team}`}</span>
            )}
            <span aria-hidden="true">/</span>
          </>
        ) : (
          <>
            <span>{r.kind === 'team' ? 'Team run' : r.pipeline.name}</span>
            <span aria-hidden="true">/</span>
          </>
        )}
        <span className="mono">{shortRunId(r.id)}</span>
      </nav>
      <div className="rp-head-row">
        <h1>{taskTitle({ task: r.task, kind: r.kind, pipeline: r.pipeline.name })}</h1>
        <StatusBadge desc={viewDesc(r)} />
        {goal ? (
          <button type="button" className="rp-chip" onClick={onGoal}>{`${TYPE_GLYPH[goal.type ?? 'feature']} Goal · ${goalTry(goal, r.id)}`}</button>
        ) : null}
        {r.attemptLabel && onCompare ? (
          <button type="button" className="rp-chip" onClick={onCompare}>{`Attempt ${r.attemptLabel}${setSize ? ` of ${setSize}` : ''} · Compare`}</button>
        ) : null}
        <span className="rp-gap" />
        <span className="rp-head-line mono">{line}</span>
        {onTryMore && r.kind !== 'team' && !r.probe && !r.attemptPicked ? (
          <Button variant="secondary" size="sm" onClick={onTryMore}>
            Try 2 more ways
          </Button>
        ) : null}
        {team && onTeam ? (
          <Button variant="secondary" size="sm" onClick={onTeam}>
            {`Open in # ${team}`}
          </Button>
        ) : null}
        {/* a paused run, or a team run waiting on a card or its plan (the server reports it live), can be ended too */}
        {(r.live && r.status === 'running') || r.status === 'paused' ? (
          <Button variant="ghost" size="sm" onClick={() => void onAct('stop')}>
            Stop
          </Button>
        ) : null}
        {!r.live && ['stopped', 'running', 'error'].includes(r.status) ? (
          <Button variant="primary" size="sm" onClick={() => void onAct('resume')}>
            {r.status === 'error' ? 'Retry failed' : 'Resume'}
          </Button>
        ) : null}
      </div>
    </header>
  );
}
