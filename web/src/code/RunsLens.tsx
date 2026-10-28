import { ago } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Loading } from '../components/Loading';
import { cn } from '../ui/cn';
import { RunDiff } from '../ui/RunDiff';
import { InlineError } from '../ui/studio/InlineError';
import { StatusChip, toneFor } from '../ui/studio/StatusChip';
import type { RunTouch } from './codeApi';

/** "Changed by runs": the runs whose commits touched the open file. Picking one marks its lines in the editor and shows its diff. */
export function RunsLens(p: { idle?: boolean; runs?: RunTouch[]; error?: string; onRetry: () => void; selected?: string; onSelect: (runId?: string) => void; onOpenRun: (runId: string) => void }) {
  const sel = p.runs?.find((r) => r.runId === p.selected);
  return (
    <section className="code-lens" aria-labelledby="code-lens-title">
      <div className="code-lens-head">
        <h2 id="code-lens-title">Changed by runs</h2>
        {p.runs ? <span className="sl-meta">{p.runs.length}</span> : null}
      </div>
      {p.idle ? (
        <p className="code-lens-none">Open a file to see which runs changed it.</p>
      ) : p.error ? (
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
                      <StatusChip tone={live ? 'live' : toneFor(r.status)} label={r.status} pulse={live} />
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
    </section>
  );
}
