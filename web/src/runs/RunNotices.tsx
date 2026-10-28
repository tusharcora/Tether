import { useState } from 'react';
import type { RunView } from '../api';
import { InlineError } from '../ui/studio/InlineError';

// shortcut: dismissed Coach findings live in memory for the session only (spec §14.9: no stored state); a reload shows them again
const dismissed = new Set<string>();

/** One-line notices under the run header: the stream error (with retry), the run's error, Coach findings (two, then "and N more"). */
export function RunNotices({ run: r, streamError, onRetryStream }: { run: RunView; streamError?: string; onRetryStream: () => void }) {
  const [, setTick] = useState(0);
  const [more, setMore] = useState(false);
  const coach = (r.coach ?? []).filter((f) => !dismissed.has(`${r.id}:${f.id}`));
  if (!streamError && !r.error && !coach.length) return null;
  const shown = more ? coach : coach.slice(0, 2);
  return (
    <ul className="run-notices" aria-label="Notices">
      {streamError ? (
        <li>
          <InlineError message={streamError} onRetry={onRetryStream} />
        </li>
      ) : null}
      {r.error ? (
        <li className="run-notice bad">
          <span className="run-notice-dot" aria-hidden="true" />
          <span>{r.error.split('\n')[0]}</span>
        </li>
      ) : null}
      {shown.map((f) => (
        <li key={f.id} className="run-notice">
          <span className="run-notice-dot" aria-hidden="true" />
          <span>
            <b>{f.title}</b> {f.detail} <span className="run-notice-action">{f.action}</span>
          </span>
          <button type="button" className="run-notice-x" aria-label="Dismiss" onClick={() => (dismissed.add(`${r.id}:${f.id}`), setTick((n) => n + 1))}>
            ×
          </button>
        </li>
      ))}
      {shown.length < coach.length ? (
        <li>
          <button type="button" className="run-notice-more" onClick={() => setMore(true)}>
            and {coach.length - shown.length} more
          </button>
        </li>
      ) : null}
    </ul>
  );
}
