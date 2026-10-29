import type { RunView } from '../api';
import { Loading } from '../components/Loading';
import { InlineError } from '../ui/studio/InlineError';
import { QuietLine, Section } from '../ui/studio/Section';
import { FileBars } from './FileBars';
import { limitedSteps } from './LimitBar';
import { useDiff } from './useDiff';

/** The steps' commits, so a branch diff refetches only when a step commits. */
export const commitsKey = (r: RunView) => Object.values(r.nodes).map((n) => n.commit ?? '').join(',');

/** The branch's changed files with +/− bars, live as steps commit; a file opens the run's changes. */
export function RunFiles({ run: r, onOpen }: { run: RunView; onOpen: () => void }) {
  const d = useDiff(`/api/runs/${r.id}/diff`, commitsKey(r));
  return (
    <Section title={`Files · branch ${r.branch}`} className="run-files">
      {d.error ? (
        <InlineError message={d.error} onRetry={d.retry} />
      ) : (
        <Loading loading={d.loading} lines={3} label="Loading changed files">
          {d.text ? <FileBars diff={d.text} onOpen={() => onOpen()} openTitle="Open the run's changes" /> : <QuietLine>No committed changes yet.</QuietLine>}
        </Loading>
      )}
      {limitedSteps(r).length ? <QuietLine>Kept in the worktree. Nothing is lost.</QuietLine> : null}
    </Section>
  );
}
