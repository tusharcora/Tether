import type { RunRow } from '../api';
import { Loading } from '../components/Loading';
import type { Poll, Route } from '../hooks';
import { InlineError } from '../ui/studio/InlineError';
import { QuietLine, Section } from '../ui/studio/Section';
import { AgentsRunning } from './AgentsRunning';

/** Live runs (the server's `live` flag) as the agents running card: who works on what, Review for a run that waits, Stop all. */
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
            {!live.length ? <QuietLine>Nothing running.</QuietLine> : <AgentsRunning rows={live} onGo={props.onGo} onChanged={() => void refresh()} />}
          </>
        )}
      </Loading>
    </Section>
  );
}
