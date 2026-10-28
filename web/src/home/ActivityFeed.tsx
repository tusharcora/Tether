import { AsciiReveal } from 'ascii-reveal';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ActivityLine } from '../api';
import { Loading, useReducedMotionPref } from '../components/Loading';
import { pollLoop } from '../hooks';
import { cn } from '../ui/cn';
import { InlineError } from '../ui/studio/InlineError';
import { QuietLine, Section } from '../ui/studio/Section';

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

export const ACTIVITY_SHOW = 8;
export interface ActivityGroup {
  id: string;
  ts: number;
  runId: string;
  text: string;
  kind: ActivityLine['kind'];
  bot?: string;
  count: number;
  /** A single line's step or run name; merged lines have none. */
  who?: string;
}

/** What happened, without the step's name and the details: "Bolt finished · $0.10" → "finished". */
export function verbOf(l: ActivityLine): string {
  const t = l.text.startsWith(`${l.who} `) ? l.text.slice(l.who.length + 1) : l.text;
  return t.split(' · ')[0]!;
}

/** One line of the feed: `all` merged neighbours, shown `rep` times in a row (a repeated retry cycle). */
function show(all: ActivityLine[], rep: number, count: number): ActivityGroup {
  const l = all[0]!;
  const base = { id: l.id, ts: l.ts, runId: l.runId, kind: l.kind, count, ...(l.bot ? { bot: l.bot } : {}) };
  const times = rep > 1 ? ` ×${rep}` : '';
  if (all.length === 1) return { ...base, text: l.text + times, who: l.who };
  if (all.every((x) => x.text.startsWith(`${x.who} `))) return { ...base, text: `${all.length} steps ${verbOf(l)}${times}` };
  return { ...base, text: `${verbOf(l)} ×${all.length * rep}` };
}

/**
 * Newest first, neighbours of the same kind and verb merged into one line ("3 steps skipped", "run started ×2"), and a
 * block of lines that repeats right after itself in the same run (a retry cycle) folded into its newest occurrence
 * ("run resumed ×2"), so the feed never shows the same lines twice; at most `max` lines. A merged line takes the newest
 * line's id, time and face.
 */
export function collapseActivity(lines: ActivityLine[], max = ACTIVITY_SHOW): ActivityGroup[] {
  const runs: ActivityLine[][] = [];
  for (const l of lines) {
    const last = runs.at(-1);
    if (last && last[0]!.kind === l.kind && verbOf(last[0]!) === verbOf(l)) last.push(l);
    else runs.push([l]);
  }
  const key = runs.map((all) => `${all[0]!.runId}\n${all[0]!.kind}\n${show(all, 1, 0).text}`);
  // runs[a..a+k) and runs[b..b+k) are the same block
  const same = (a: number, b: number, k: number) => b + k <= runs.length && key.slice(a, a + k).join('\0') === key.slice(b, b + k).join('\0');
  const out: ActivityGroup[] = [];
  for (let i = 0; i < runs.length && out.length < max; ) {
    let k = 1;
    while (i + 2 * k <= runs.length && !same(i, i + k, k)) k++;
    if (i + 2 * k > runs.length) {
      out.push(show(runs[i]!, 1, runs[i]!.length));
      i++;
      continue;
    }
    let rep = 2;
    while (same(i, i + rep * k, k)) rep++;
    for (let j = 0; j < k; j++) out.push(show(runs[i + j]!, rep, Array.from({ length: rep }, (_, r) => runs[i + r * k + j]!.length).reduce((a, b) => a + b)));
    i += rep * k;
  }
  return out.slice(0, max);
}

/**
 * At most eight lines, repeats collapsed, each with its HH:MM and the step's name in 500 weight. New lines decode in with
 * ascii-reveal (at most the newest five, none under reduced motion); screen readers get only the final text. Lines are
 * the server's display lines (ids, bots, step titles, statuses), never free text.
 */
export function ActivityFeed(props: { feed: ReturnType<typeof useActivity> }) {
  const { feed } = props;
  const reduced = useReducedMotionPref();
  const retry = () => void feed.refresh();
  return (
    <Section title="Activity" live>
      <Loading loading={!feed.loaded} lines={6} label="Loading activity">
        {feed.error && !feed.ok ? (
          <InlineError message={feed.error} onRetry={retry} />
        ) : (
          <>
            {feed.error ? <InlineError compact message="Couldn't refresh" onRetry={retry} /> : null}
            {!feed.lines.length ? (
              <QuietLine>No activity yet.</QuietLine>
            ) : (
              <ol className="act-list" role="log" aria-live="polite" aria-label="Activity">
                {collapseActivity(feed.lines).map((g) => {
                  const isFresh = feed.fresh.has(g.id);
                  // a step line starts with the step's name: that name goes in 500 weight
                  const rest = g.who && g.text.startsWith(`${g.who} `) ? g.text.slice(g.who.length + 1) : undefined;
                  const what = rest ?? g.text;
                  return (
                    <li key={g.id} className={cn('act-line', { fresh: isFresh })}>
                      <time className="act-tm" dateTime={new Date(g.ts).toISOString()} aria-hidden="true">
                        {new Date(g.ts).toTimeString().slice(0, 5)}
                      </time>
                      <span className="act-text">
                        <span className="sl-sr">{g.text}</span>
                        <span aria-hidden="true">
                          {rest !== undefined ? <><b className="act-who">{g.who}</b> </> : null}
                          <span className={cn('act-what', `k-${g.kind}`)}>
                            {isFresh && !reduced ? (
                              <AsciiReveal as="span" preset="decode" duration="fast">
                                {what}
                              </AsciiReveal>
                            ) : (
                              what
                            )}
                          </span>
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </Loading>
    </Section>
  );
}
