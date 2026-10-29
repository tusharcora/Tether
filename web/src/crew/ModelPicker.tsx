import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { FREE_DEFAULT, type OrModel } from '../../../src/openrouter';
import { SearchField } from '../components/beui/kit/fields';
import { usePoll } from '../hooks';
import { MODELS_PATH } from '../settings/accountsApi';
import { FreeCounter } from '../settings/FreeModels';
import type { AgentInfo } from './types';

/** The models list changes rarely (the server keeps it an hour). */
const MODELS_MS = 3_600_000;

const ctx = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M ctx` : n >= 1000 ? `${Math.round(n / 1000)}K ctx` : '');
const usd = (n: number) => `$${+n.toFixed(2)}`;
/** The second line of a model row: vendor and what it can do, or why it cannot edit files. */
export const modelMeta = (m: OrModel) => (m.free && !m.tools ? "chat only · can't edit files" : [m.provider, m.tools && 'tools', m.images && 'images', ctx(m.context), m.price && `${usd(m.price.in)} / ${usd(m.price.out)} · 1M`].filter(Boolean).join(' · '));

/**
 * The model for a bot on OpenRouter (free models spec §7.4): Free · OpenRouter, Paid · OpenRouter and Agents & local, a
 * search box and a Free only filter, free / tools / images tags, and the free requests left at the foot. A free model
 * that cannot call tools is dimmed, and picking it for a bot that writes says so (it is still allowed).
 */
export function ModelPicker(p: { value: string; agents: Record<string, AgentInfo>; writes: boolean; onPick: (b: { agent: string; model: string }) => void; defaultOpen?: boolean }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(!!p.defaultOpen);
  const [query, setQuery] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const list = usePoll<{ models: OrModel[]; error?: string }>(MODELS_PATH, MODELS_MS);
  const models = list.data?.models ?? [];
  const chosen = models.find((m) => m.id === p.value);

  // a press outside the panel puts it away
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const q = query.trim().toLowerCase();
  const hit = (m: OrModel) => !q || `${m.name} ${m.id}`.toLowerCase().includes(q);
  // the crew's free default leads its group
  const free = models.filter((m) => m.free && hit(m)).sort((a, b) => Number(b.id === FREE_DEFAULT) - Number(a.id === FREE_DEFAULT));
  const paid = freeOnly ? [] : models.filter((m) => !m.free && hit(m));
  const local = freeOnly ? [] : Object.keys(p.agents).filter((a) => a !== 'openrouter' && a !== 'mock' && (!q || a.includes(q)));
  const pick = (b: { agent: string; model: string }) => {
    p.onPick(b);
    setOpen(false);
    button.current?.focus();
  };

  const row = (m: OrModel) => (
    <li key={m.id}>
      <button type="button" className={`mp-row${m.free && !m.tools ? ' mp-dim' : ''}`} aria-current={m.id === p.value || undefined} onClick={() => pick({ agent: 'openrouter', model: m.id })}>
        <span className="mp-name">
          <b>{m.name}</b>
          <span className="sl-meta">{modelMeta(m)}</span>
        </span>
        {m.free ? <span className="mp-free">free</span> : null}
      </button>
    </li>
  );

  return (
    <div ref={root} className="mp" onKeyDown={(e) => e.key === 'Escape' && open && (e.stopPropagation(), setOpen(false), button.current?.focus())}>
      <span id={`${id}-l`} className="mp-label">
        Model
      </span>
      <button ref={button} type="button" className="mp-pill" aria-labelledby={`${id}-l ${id}-v`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span id={`${id}-v`} className="mp-value">
          {chosen?.name ?? (p.value || 'Choose a model')}
        </span>
        {chosen?.free ? <span className="mp-free">free</span> : null}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {p.writes && chosen?.free && !chosen.tools ? <p className="sl-meta cw-warn">{chosen.name} is chat only and can't edit files: this bot writes, so pick a model tagged tools for it.</p> : null}
      {open ? (
        <div className="mp-panel" role="dialog" aria-label="Choose a model">
          <div className="mp-tools">
            <SearchField label="Search models" placeholder={models.length >= 100 ? `Search ${Math.floor(models.length / 100) * 100}+ models` : 'Search models'} value={query} onValueChange={setQuery} autoFocus />
            <button type="button" className="mp-filter" aria-pressed={freeOnly} onClick={() => setFreeOnly((f) => !f)}>
              Free only
            </button>
          </div>
          {list.error && !models.length ? <p className="acc-note">{list.error}</p> : null}
          <div className="mp-groups">
            {free.length ? (
              <section aria-label="Free · OpenRouter">
                <h3>Free · OpenRouter</h3>
                <ul>{free.map(row)}</ul>
              </section>
            ) : null}
            {paid.length ? (
              <section aria-label="Paid · OpenRouter">
                <h3>Paid · OpenRouter</h3>
                <ul>{paid.map(row)}</ul>
              </section>
            ) : null}
            {local.length ? (
              <section aria-label="Agents & local">
                <h3>Agents &amp; local</h3>
                <ul>
                  {local.map((a) => (
                    <li key={a}>
                      <button type="button" className="mp-row" onClick={() => pick({ agent: a, model: '' })}>
                        <span className="mp-name">
                          <b>{a}</b>
                          <span className="sl-meta">{p.agents[a]!.ok ? (p.agents[a]!.version ?? 'ready') : 'not available'}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {!free.length && !paid.length && !local.length && models.length ? <p className="acc-note">No matching models.</p> : null}
          </div>
          <div className="mp-foot">
            <FreeCounter compact />
          </div>
        </div>
      ) : null}
    </div>
  );
}
