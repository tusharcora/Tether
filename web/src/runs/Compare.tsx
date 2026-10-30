import { useState } from 'react';
import { api, fmtDur, fmtUsd, type AttemptsReply, type AttemptView } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Loading } from '../components/Loading';
import { useCrew } from '../crewStore';
import { Face, moodFor } from '../Face';
import { taskTitle } from '../home/runText';
import { usePoll, type Route } from '../hooks';
import { cn } from '../ui/cn';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import { pickLabel } from './TryMore';

/** The check row: "passes · 41 tests", "2 tests fail", "fails", or none yet. */
export function checkText(a: Pick<AttemptView, 'check'>): { text: string; ok?: boolean } {
  const c = a.check;
  if (!c) return { text: 'no check yet' };
  if (c.ok) return { text: c.passing !== undefined ? `passes · ${c.passing} test${c.passing === 1 ? '' : 's'}` : 'passes', ok: true };
  return { text: c.failing ? `${c.failing} test${c.failing === 1 ? '' : 's'} fail` : 'fails', ok: false };
}

const failed = (a: AttemptView) => a.status === 'error';

/**
 * Compare attempts (board 5, `#/attempts/<set>`): one column per attempt with its agent and model, its check, the goal's
 * metric when there is one, its changes, cost and time, its review and a few changed lines; Tether's pick is marked but
 * never shipped on its own. Pick X and ship ships it (and stops the rest); a failed attempt can be retried; Try 1 more way
 * adds another.
 */
export function Compare({ set, onGo }: { set: string; onGo: (r: Route) => void }) {
  const notify = useNotify();
  const { crew } = useCrew();
  const poll = usePoll<AttemptsReply>(`/api/attempts/${encodeURIComponent(set)}`, 3000);
  const [busy, setBusy] = useState<string>();
  const d = poll.data;
  const act = async (key: string, f: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await f();
      if (ok) notify.ok(ok);
      await poll.refresh();
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(undefined);
    }
  };
  if (!d) return <div className="cmp">{poll.error ? <InlineError message={poll.error} onRetry={() => void poll.refresh()} /> : <Loading loading lines={4} label="Loading attempts" />}</div>;
  const title = taskTitle({ task: d.task, kind: 'workflow', pipeline: '' });
  const passing = d.runs.filter((a) => a.check?.ok).length;
  const total = d.runs.reduce((s, a) => s + a.costUsd, 0);
  const longest = Math.max(0, ...d.runs.map((a) => a.durationMs));
  const first = d.runs[0]!;
  const pickedLabel = d.picked ? d.runs.find((a) => a.id === d.picked!.run)?.label : undefined;
  const nameOf = (bot: string) => crew[bot]?.name ?? bot;
  return (
    <div className="cmp">
      <nav className="rp-crumbs" aria-label="Breadcrumb">
        <button type="button" className="rp-link" onClick={() => onGo({ tab: 'runs' })}>
          ← Runs
        </button>
        <span aria-hidden="true">/</span>
        <span>{title}</span>
      </nav>
      <header className="cmp-head">
        <h1>{title}</h1>
        <span className="rp-chip">{`${d.runs.length} attempts`}</span>
        {passing ? <span className="rp-chip ok">{`${passing} pass${passing === 1 ? 'es' : ''} the check`}</span> : null}
        <span className="rp-gap" />
        <span className="mono cmp-total">{`${fmtUsd(total)} total · ${fmtDur(longest)}`}</span>
        {!d.picked ? (
          <Button variant="secondary" size="sm" loading={busy === 'more'} onClick={() => void act('more', () => api('POST', `/api/runs/${encodeURIComponent(first.id)}/attempts`, { count: 1 }), 'Started one more way')}>
            Try 1 more way
          </Button>
        ) : null}
      </header>
      <p className="cmp-note">{pickedLabel ? `You picked ${pickedLabel}. The others are kept for a week, then cleaned up.` : `Same task, ${d.runs.length} ways, each on its own branch. Pick the one to ship; the others are kept for a week, then cleaned up.`}</p>
      <div className="cmp-cols">
        {d.runs.map((a) => {
          const check = checkText(a);
          const isPick = d.pick === a.id && !d.picked;
          const picked = d.picked?.run === a.id;
          const bot = nameOf(a.bot);
          return (
            <section key={a.id} className={cn('cmp-col', (isPick || picked) && 'pick', failed(a) && 'dim')} aria-label={`Attempt ${a.label}`}>
              <div className="cmp-who">
                <Face id={a.bot} size={24} mood={moodFor(a.live ? 'running' : a.status)} animate={a.live ? 'always' : undefined} />
                <span className="cmp-name">
                  <b>{`${a.label} · ${bot}`}</b>
                  <span>{pickLabel({ agent: a.agent, model: a.model })}</span>
                </span>
                {picked ? <span className="rp-chip ok">Picked</span> : isPick ? <span className="rp-chip ok">Tether’s pick</span> : failed(a) ? <span className="rp-chip bad">Failed</span> : a.live ? <span className="rp-chip live">Working</span> : null}
              </div>
              <dl className="rp-dl cmp-dl">
                <dt>Check</dt>
                <dd className={check.ok === true ? 'ok' : check.ok === false ? 'bad' : undefined}>{check.text}</dd>
                {a.metric ? (
                  <>
                    <dt>Goal metric</dt>
                    <dd>{a.metric.before !== undefined && a.metric.after !== undefined ? `${a.metric.before} → ${a.metric.after}` : String(a.metric.after ?? a.metric.before)}</dd>
                  </>
                ) : null}
                <dt>Changes</dt>
                <dd className="mono">
                  {`${a.files} file${a.files === 1 ? '' : 's'} · `}
                  <span className="ok">{`+${a.added}`}</span> <span className="bad">{`−${a.deleted}`}</span>
                </dd>
                <dt>Cost · time</dt>
                <dd>{`${fmtUsd(a.costUsd)} · ${fmtDur(a.durationMs)}`}</dd>
                {failed(a) && a.error ? (
                  <>
                    <dt>Why</dt>
                    <dd>{a.error}</dd>
                  </>
                ) : a.review ? (
                  <>
                    <dt>Review</dt>
                    <dd>{`${nameOf(a.review.bot)}: ${a.review.line}`}</dd>
                  </>
                ) : null}
              </dl>
              {a.excerpt ? (
                <div className="cmp-diff" aria-label={`A few changed lines in ${a.excerpt.file}`}>
                  <span className="cmp-ln file">{a.excerpt.file}</span>
                  {a.excerpt.lines.map((l, i) => (
                    <span key={i} className={cn('cmp-ln', l.startsWith('+') ? 'add' : 'del')}>
                      {l}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="cmp-actions">
                {failed(a) ? (
                  <Button variant="ghost" size="sm" loading={busy === `retry:${a.id}`} disabled={!!d.picked} onClick={() => void act(`retry:${a.id}`, () => api('POST', `/api/runs/${encodeURIComponent(a.id)}/resume`, { retryFailed: true }))}>
                    {`Retry ${a.label}`}
                  </Button>
                ) : !d.picked ? (
                  <Button variant={isPick ? 'primary' : 'secondary'} size="sm" loading={busy === `pick:${a.id}`} disabled={a.live || !!busy} onClick={() => void act(`pick:${a.id}`, () => api('POST', `/api/attempts/${encodeURIComponent(set)}/pick`, { run: a.id }), `Picked ${a.label}: its PR opens when it is done`)}>
                    {`Pick ${a.label} and ship`}
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => onGo({ tab: 'runs', id: a.id })}>
                  Open
                </Button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
