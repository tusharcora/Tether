import type { RunRow } from '../api';
import { Loading } from '../components/Loading';
import type { Poll, Route } from '../hooks';
import { InlineError } from '../ui/studio/InlineError';
import { ListRow } from '../ui/studio/ListRow';
import { QuietLine, RowList, Section } from '../ui/studio/Section';
import { rowDesc } from '../ui/studio/status';
import { StatusGlyph } from '../ui/studio/StatusBadge';
import { StepTrack } from '../ui/studio/StepTrack';
import { Elapsed } from './Elapsed';
import { nowLine, stepOf, taskTitle } from './runText';

/** Live runs (the server's `live` flag): the task, who works and which step, a step track and an elapsed clock. */
export function Running(props: { poll: Poll<RunRow[]>; onGo: (r: Route) => void }) {
  const { data, error, refresh } = props.poll;
  const live = (data ?? []).filter((r) => r.live);
  return (
    <Section title="Running" count={data ? live.length : undefined}>
      <Loading loading={data === undefined && !error} lines={3} label="Loading running runs">
        {error && !data ? (
          <InlineError message={error} onRetry={() => void refresh()} />
        ) : (
          <>
            {error ? <InlineError compact message="Couldn't refresh" onRetry={() => void refresh()} /> : null}
            {!live.length ? (
              <QuietLine>Nothing running.</QuietLine>
            ) : (
              <RowList label="Running">
                {live.map((r) => {
                  const step = stepOf(r);
                  return (
                    <ListRow
                      key={r.id}
                      lead={<StatusGlyph desc={rowDesc(r)} />}
                      title={taskTitle(r)}
                      onOpen={() => props.onGo({ tab: 'runs', id: r.id })}
                      meta={step ? `${nowLine(r)} · ${step}` : nowLine(r)}
                      age={<Elapsed since={r.startedAt} />}
                      extra={<StepTrack steps={r.steps} planning={r.kind === 'team' && !r.steps.length} />}
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
