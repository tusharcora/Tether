import { useEffect, useState } from 'react';
import type { RunStatus } from '../../../src/types';
import { fmtUsd, type RunView } from '../api';
import { TaskCard, type TaskCardState } from '../components/assistant-ui/elements/task-card';
import { fmtClock, taskTitle } from '../home/runText';
import { usePoll } from '../hooks';
import { costLine, PLAN_DOT, planRows } from '../runs/planModel';
import { shortRunId } from '../ui/studio/RunGlyph';
import { viewDesc } from '../ui/studio/status';
import { StepDot } from '../ui/studio/StepTrack';
import { segmentsFor, type StepLike } from '../ui/studio/steps';

/** A run as delegated work: finished states first; a run that waits on the person, is paused or lost its process waits. */
export function taskState(r: { status: RunStatus; waiting: boolean; live?: boolean }): TaskCardState {
  if (r.status === 'done') return 'done';
  if (r.status === 'error') return 'failed';
  if (r.status === 'stopped') return 'cancelled';
  return r.waiting || r.status === 'paused' || r.live === false ? 'waiting' : 'working';
}

const link = 'cursor-pointer border-0 bg-transparent p-0 text-xs text-foreground underline underline-offset-4';
const row = 'flex items-center gap-2 text-xs';

/**
 * A run a chat started (a proposal's Start run, or More → turn into a run), as a task card that follows it live: its task,
 * id, state and time, what it cost or why it failed; open, its steps with what each is doing. Read every 2.5 s while it
 * lives, one last time when it ends. Until the first read it is the task it was started with, just started.
 */
export function RunTaskCard({ runId, task, onOpen }: { runId: string; task: string; onOpen: () => void }) {
  const [over, setOver] = useState(false);
  const poll = usePoll<RunView>(over ? null : `/api/runs/${encodeURIComponent(runId)}`, 2500);
  const run = poll.data;
  useEffect(() => {
    if (run && !run.live && run.status !== 'running') setOver(true);
  }, [run]);
  const open = (
    <button type="button" className={link} onClick={onOpen}>
      Open run
    </button>
  );
  if (!run) return <TaskCard className="mt-2" label={taskTitle({ task, kind: 'team', pipeline: '' })} meta={shortRunId(runId)} state="working" actions={open} result={poll.error ? `Could not read the run: ${poll.error}` : undefined} />;
  const state = taskState(viewDesc(run));
  const rows = planRows(run);
  return (
    <TaskCard
      className="mt-2"
      label={taskTitle({ task: run.task, kind: run.kind, pipeline: run.pipeline.name })}
      meta={shortRunId(runId)}
      state={state}
      elapsed={fmtClock((run.finishedAt ?? Date.now()) - run.startedAt)}
      result={state === 'failed' ? (run.error?.split('\n')[0] ?? 'Failed') : state === 'waiting' ? 'Waiting for you' : costLine(run)}
      actions={open}
    >
      {rows.length
        ? rows.map((r) => (
            <div key={r.id} className={row}>
              <StepDot state={PLAN_DOT[r.state]} label />
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              {r.right ? <span className="text-muted-foreground">{r.right}</span> : null}
            </div>
          ))
        : null}
    </TaskCard>
  );
}

/** A team agent's run card (the server keeps its steps, status and spend in sync) as a task card. */
export function TeamRunCard({ card, onOpen }: { card: { runId: string; title: string; steps: StepLike[]; status: RunStatus; costUsd: number }; onOpen: () => void }) {
  const segs = segmentsFor(card.steps);
  return (
    <TaskCard
      label={card.title}
      meta={shortRunId(card.runId)}
      state={taskState({ status: card.status, waiting: segs.some((s) => s.state === 'waiting') })}
      result={`Spent ${fmtUsd(card.costUsd)}`}
      actions={
        <button type="button" className={link} onClick={onOpen}>
          Open run
        </button>
      }
    >
      {segs.length
        ? segs.map((s) => (
            <div key={s.id} className={row}>
              <StepDot state={s.state} label />
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
            </div>
          ))
        : null}
    </TaskCard>
  );
}
