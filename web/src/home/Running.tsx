import type { RunRow } from '../api';
import { Button } from '../components/arc/button/button';
import { Loading } from '../components/Loading';
import type { Poll, Route } from '../hooks';
import { EmptyState } from '../ui/studio/EmptyState';
import { FaceStack } from '../ui/studio/FaceStack';
import { InlineError } from '../ui/studio/InlineError';
import { ListRow } from '../ui/studio/ListRow';
import { Panel } from '../ui/studio/Panel';
import { StepTrack } from '../ui/studio/StepTrack';
import { Elapsed } from './Elapsed';
import { nowLine, runTitle, workingBot } from './runText';

/** Live runs (the server's `live` flag) with their steps, faces, what is happening and an elapsed clock. */
export function Running(props: { poll: Poll<RunRow[]>; refreshing: boolean; onGo: (r: Route) => void }) {
  const { data, error, refresh } = props.poll;
  const live = (data ?? []).filter((r) => r.live);
  return (
    <Panel title="Running" count={data ? live.length : undefined} className="s-running">
      <Loading loading={(data === undefined && !error) || props.refreshing} lines={3} label="Loading running runs">
        {error && !data ? (
          <InlineError message={error} onRetry={() => void refresh()} />
        ) : (
          <>
            {error ? <InlineError compact message="Couldn't refresh" onRetry={() => void refresh()} /> : null}
            {!live.length ? (
              <EmptyState
                title="Nothing running"
                description="Runs you start appear here while they work."
                action={
                  <Button variant="secondary" size="sm" onClick={() => props.onGo({ tab: 'runs' })}>
                    Open Runs
                  </Button>
                }
              />
            ) : (
              <ul className="sl-list">
                {live.map((r) => (
                  <ListRow
                    key={r.id}
                    lead={<FaceStack bots={r.bots.length ? r.bots : r.kind === 'team' ? ['orchestrator'] : []} working={workingBot(r)} />}
                    title={runTitle(r)}
                    onOpen={() => props.onGo({ tab: 'runs', id: r.id })}
                    meta={`${r.id} · ${r.branch} · ${r.kind}`}
                    age={<Elapsed since={r.startedAt} />}
                    extra={
                      <>
                        <StepTrack steps={r.steps} planning={r.kind === 'team' && !r.steps.length} />
                        <span className="run-now">{nowLine(r)}</span>
                      </>
                    }
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
