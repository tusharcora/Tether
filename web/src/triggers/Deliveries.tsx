import { useMemo, useRef, useState } from 'react';
import { ago } from '../api';
import { ToolResult, ToolResultOutput } from '../components/beui/agents/tool-result';
import { Button } from '../components/beui/kit/Button';
import { DataTable, type Column } from '../components/beui/kit/DataTable';
import type { Poll } from '../hooks';
import { MenuButton } from '../ui/studio/ToolFrame';
import { InlineError } from '../ui/studio/InlineError';
import { SectionHeading } from '../ui/studio/SectionHeading';
import { StatusBadge } from '../ui/studio/StatusBadge';
import { OUTCOME, type Delivery, type Trigger } from './types';

const time = (d: Delivery) => Date.parse(d.at);
const keyOf = (d: Delivery) => `${d.at}-${d.trigger ?? ''}-${d.pr ?? ''}`;
const NONE_YET: Delivery[] = [];
const what = (d: Delivery) => `${d.repo}${d.pr ? `#${d.pr}` : ''}`;

/** What one delivery says, as the lines a person reads in the detail (never the webhook's secret or payload body). */
const detailOf = (d: Delivery) =>
  [`${OUTCOME[d.outcome].label}: ${what(d)}`, `trigger  ${d.trigger ?? '-'}`, `source   ${d.source}`, `at       ${d.at}`, d.runId ? `run      ${d.runId}` : '', d.reason ? `reason   ${d.reason}` : ''].filter(Boolean).join('\n');

/**
 * Every delivery (including ignored ones) as a sortable table, newest first by default; rows that arrive while you watch slide
 * in once. A row opens its details (what was received and what it did) in a tool result under the table.
 */
export function Deliveries(p: { triggers: Trigger[]; logFor: string; onLogFor: (id: string) => void; log: Poll<Delivery[]> }) {
  const [open, setOpen] = useState<string>();
  const seen = useRef<Set<string> | null>(null);
  const rows = p.log.data ?? NONE_YET;
  // the first answer is history, not news: only rows after it get the slide-in
  const known = seen.current;
  const fresh = new Set(known ? rows.map(keyOf).filter((k) => !known.has(k)) : []);
  if (p.log.data) seen.current = new Set([...(known ?? []), ...rows.map(keyOf)]);
  const columns = useMemo<Column<Delivery>[]>(
    () => [
      { id: 'outcome', header: 'Outcome', sort: (a, b) => a.outcome.localeCompare(b.outcome) || time(b) - time(a), cell: (d) => <StatusBadge tone={OUTCOME[d.outcome].tone} label={OUTCOME[d.outcome].label} /> },
      { id: 'what', header: 'Pull request', sort: (a, b) => what(a).localeCompare(what(b)), cell: (d) => <span className="tg-what">{what(d)}</span> },
      {
        id: 'trigger',
        header: 'Trigger',
        sort: (a, b) => (a.trigger ?? '').localeCompare(b.trigger ?? '') || time(b) - time(a),
        cell: (d) => (
          <span className="tg-delivery-sub">
            <span>
              {d.trigger ?? '-'} · {d.source}
              {!d.runId && d.reason ? (
                <>
                  {' · '}
                  <span className="tg-reason">{d.reason}</span>
                </>
              ) : null}
            </span>
            {d.runId ? <a href={`#/runs/${d.runId}`} onClick={(e) => e.stopPropagation()}>Open the run →</a> : null}
          </span>
        ),
      },
      { id: 'at', header: 'When', align: 'right', sort: (a, b) => time(a) - time(b), cell: (d) => <span className="sl-age" title={d.at}>{ago(time(d))}</span> },
    ],
    [],
  );
  const shown = rows.find((d) => keyOf(d) === open);
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
        <MenuButton title="Show" variant="secondary" label={`${p.logFor || 'all triggers'} ▾`} items={[{ label: 'all triggers', current: !p.logFor, onSelect: () => p.onLogFor('') }, ...p.triggers.map((t) => ({ label: t.id, current: p.logFor === t.id, onSelect: () => p.onLogFor(t.id) }))]} />
      </div>
      {p.log.error && !p.log.data ? (
        <InlineError message={p.log.error} onRetry={() => void p.log.refresh()} />
      ) : rows.length ? (
        <>
          <DataTable<Delivery>
            aria-label="Deliveries"
            className="tg-deliveries"
            columns={columns}
            rows={rows}
            rowKey={keyOf}
            defaultSort={{ id: 'at', dir: 'desc' }}
            rowLabel={(d) => `${what(d)}, ${OUTCOME[d.outcome].label}`}
            selectedKey={open ?? null}
            onRowClick={(d) => setOpen((k) => (k === keyOf(d) ? undefined : keyOf(d)))}
            rowClassName={(d) => (fresh.has(keyOf(d)) ? 'tg-delivery fresh' : 'tg-delivery')}
          />
          {shown ? (
            <ToolResult tool={shown.source} kind="request" title="Delivery details" status={shown.outcome === 'started' ? 'success' : shown.outcome === 'skipped' || shown.outcome === 'ignored' ? 'cancelled' : 'error'} collapseOnComplete={false} maxHeight={220} copyText={detailOf(shown)}>
              <ToolResultOutput language="text">{detailOf(shown)}</ToolResultOutput>
            </ToolResult>
          ) : null}
        </>
      ) : (
        <p className="sl-meta">No deliveries yet</p>
      )}
    </section>
  );
}
