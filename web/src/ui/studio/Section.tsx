import { ChevronRight } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/beui/motion/collapsible';
import { cn } from '../cn';
import './parts.css';

/** A section as the demo draws it: a 12 px muted label (count chip, live dot), then its content (usually one RowList). */
export function Section(p: { title: string; count?: number; live?: boolean; action?: ReactNode; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={cn('sl-section', p.className)} aria-labelledby={id}>
      <h2 className="sl-sec">
        <span id={id} className="sl-sec-title">{p.title}</span>
        {p.count !== undefined ? <span className="sl-sec-count">{p.count}</span> : null}
        {p.live ? <span className="sl-dot pulse" aria-hidden="true" /> : null}
        {p.action ? <span className="sl-sec-action">{p.action}</span> : null}
      </h2>
      {p.children}
    </section>
  );
}

/** One bordered list whose ListRows are split by hairlines. */
export const RowList = (p: { label?: string; children: ReactNode }) => (
  <ul className="sl-rows" aria-label={p.label}>
    {p.children}
  </ul>
);

/** An empty section: one quiet line, never an icon tile. */
export const QuietLine = (p: { children: ReactNode }) => <p className="sl-quiet">{p.children}</p>;

export const Tag = (p: { children: ReactNode; title?: string }) => (
  <span className="sl-tag" title={p.title}>
    {p.children}
  </span>
);

/** A collapsed row ("Planning · 5 answers") that opens its content in place. */
export function Disclosure(p: { label: string; meta?: string; children: ReactNode; className?: string }) {
  return (
    <Collapsible className={p.className}>
      <CollapsibleTrigger render={<button type="button" className="sl-disclosure" />}>
        <ChevronRight className="sl-disclosure-chev" aria-hidden="true" />
        <span>{p.meta ? `${p.label} · ${p.meta}` : p.label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>{p.children}</CollapsibleContent>
    </Collapsible>
  );
}
