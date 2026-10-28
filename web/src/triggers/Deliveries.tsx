import { useRef, useState } from 'react';
import { ago } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Select } from '../components/beui/kit/fields';
import type { Poll } from '../hooks';
import { NONE, cn, fromNone } from '../ui/cn';
import { InlineError } from '../ui/studio/InlineError';
import { SectionHeading } from '../ui/studio/SectionHeading';
import { StatusChip } from '../ui/studio/StatusChip';
import { OUTCOME, type Delivery, type Trigger } from './types';

type Sort = 'new' | 'old' | 'trigger' | 'outcome';
const time = (d: Delivery) => Date.parse(d.at);
const SORTS: Record<Sort, (a: Delivery, b: Delivery) => number> = {
  new: (a, b) => time(b) - time(a),
  old: (a, b) => time(a) - time(b),
  trigger: (a, b) => (a.trigger ?? '').localeCompare(b.trigger ?? '') || time(b) - time(a),
  outcome: (a, b) => a.outcome.localeCompare(b.outcome) || time(b) - time(a),
};
const keyOf = (d: Delivery) => `${d.at}-${d.trigger ?? ''}-${d.pr ?? ''}`;
const NONE_YET: Delivery[] = [];

/** Every delivery (including ignored ones), newest first by default; rows that arrive while you watch slide in once. */
export function Deliveries(p: { triggers: Trigger[]; logFor: string; onLogFor: (id: string) => void; log: Poll<Delivery[]> }) {
  const [sort, setSort] = useState<Sort>('new');
  const seen = useRef<Set<string> | null>(null);
  const rows = [...(p.log.data ?? NONE_YET)].sort(SORTS[sort]);
  // the first answer is history, not news: only rows after it get the slide-in
  const known = seen.current;
  const fresh = new Set(known ? rows.map(keyOf).filter((k) => !known.has(k)) : []);
  if (p.log.data) seen.current = new Set([...(known ?? []), ...rows.map(keyOf)]);
  return (
    <section className="tg-log" aria-label="Delivery log">
      <SectionHeading
        title="Deliveries"
        count={rows.length}
        action={
          <Button variant="ghost" size="sm" onClick={() => void p.log.refresh()}>
            Refresh
          </Button>
        }
      />
      <div className="tg-log-tools">
        <Select label="Show" value={p.logFor || NONE} onValueChange={(v) => p.onLogFor(fromNone(v))} options={[{ value: NONE, label: 'all triggers' }, ...p.triggers.map((t) => ({ value: t.id, label: t.id }))]} />
        <Select
          label="Sort by"
          value={sort}
          onValueChange={(v) => setSort(v as Sort)}
          options={[
            { value: 'new', label: 'Newest first' },
            { value: 'old', label: 'Oldest first' },
            { value: 'trigger', label: 'Trigger' },
            { value: 'outcome', label: 'Outcome' },
          ]}
        />
      </div>
      {p.log.error && !p.log.data ? (
        <InlineError message={p.log.error} onRetry={() => void p.log.refresh()} />
      ) : rows.length ? (
        <ul className="sl-list tg-deliveries">
          {rows.map((d) => (
            <li key={keyOf(d)} className={cn('tg-delivery', { fresh: fresh.has(keyOf(d)) })}>
              <div className="tg-delivery-top">
                <StatusChip tone={OUTCOME[d.outcome].tone} label={OUTCOME[d.outcome].label} />
                <span className="tg-what">
                  {d.repo}
                  {d.pr ? `#${d.pr}` : ''}
                </span>
                <span className="sl-age" title={d.at}>
                  {ago(time(d))}
                </span>
              </div>
              <div className="tg-delivery-sub">
                <span>
                  {d.trigger ?? '-'} · {d.source}
                  {!d.runId && d.reason ? (
                    <>
                      {' · '}
                      <span className="tg-reason">{d.reason}</span>
                    </>
                  ) : null}
                </span>
                {d.runId ? <a href={`#/runs/${d.runId}`}>Open the run →</a> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sl-meta">No deliveries yet</p>
      )}
    </section>
  );
}
