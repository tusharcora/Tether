import { Check, ChevronRight, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LinkPreview } from '../components/assistant-ui/elements/link-preview';
import { WebSearch } from '../components/assistant-ui/elements/web-search';
import { hostOf } from '../components/assistant-ui/utils/href';
import { ToolChip } from '../ui/studio/Section';
import { cn } from '../ui/cn';
import type { ToolRun } from './api';
import { searchLinks, thinkingSummary, timeline, webCall, type Step } from './timeline';

const CHIPS = 4;
const secs = (ms: number) => Math.max(1, Math.round(ms / 1000));

function Mark({ s }: { s: Step }) {
  if (s.live) return <span className="th-spin block size-3 rounded-full border-2 border-border border-t-foreground" />;
  if (s.dead) return <X className="size-3 text-muted-foreground" strokeWidth={2.4} />;
  if (s.kind === 'search') return <Search className="size-3.5 text-muted-foreground" strokeWidth={2.2} />;
  return <span className="block size-[7px] rounded-full bg-muted-foreground" />;
}

/** A web step's searches (query and the results that came back) and the pages it read (titled when a search found them). */
function WebViews({ s, tools }: { s: Step; tools: ToolRun[] }) {
  const titles = new Map(tools.flatMap((t) => searchLinks(t.output)).map((l) => [l.url, l.title]));
  return s.runs.map((t) => {
    const call = webCall(t.code);
    if (call && 'url' in call) return <LinkPreview key={t.id} layout="compact" href={call.url} title={titles.get(call.url)} />;
    // a search with no result kept (an older chat) shows its label alone
    if (!call || (t.output === undefined && !s.live)) return null;
    const links = searchLinks(t.output);
    return <WebSearch key={t.id} query={call.search} results={links.map((l) => ({ title: l.title, domain: hostOf(l.url) ?? l.url }))} visibleResults={links.length} searching={t.output === undefined} cycle={0} />;
  });
}

/**
 * What Tether did while answering (spec §6.1, board 1): "Thinking 4s" with the steps as they come while the answer streams,
 * then "Thought for 14s", collapsed, with a final Finished thinking row. `startedAt` while streaming; `ms` once finished.
 */
export function Thinking(p: { tools: ToolRun[]; startedAt?: number; ms?: number }) {
  const streaming = p.startedAt !== undefined;
  const [open, setOpen] = useState(streaming);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!streaming) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [streaming]);
  const steps = timeline(p.tools, streaming);
  const elapsed = streaming ? Math.max(0, Math.floor((now - p.startedAt!) / 1000)) : undefined;
  return (
    <div className="mb-2 flex flex-col text-sm" data-thinking={streaming ? 'live' : 'done'}>
      <button type="button" className="flex cursor-pointer items-center gap-2 self-start border-0 bg-transparent p-0 pb-2 text-left font-[inherit] text-foreground" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden="true" />
        {streaming ? (
          <>
            <span>Thinking</span>
            {/* the timer stays silent: announcing every second would drown the steps */}
            <span className="text-muted-foreground tabular-nums">{elapsed}s</span>
          </>
        ) : (
          <span className="text-muted-foreground">Thought for {secs(p.ms ?? 0)}s</span>
        )}
      </button>
      {open ? (
        <ol className="relative m-0 flex list-none flex-col gap-3 p-0 pl-7" aria-label="Thinking steps" aria-live={streaming ? 'polite' : undefined}>
          <span className="absolute top-2 bottom-2 left-2 w-px bg-border" aria-hidden="true" />
          {steps.map((s) => (
            <li key={s.id} className={cn('th-in relative flex flex-col gap-2', s.dead && 'ml-5')} data-step={s.dead ? 'dead' : s.live ? 'live' : 'done'}>
              <span className={cn('absolute top-0.5 flex size-4 items-center justify-center bg-background', s.dead ? '-left-12' : '-left-7')} aria-hidden="true">
                <Mark s={s} />
              </span>
              <span className={cn(s.live ? 'th-shimmer' : s.dead ? 'text-muted-foreground' : 'text-foreground')}>
                {s.label}
                {s.calls > 1 ? <span className="text-muted-foreground"> · {s.calls} calls</span> : null}
              </span>
              {s.chips.length ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  {s.chips.slice(0, CHIPS).map((c) => (
                    <ToolChip key={`${c.kind}:${c.title ?? c.label}`} label={c.label} mark={c.mark} title={c.title} />
                  ))}
                  {s.chips.length > CHIPS ? <span className="text-xs text-muted-foreground">+{s.chips.length - CHIPS} more</span> : null}
                </span>
              ) : null}
              {s.kind === 'web' && !s.dead ? <WebViews s={s} tools={p.tools} /> : null}
            </li>
          ))}
          {!streaming ? (
            <li className="th-in relative" data-step="finished">
              <span className="absolute top-0.5 -left-7 flex size-4 items-center justify-center rounded-full bg-success text-background" aria-hidden="true">
                <Check className="size-2.5" strokeWidth={3} />
              </span>
              <span className="font-medium text-foreground">Finished thinking</span>
              <span className="text-muted-foreground"> · {thinkingSummary(p.tools)}</span>
            </li>
          ) : null}
        </ol>
      ) : null}
    </div>
  );
}
