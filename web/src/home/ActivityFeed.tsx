import { AsciiReveal } from 'ascii-reveal';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ago, api, type ActivityLine } from '../api';
import { Button } from '../components/arc/button/button';
import { Loading, useReducedMotionPref } from '../components/Loading';
import { Face } from '../Face';
import { pollLoop, type Route } from '../hooks';
import { cn } from '../ui/cn';
import { EmptyState } from '../ui/studio/EmptyState';
import { InlineError } from '../ui/studio/InlineError';
import { Panel } from '../ui/studio/Panel';

export const ACTIVITY_POLL_MS = 3000;
export const ACTIVITY_KEEP = 50;
const DECODE_MAX = 5;

function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/**
 * The activity feed: newest lines first, polled every 3 s while the tab is visible and not paused, resumed from the last
 * cursor. Backoff is usePoll's (`pollLoop`). `ok` turns true after the first success (later failures keep the lines).
 */
export function useActivity(paused: boolean) {
  const [lines, setLines] = useState<ActivityLine[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [ok, setOk] = useState(false);
  const cursor = useRef<string | null>(null);
  const started = useRef(false);
  const fails = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const path = cursor.current ? `/api/activity?since=${encodeURIComponent(cursor.current)}` : `/api/activity?limit=${ACTIVITY_KEEP}`;
      const r = await api<{ lines: ActivityLine[]; cursor: string | null }>('GET', path);
      const first = !started.current;
      started.current = true;
      cursor.current = r.cursor ?? cursor.current;
      fails.current = 0;
      setLines((cur) => {
        const seen = new Set(cur.map((l) => l.id));
        return [...r.lines.filter((l) => !seen.has(l.id)), ...cur].slice(0, ACTIVITY_KEEP);
      });
      setFresh(first ? new Set() : new Set(r.lines.slice(0, DECODE_MAX).map((l) => l.id)));
      setError(undefined);
      setOk(true);
    } catch (e) {
      fails.current++;
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  const visible = useVisible();
  useEffect(() => (paused || !visible ? undefined : pollLoop(refresh, ACTIVITY_POLL_MS, () => fails.current)), [paused, visible, refresh]);

  return { lines, fresh, error, loaded, ok, refresh };
}

const DOT: Record<ActivityLine['kind'], string> = { working: 't-live', needs: 't-needs', done: 't-done', failed: 't-failed', info: '' };

/**
 * Lines decode in with ascii-reveal (at most the newest five, none under reduced motion); screen readers get only the
 * final text. Lines are the server's display lines (ids, bots, step titles, statuses), never free text.
 */
export function ActivityFeed(props: { feed: ReturnType<typeof useActivity>; paused: boolean; onPause: (p: boolean) => void; refreshing: boolean; onGo?: (r: Route) => void }) {
  const { feed, onGo } = props;
  const reduced = useReducedMotionPref();
  const retry = () => void feed.refresh();
  return (
    <Panel
      title="Live activity"
      className="s-activity"
      action={
        <Button variant="ghost" size="sm" onClick={() => props.onPause(!props.paused)}>
          {props.paused ? 'Resume' : 'Pause'}
        </Button>
      }
    >
      <Loading loading={!feed.loaded || props.refreshing} lines={6} label="Loading live activity">
        {feed.error && !feed.ok ? (
          <InlineError message={feed.error} onRetry={retry} />
        ) : (
          <>
            {feed.error ? <InlineError compact message="Couldn't refresh" onRetry={retry} /> : null}
            {!feed.lines.length ? (
              <EmptyState
                title="No activity yet"
                description="Steps starting, finishing and asking show up here as runs work."
                action={
                  onGo ? (
                    <Button variant="secondary" size="sm" onClick={() => onGo({ tab: 'runs' })}>
                      Open Runs
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ol className="act-list" role="log" aria-live="polite" aria-label="Live activity">
                {feed.lines.map((l) => {
                  const isFresh = feed.fresh.has(l.id);
                  return (
                    <li key={l.id} className={cn('act-line', { fresh: isFresh })}>
                      <span className="act-face" aria-hidden="true">
                        {l.bot ? <Face id={l.bot} size={20} /> : <span className={cn('sl-dot act-dot', DOT[l.kind])} />}
                      </span>
                      <span className="act-text">
                        <span className="sl-sr">{l.text}</span>
                        <span aria-hidden="true">
                          {isFresh && !reduced ? (
                            <AsciiReveal as="span" preset="decode" duration="fast">
                              {l.text}
                            </AsciiReveal>
                          ) : (
                            l.text
                          )}
                        </span>
                      </span>
                      <time className="sl-age" dateTime={new Date(l.ts).toISOString()} aria-hidden="true">
                        {ago(l.ts)}
                      </time>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </Loading>
    </Panel>
  );
}
