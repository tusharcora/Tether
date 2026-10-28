import { useState } from 'react';
import { ago, fmtUsd, type RunRow } from '../api';
import { Button } from '../components/beui/kit/Button';
import { SegmentedControl } from '../components/beui/kit/controls';
import { DataTable, type Column } from '../components/beui/kit/DataTable';
import { Switch } from '../components/beui/kit/fields';
import { Loading } from '../components/Loading';
import { isFinished, taskTitle } from '../home/runText';
import type { WorkspaceRow } from '../home/workspaces';
import { runsIn } from '../projects/projects';
import type { Poll } from '../hooks';
import { InlineError } from '../ui/studio/InlineError';
import { ScreenHeader } from '../ui/studio/ScreenHeader';
import { QuietLine, Tag } from '../ui/studio/Section';
import { badgeFor, rowDesc } from '../ui/studio/status';
import { StatusBadge, StatusGlyph } from '../ui/studio/StatusBadge';

export type RunFilter = 'all' | 'live' | 'done';
/** Live is the server's `live` flag; Done is a finished status (the one shared copy in src/runLabels). */
export const filterRuns = (rows: RunRow[], f: RunFilter): RunRow[] => (f === 'live' ? rows.filter((r) => r.live) : f === 'done' ? rows.filter((r) => isFinished(r.status)) : rows);

/** Live and waiting runs first when sorted by status, then by when they started (newest first). */
const STATUS_ORDER: Record<string, number> = { running: 0, paused: 1, error: 2, done: 3 };
const byStatus = (a: RunRow, b: RunRow) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || b.startedAt - a.startedAt;

/** One line per run: glyph, task title, kind tag (and probe); then the badge and cost · when. */
const columns: Column<RunRow>[] = [
  {
    id: 'run',
    header: 'Run',
    sort: (a, b) => taskTitle(a).localeCompare(taskTitle(b)),
    cell: (r) => (
      <span className="run-row-cell">
        <StatusGlyph desc={rowDesc(r)} />
        <b className="run-row-title">{taskTitle(r)}</b>
        <Tag>{r.kind === 'team' ? 'Team' : r.pipeline}</Tag>
        {r.probe ? <Tag title="Evolve probe replay">probe</Tag> : null}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    align: 'right',
    sort: byStatus,
    cell: (r) => (
      <span className="run-row-side">
        <StatusBadge desc={rowDesc(r)} />
        <span className="sl-meta">
          {fmtUsd(r.costUsd)} · {ago(r.startedAt)}
        </span>
      </span>
    ),
  },
];

export function RunList(props: {
  poll: Poll<RunRow[]>;
  probes: boolean;
  onProbes: (on: boolean) => void;
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
    <section className="run-list" aria-label="Runs">
      <ScreenHeader title="Runs" />
      <div className="run-list-filters" title="Evolve probe replays are experiments and are hidden by default; tether probes --clean deletes finished ones">
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
                <div className="run-list-none">
                  <QuietLine>No runs yet.</QuietLine>
                  {props.onStart ? (
                    <Button variant="secondary" size="sm" onClick={props.onStart}>
                      Start a run
                    </Button>
                  ) : null}
                </div>
              )
            ) : (
              <DataTable<RunRow>
                bare
                className="run-rows"
                aria-label="Run list"
                columns={columns}
                rows={rows}
                rowKey={(r) => r.id}
                rowLabel={(r) => `${taskTitle(r)}, ${badgeFor(rowDesc(r)).label}`}
                onRowClick={(r) => props.onSelect(r.id)}
                rowClassName={() => 'run-row'}
              />
            )}
          </>
        )}
      </Loading>
    </section>
  );
}
