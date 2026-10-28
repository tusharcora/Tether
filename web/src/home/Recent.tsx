import { fmtDur, fmtUsd, type RunRow } from '../api';
import { Loading } from '../components/Loading';
import type { Poll, Route } from '../hooks';
import { InlineError } from '../ui/studio/InlineError';
import { ListRow } from '../ui/studio/ListRow';
import { shortRunId } from '../ui/studio/RunGlyph';
import { QuietLine, RowList, Section } from '../ui/studio/Section';
import { badgeFor, rowDesc } from '../ui/studio/status';
import { StatusBadge, StatusGlyph } from '../ui/studio/StatusBadge';
import { recentRuns, taskTitle } from './runText';

/** The last few finished runs: the task, then id · result · time · cost, and the result badge. */
export function Recent(props: { poll: Poll<RunRow[]>; onGo: (r: Route) => void }) {
  const { data, error, refresh } = props.poll;
  const rows = recentRuns(data ?? []);
  return (
    <Section title="Recent">
      <Loading loading={data === undefined && !error} lines={3} label="Loading recent runs">
        {error && !data ? (
          <InlineError message={error} onRetry={() => void refresh()} />
        ) : (
          <>
            {error ? <InlineError compact message="Couldn't refresh" onRetry={() => void refresh()} /> : null}
            {!rows.length ? (
              <QuietLine>No finished runs yet.</QuietLine>
            ) : (
              <RowList label="Recent">
                {rows.map((r) => {
                  const desc = rowDesc(r);
                  return (
                    <ListRow
                      key={r.id}
                      lead={<StatusGlyph desc={desc} />}
                      title={taskTitle(r)}
                      onOpen={() => props.onGo({ tab: 'runs', id: r.id })}
                      meta={`${shortRunId(r.id)} · ${badgeFor(desc).label} · ${fmtDur((r.finishedAt ?? r.lastTs) - r.startedAt)} · ${fmtUsd(r.costUsd)}`}
                      actions={<StatusBadge desc={desc} />}
                    />
                  );
                })}
              </RowList>
            )}
          </>
        )}
      </Loading>
    </Section>
  );
}
