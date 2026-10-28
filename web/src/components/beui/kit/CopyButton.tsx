import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, CircleAlert, Copy } from 'lucide-react';
import { Button } from './Button';

type State = 'idle' | 'copied' | 'error';

/** Copy a value to the clipboard: the icon and label swap to "Copied" for two seconds, and a status line tells assistive tech. */
export function CopyButton({ value, label = 'Copy', className, iconOnly = false, variant = 'outline', disabled, onCopied }: { value: string; label?: string; className?: string; iconOnly?: boolean; variant?: 'outline' | 'plain'; disabled?: boolean; onCopied?: () => void }) {
  const [state, setState] = useState<State>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useReducedMotion() ?? false;
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    let next: State = 'copied';
    try { await navigator.clipboard.writeText(value); } catch { next = 'error'; }
    setState(next);
    timer.current = setTimeout(() => setState('idle'), 1900);
    if (next === 'copied') onCopied?.();
  }, [value, onCopied]);
  const text = state === 'copied' ? 'Copied' : state === 'error' ? 'Failed' : label;
  return (
    <>
      <Button type="button" size={iconOnly ? 'icon' : 'sm'} variant={variant === 'plain' ? 'ghost' : 'secondary'} className={className} aria-label={label} data-copy-state={state} disabled={disabled} onClick={() => void copy()}>
        <span className="grid size-4 place-items-center" aria-hidden="true">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span key={state} initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {state === 'copied' ? <Check size={16} strokeWidth={1.75} /> : state === 'error' ? <CircleAlert size={16} strokeWidth={1.75} /> : <Copy size={16} strokeWidth={1.75} />}
            </motion.span>
          </AnimatePresence>
        </span>
        {iconOnly ? null : <span aria-hidden="true">{text}</span>}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">{state === 'idle' ? '' : state === 'error' ? `${label}: Could not copy` : `${label}: Copied`}</span>
    </>
  );
}
