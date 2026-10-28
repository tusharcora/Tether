import { ago } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Loading } from '../components/Loading';
import { cn } from '../ui/cn';
import { RunDiff } from '../ui/RunDiff';
import { InlineError } from '../ui/studio/InlineError';
import { StatusBadge } from '../ui/studio/StatusBadge';
import type { RunTouch } from './codeApi';

/** The runs whose commits touched the open file (in Code's dock, which names it). Picking one marks its lines in the editor and shows its diff. */
export function RunsLens(p: { runs?: RunTouch[]; error?: string; onRetry: () => void; selected?: string; onSelect: (runId?: string) => void; onOpenRun: (runId: string) => void }) {
  const sel = p.runs?.find((r) => r.runId === p.selected);
  return (
    <div className="code-lens">
      {p.error ? (
        <InlineError message={p.error} onRetry={p.onRetry} />
      ) : (
        <Loading loading={!p.runs} lines={3} label="Loading the runs that changed this file">
          {p.runs && !p.runs.length ? <p className="code-lens-none">No run has changed this file yet.</p> : null}
          <ul className="code-lens-list">
            {p.runs?.map((r) => {
              const on = r.runId === p.selected;
              const live = r.live && r.status === 'running';
              return (
                <li key={r.runId}>
                  <button type="button" className={cn('code-lens-run', { on })} aria-pressed={on} onClick={() => p.onSelect(on ? undefined : r.runId)}>
                    <b>{r.title}</b>
                    <span className="code-lens-meta">
                      <StatusBadge desc={{ of: 'run', status: r.status, live, waiting: false }} />
                      {r.label} · {ago(r.at)}
                    </span>
                    <span className="code-lens-count">
                      <span className="add">+{r.add}</span> <span className="del">−{r.del}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Loading>
      )}
      {sel ? (
        <div className="code-lens-diff">
          <div className="code-lens-diff-head">
            <span>diff · {sel.runId}</span>
            <Button size="sm" variant="secondary" onClick={() => p.onOpenRun(sel.runId)}>
              Open run
            </Button>
          </div>
          <RunDiff text={sel.patch} />
        </div>
      ) : null}
    </div>
  );
}
