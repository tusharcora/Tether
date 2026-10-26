import type { RunRow } from '../../api';

export type RunState = 'running' | 'needs' | 'done' | 'failed' | 'idle';

export const RUN_STATE_LABEL: Record<RunState, string> = { running: 'Running', needs: 'Needs you', done: 'Done', failed: 'Failed', idle: 'Queued or paused' };

/** Where a run stands for its glyph: live, waiting on the person (a question, a plan, an approval), done, failed, or neither. */
export function runState(r: Pick<RunRow, 'live' | 'status' | 'pending' | 'planReady'>): RunState {
  if (r.live && !(r.pending > 0) && !r.planReady) return 'running';
  if (r.pending > 0 || r.planReady) return 'needs';
  if (r.status === 'done') return 'done';
  if (r.status === 'error') return 'failed';
  return 'idle';
}

/** `R-1A2B`: the run id's last four characters, as the sidebar shows it. */
export const shortRunId = (id: string): string => `R-${id.slice(-4).toUpperCase()}`;

/**
 * Linear-style status glyphs, which encode state so they stay custom (not lucide): half-filled blue = running, dashed
 * amber = needs you, green check = done, red ✕ = failed, grey ring = queued or paused. The label is the glyph's text.
 */
export function RunGlyph(p: { state: RunState }) {
  const tone = { running: 'var(--acc)', needs: 'var(--warn)', done: 'var(--ok)', failed: 'var(--bad)', idle: 'var(--mut)' }[p.state];
  return (
    <svg className="sl-run-glyph" width="14" height="14" viewBox="0 0 16 16" role="img" aria-label={RUN_STATE_LABEL[p.state]}>
      <circle cx="8" cy="8" r="6.2" fill="none" stroke={tone} strokeWidth="1.6" strokeDasharray={p.state === 'needs' ? '2 2' : undefined} />
      {p.state === 'running' ? <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill={tone} /> : null}
      {p.state === 'done' ? <path d="M5 8.2l2 2 4-4.2" fill="none" stroke={tone} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {p.state === 'failed' ? <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" fill="none" stroke={tone} strokeWidth="1.6" strokeLinecap="round" /> : null}
    </svg>
  );
}
