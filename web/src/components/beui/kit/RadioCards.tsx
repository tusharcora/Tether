import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Card } from '../motion/card';
import { SPRING_PRESS } from '../lib/ease';
import { cn } from '../lib/utils';

export interface RadioCardOption { value: string; label: ReactNode; description?: ReactNode; disabled?: boolean }
export interface RadioCardsProps {
  options: RadioCardOption[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string) => void;
  layout?: 'grid' | 'list';
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** A few choices that each need a sentence: beui cards in a radiogroup. One tab stop; arrows move and choose; the chosen card is outlined in ink. */
export function RadioCards({ options, value, defaultValue = null, onValueChange, layout = 'grid', disabled = false, className, 'aria-label': ariaLabel }: RadioCardsProps) {
  const uid = useId();
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const [inner, setInner] = useState<string | null>(defaultValue);
  const selected = value !== undefined ? value : inner;
  const usable = (o: RadioCardOption) => !disabled && !o.disabled;
  const at = options.findIndex((o) => o.value === selected);
  const stop = at >= 0 && usable(options[at]!) ? at : options.findIndex(usable);
  const choose = (v: string) => {
    if (v === selected) return;
    if (value === undefined) setInner(v);
    onValueChange?.(v);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (usable(options[i]!)) choose(options[i]!.value);
      return;
    }
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const n = options.length;
    let k = e.key === 'Home' ? -1 : e.key === 'End' ? n : i;
    const dir = e.key === 'Home' ? 1 : e.key === 'End' ? -1 : step;
    for (let t = 0; t < n; t++) {
      k = (k + dir + n) % n;
      if (usable(options[k]!)) {
        root.current?.querySelectorAll<HTMLElement>('[data-card]')[k]?.focus();
        choose(options[k]!.value);
        return;
      }
    }
  };
  return (
    <div ref={root} role="radiogroup" aria-label={ariaLabel} aria-disabled={disabled || undefined} className={cn('grid gap-2', layout === 'grid' && 'grid-cols-[repeat(auto-fit,minmax(180px,1fr))]', className)}>
      {options.map((o, i) => {
        const on = i === at;
        const off = !usable(o);
        const labelId = `${uid}-${i}-label`;
        const descId = `${uid}-${i}-desc`;
        return (
          <motion.div
            key={o.value}
            role="radio"
            data-card={i}
            aria-checked={on}
            aria-disabled={off || undefined}
            aria-labelledby={labelId}
            aria-describedby={o.description ? descId : undefined}
            tabIndex={i === stop ? 0 : -1}
            onClick={() => !off && choose(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            whileTap={reduced || off ? undefined : { scale: 0.99 }}
            transition={SPRING_PRESS}
            className={cn('cursor-pointer rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', off && 'cursor-not-allowed opacity-50')}
          >
            <Card size="compact" selected={on} className={cn('flex-row items-start gap-3 py-3', on ? 'border-foreground' : '')}>
              <span aria-hidden="true" className={cn('mt-0.5 grid size-4 flex-none place-items-center rounded-full border', on ? 'border-foreground' : 'border-border-strong')}>
                <motion.span initial={false} animate={{ scale: on ? 1 : 0 }} transition={reduced ? { duration: 0 } : SPRING_PRESS} className="size-2 rounded-full bg-foreground" />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span id={labelId} className="text-sm font-medium text-foreground">{o.label}</span>
                {o.description ? <span id={descId} className="text-xs text-muted-foreground">{o.description}</span> : null}
              </span>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
