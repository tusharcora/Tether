import { useState } from 'react';
import type { Allowance } from '../../../src/openrouter';
import { contextView, foldable, KEEP, latestContext, MIN_FOLD, type ContextView, type PartKey } from '../../../src/assistant/context';
import { clock } from '../api';
import { MorphPopover, MorphPopoverContent, MorphPopoverTrigger } from '../components/beui/motion/popover-morph';
import { usePoll } from '../hooks';
import { ALLOWANCE_MS, ALLOWANCE_PATH } from '../settings/accountsApi';
import { cn } from '../ui/cn';
import { useNotify } from '../ui/notify';
import type { Assistant } from './useAssistant';

const SWATCH: Record<PartKey, string> = { prompt: 'bg-sky-300', tools: 'bg-emerald-400', memory: 'bg-amber-400', messages: 'bg-blue-600', reserved: 'bg-zinc-500', free: 'border border-border bg-surface-3' };
/** 6.2k, 104k: tokens as the popover writes them. */
export const kTok = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k`);
const R = 7;
const C = 2 * Math.PI * R;

/** The free-tier limit that applies to the answering model: OpenRouter's daily free requests, NVIDIA's per-minute pace. */
function Limit({ kind }: { kind: 'openrouter' | 'nvidia' }) {
  const or = usePoll<Allowance>(kind === 'openrouter' ? ALLOWANCE_PATH : null, ALLOWANCE_MS);
  if (kind === 'nvidia')
    return (
      <div className="flex">
        <span className="text-muted-foreground">NVIDIA</span>
        <b className="ml-1.5 font-medium">about 40 a minute</b>
      </div>
    );
  const a = or.data;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex">
        <span className="text-muted-foreground">OpenRouter free</span>
        <b className="ml-1.5 font-medium">{a ? `${a.used} of ${a.limit}` : or.error ? "can't read the count" : '…'}</b>
        <span className="flex-1" />
        {a ? <span className="text-muted-foreground">resets {clock(a.resetsAt)}</span> : null}
      </span>
      {a ? (
        <span className="h-1 rounded-full bg-surface-3" role="meter" aria-label="Free requests used today" aria-valuemin={0} aria-valuemax={a.limit} aria-valuenow={a.used}>
          <span className="block h-1 rounded-full bg-live" style={{ width: `${a.limit ? Math.round((100 * a.used) / a.limit) : 0}%` }} />
        </span>
      ) : null}
    </div>
  );
}

/**
 * The context ring beside dictate (spec §6.2, board 2): how full the answering model's context was on the last turn, and
 * a popover with the parts, the free-tier limits, Compact now and Undo. No ring when the model's size is unknown.
 */
export function ContextRing({ chat }: { chat: Assistant }) {
  const latest = latestContext(chat.messages);
  const v = latest && contextView(latest.use);
  return latest && v ? <Ring chat={chat} latest={latest} v={v} /> : null;
}

function Ring({ chat, latest, v }: { chat: Assistant; latest: NonNullable<ReturnType<typeof latestContext>>; v: ContextView }) {
  const notify = useNotify();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PartKey>();
  const summary = latest.summary ? chat.messages.findLast((m) => m.compact && !m.compactedBy) : undefined;
  const canCompact = foldable(chat.messages).length >= MIN_FOLD && !chat.streaming;
  const shown = v.parts.find((p) => p.key === detail);
  const run = (undo: boolean) => void chat.compact(undo).catch(notify.fail);
  const warn = v.pct >= 90;
  return (
    <MorphPopover open={open} onOpenChange={setOpen}>
      <MorphPopoverTrigger>
        <button type="button" className="aic-pill w-9 justify-center" aria-label={`Context ${v.pct}% used`} title={`Context ${v.pct}% used`}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="9" cy="9" r={R} fill="none" stroke="var(--edge)" strokeWidth="2.5" />
            <circle cx="9" cy="9" r={R} fill="none" stroke={warn ? 'var(--warn)' : 'var(--acc)'} strokeWidth="2.5" strokeDasharray={`${(C * v.pct) / 100} ${C}`} transform="rotate(-90 9 9)" />
          </svg>
        </button>
      </MorphPopoverTrigger>
      <MorphPopoverContent side="top" align="end" radius={14}>
        <div className="flex w-[340px] max-w-[calc(100vw-32px)] flex-col text-[13px]" role="group" aria-label="Context window">
          <div className="flex flex-col gap-2.5 px-4 pt-3.5 pb-3">
            <div className="flex items-baseline text-sm">
              <span className="text-muted-foreground">Context</span>
              <b className="ml-1.5 font-semibold">{v.pct}%</b>
              <span className="flex-1" />
              <span className="font-mono text-xs text-muted-foreground">
                {v.about ? 'about ' : ''}
                {kTok(v.used)} of {kTok(v.size)} · {latest.use.model ?? latest.use.agent}
              </span>
            </div>
            <div className="flex h-2 gap-0.5" aria-hidden="true">
              {v.parts.map((p) => (
                <span key={p.key} className={cn('block h-2 rounded-[3px] transition-opacity', SWATCH[p.key], detail && detail !== p.key && 'opacity-35')} style={{ width: `${(p.tokens / v.size) * 100}%` }} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-3.5 gap-y-0.5">
              {v.parts.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className="flex cursor-default items-center gap-2 rounded-md border-0 bg-transparent px-1 py-0.5 text-left font-[inherit] text-[13px] text-foreground hover:bg-muted"
                  aria-expanded={detail === p.key}
                  onMouseEnter={() => setDetail(p.key)}
                  onMouseLeave={() => setDetail(undefined)}
                  onFocus={() => setDetail(p.key)}
                  onBlur={() => setDetail(undefined)}
                >
                  <span className={cn('size-[9px] flex-none rounded-[3px]', SWATCH[p.key])} />
                  <span className={cn('flex-1', detail && detail !== p.key && 'text-muted-foreground')}>{p.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{kTok(p.tokens)}</span>
                </button>
              ))}
            </div>
            {shown ? (
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted px-3 py-2 text-xs" aria-live="polite">
                <b className="font-medium">
                  {shown.label} · {v.about ? 'about ' : ''}
                  {kTok(shown.tokens)}
                </b>
                {shown.items.map(([n, t]) => (
                  <span key={n} className="flex gap-1.5">
                    <span className="flex-1 text-muted-foreground">{n}</span>
                    <span className="font-mono">{kTok(t)}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {latest.use.limit ? (
            <div className="flex flex-col gap-2.5 border-t border-border px-4 py-3">
              <Limit kind={latest.use.limit} />
            </div>
          ) : null}
          <div className="flex items-center gap-2.5 border-t border-border py-2.5 pr-3 pl-4">
            <span className="flex-1 text-muted-foreground" aria-live="polite">
              {chat.compacting ? 'Summarizing older messages…' : summary?.compact ? `Compacted: ${summary.compact.count} messages → summary + last ${KEEP}` : `${kTok(v.untilAuto)} until auto-compact`}
            </span>
            {summary && !chat.compacting ? (
              <button type="button" className="h-[30px] cursor-pointer rounded-lg border-0 bg-muted px-3 font-[inherit] text-[13px] text-muted-foreground" onClick={() => run(true)}>
                Undo
              </button>
            ) : (
              <button
                type="button"
                className="h-[30px] cursor-pointer rounded-lg border-0 bg-live/15 px-3 font-[inherit] text-[13px] font-medium text-live-foreground disabled:cursor-default disabled:bg-muted disabled:text-muted-foreground"
                disabled={!canCompact || chat.compacting}
                title={canCompact ? undefined : 'Nothing to compact yet'}
                onClick={() => run(false)}
              >
                {chat.compacting ? 'Compacting…' : 'Compact now'}
              </button>
            )}
          </div>
        </div>
      </MorphPopoverContent>
    </MorphPopover>
  );
}
