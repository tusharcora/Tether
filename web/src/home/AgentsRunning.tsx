import { api, type RunRow } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Face } from '../Face';
import { usePoll, type Route } from '../hooks';
import { cn } from '../ui/cn';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { rowDesc } from '../ui/studio/status';
import { StepDot } from '../ui/studio/StepTrack';
import { nowLine, stepOf, taskTitle } from './runText';
import './home.css';

/**
 * "3 agents running · Stop all" (spec §6.3, agent-work board): one row per live run with the working bot's face, the task
 * and what is happening now; a run that waits for the person says Ready to review, with Review. No time left: Tether
 * cannot estimate it yet, so it is left out.
 */
export function AgentsRunning({ rows, onGo, onChanged }: { rows: RunRow[]; onGo: (r: Route) => void; onChanged?: () => void }) {
  const notify = useNotify();
  const n = rows.length;
  const stopAll = async () => {
    const out = await Promise.allSettled(rows.map((r) => api('POST', `/api/runs/${encodeURIComponent(r.id)}/stop`)));
    const failed = out.flatMap((o, i) => (o.status === 'rejected' ? [`${rows[i]!.id}: ${(o.reason as Error).message}`] : []));
    if (failed.length) notify.fail(`Could not stop ${failed.join('; ')}`);
    onChanged?.();
  };
  return (
    <section className="ar-card" aria-label="Agents running">
      <div className="ar-head">
        <b>
          {n} {n === 1 ? 'agent' : 'agents'}
        </b>
        <span className="ar-word">running</span>
        <span className="ar-gap" />
        <ConfirmButton label="Stop all" prompt={`Stop ${n} run${n === 1 ? '' : 's'}?`} confirmLabel="Stop" variant="secondary" onConfirm={stopAll} />
      </div>
      <ul className="ar-rows">
        {rows.map((r) => {
          const waiting = rowDesc(r).waiting;
          const bot = r.steps.find((s) => s.status === 'running' || s.status === 'awaiting')?.bot ?? r.bots[0];
          const open = () => onGo({ tab: 'runs', id: r.id });
          const step = stepOf(r);
          return (
            <li key={r.id} className="ar-row">
              <span className="ar-mark">{waiting ? <StepDot state="waiting" label /> : <span className="ar-spin" role="img" aria-label="working" />}</span>
              <div className="ar-body">
                <span className="ar-task">
                  {bot ? <Face id={bot} size={16} mood={waiting ? 'waiting' : 'working'} /> : null}
                  <button type="button" className="ar-title" onClick={open}>
                    {taskTitle(r)}
                  </button>
                </span>
                <span className={cn('ar-sub', waiting && 'needs')}>{waiting ? 'Ready to review' : step ? `${nowLine(r)} · ${step}` : nowLine(r)}</span>
              </div>
              {waiting ? (
                <Button size="sm" variant="primary" onClick={open}>
                  Review
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The agents running card when anything runs (the mini chat's empty state); nothing otherwise. */
export function RunningNow({ onGo }: { onGo: (r: Route) => void }) {
  const poll = usePoll<RunRow[]>('/api/runs', 5000);
  const live = (poll.data ?? []).filter((r) => r.live);
  return live.length ? <AgentsRunning rows={live} onGo={onGo} onChanged={() => void poll.refresh()} /> : null;
}
