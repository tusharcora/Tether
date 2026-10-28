import { useState } from 'react';
import { ago, fmtUsd, type RunRow } from '../api';
import { Button } from '../components/beui/kit/Button';
import { SegmentedControl } from '../components/beui/kit/controls';
import { Switch } from '../components/beui/kit/fields';
import { Loading } from '../components/Loading';
import { isFinished, runTitle } from '../home/runText';
import type { WorkspaceRow } from '../home/workspaces';
import { runsIn } from '../projects/projects';
import type { Poll } from '../hooks';
import { cn } from '../ui/cn';
import { EmptyState } from '../ui/studio/EmptyState';
import { InlineError } from '../ui/studio/InlineError';
import { StatusChip, toneFor } from '../ui/studio/StatusChip';
import { ProgressRing } from './ProgressRing';

export type RunFilter = 'all' | 'live' | 'done';
/** Live is the server's `live` flag; Done is a finished status (the one shared copy in src/runLabels). */
export const filterRuns = (rows: RunRow[], f: RunFilter): RunRow[] => (f === 'live' ? rows.filter((r) => r.live) : f === 'done' ? rows.filter((r) => isFinished(r.status)) : rows);

function RunListRow({ r, selected, onSelect }: { r: RunRow; selected: boolean; onSelect: (id: string) => void }) {
  const done = r.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const active = r.status === 'running' || r.status === 'paused';
  const waiting = active && (r.pending > 0 || r.planReady);
  return (
    <li>
      <button type="button" className={cn('run-row', { selected })} aria-current={selected ? 'true' : undefined} onClick={() => onSelect(r.id)}>
        {selected && r.live ? (
          <svg className="run-live-border" aria-hidden="true">
            {/* rx: fallback only; runs.css sets it from var(--radius-panel) (an SVG attribute can't take a var) */}
            <rect x="0.5" y="0.5" rx="9.5" />
          </svg>
        ) : null}
        <ProgressRing done={done} total={r.steps.length} live={r.live && r.status === 'running'} />
        <span className="run-row-main">
          <span className="run-row-title">
            <b>{runTitle(r)}</b>
            {r.kind === 'team' ? <StatusChip tone="neutral" label="Team" /> : null}
            {r.probe ? (
              <span title="Evolve probe replay">
                <StatusChip tone="neutral" label="probe" />
              </span>
            ) : null}
            {waiting ? (
              <span title={r.planReady ? 'A plan is waiting for your approval' : 'A question is waiting for you'}>
                <StatusChip tone="needs" label={r.planReady ? 'plan' : `? ${r.pending}`} />
              </span>
            ) : null}
          </span>
          <span className="run-row-task">{r.task.split('\n')[0]!.slice(0, 60)}</span>
        </span>
        <span className="run-row-side">
          <StatusChip tone={toneFor(r.status)} label={r.status} pulse={r.live && r.status === 'running'} />
          <span className="sl-meta">
            {fmtUsd(r.costUsd)} · {ago(r.startedAt)}
          </span>
        </span>
      </button>
    </li>
  );
}

export function RunList(props: {
  poll: Poll<RunRow[]>;
  probes: boolean;
  onProbes: (on: boolean) => void;
  selected?: string;
  onSelect: (id: string) => void;
  /** The empty list's one action (F14): go and start a run. */
  onStart?: () => void;
  /** The current project: a switch narrows the list to runs started in its folder. */
  project?: WorkspaceRow;
}) {
  const [filter, setFilter] = useState<RunFilter>('all');
  const [mine, setMine] = useState(false);
  const { data, error, refresh } = props.poll;
  const scoped = props.project && mine ? props.project : undefined;
  const rows = filterRuns(scoped ? runsIn(data ?? [], scoped) : (data ?? []), filter);
  const none = [filter === 'live' ? 'live' : filter === 'done' ? 'finished' : '', 'runs', scoped ? `in ${scoped.name}` : ''].filter(Boolean).join(' ');
  return (
    <aside className="run-list" aria-label="Runs">
      <div className="run-list-head">
        <h2>Runs</h2>
        <SegmentedControl
          label="Filter runs"
          options={[
            { value: 'all', label: 'All' },
            { value: 'live', label: 'Live' },
            { value: 'done', label: 'Done' },
          ]}
          value={filter}
          onValueChange={(v) => setFilter(v as RunFilter)}
        />
      </div>
      <div className="run-list-probes" title="Evolve probe replays are experiments and are hidden by default; tether probes --clean deletes finished ones">
        <Switch label="show probe replays" checked={props.probes} onCheckedChange={(c) => props.onProbes(c === true)} />
        {props.project ? <Switch label={`only ${props.project.name}`} checked={mine} onCheckedChange={(c) => setMine(c === true)} /> : null}
      </div>
      <Loading loading={data === undefined && !error} lines={6} label="Loading runs">
        {error && !data ? (
          <InlineError message={error} onRetry={() => void refresh()} />
        ) : (
          <>
            {/* a poll that fails after an earlier success keeps the list (F23) */}
            {error ? <InlineError compact message="Couldn't refresh" onRetry={() => void refresh()} /> : null}
            {!rows.length ? (
              data?.length ? (
                <div className="run-list-none">
                  <p className="sl-meta">No {none}.</p>
                  <Button variant="ghost" size="sm" onClick={() => (setFilter('all'), setMine(false))}>
                    Show all
                  </Button>
                </div>
              ) : (
                <EmptyState
                  title="No runs yet"
                  description="Start a run from Home, or build a workflow and press Run."
                  action={
                    props.onStart ? (
                      <Button variant="secondary" size="sm" onClick={props.onStart}>
                        Start a run
                      </Button>
                    ) : undefined
                  }
                />
              )
            ) : (
              <ul className="sl-list run-rows">
                {rows.map((r) => (
                  <RunListRow key={r.id} r={r} selected={props.selected === r.id} onSelect={props.onSelect} />
                ))}
              </ul>
            )}
          </>
        )}
      </Loading>
    </aside>
  );
}
