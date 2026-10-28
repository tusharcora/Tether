import { fmtDur, fmtUsd, type RunRow } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Loading } from '../components/Loading';
import type { Poll, Route } from '../hooks';
import { EmptyState } from '../ui/studio/EmptyState';
import { InlineError } from '../ui/studio/InlineError';
import { ListRow } from '../ui/studio/ListRow';
import { Panel } from '../ui/studio/Panel';
import { StatusChip, toneFor } from '../ui/studio/StatusChip';
import { recentRuns, runTitle } from './runText';

/** The last few finished runs: result, title, duration and cost. */
export function Recent(props: { poll: Poll<RunRow[]>; refreshing: boolean; onGo: (r: Route) => void }) {
  const { data, error, refresh } = props.poll;
  const rows = recentRuns(data ?? []);
  return (
    <Panel title="Recent" className="s-recent">
      <Loading loading={(data === undefined && !error) || props.refreshing} lines={3} label="Loading recent runs">
        {error && !data ? (
          <InlineError message={error} onRetry={() => void refresh()} />
        ) : (
          <>
            {error ? <InlineError compact message="Couldn't refresh" onRetry={() => void refresh()} /> : null}
            {!rows.length ? (
              <EmptyState
                title="No finished runs yet"
                description="Finished runs show their result, time and cost here."
                action={
                  <Button variant="secondary" size="sm" onClick={() => props.onGo({ tab: 'runs' })}>
                    Open Runs
                  </Button>
                }
              />
            ) : (
              <ul className="sl-list">
                {rows.map((r) => (
                  <ListRow
                    key={r.id}
                    lead={<StatusChip tone={toneFor(r.status)} label={r.status} />}
                    title={runTitle(r)}
                    onOpen={() => props.onGo({ tab: 'runs', id: r.id })}
                    meta={`${fmtDur((r.finishedAt ?? r.lastTs) - r.startedAt)} · ${fmtUsd(r.costUsd)}`}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </Loading>
    </Panel>
  );
}
