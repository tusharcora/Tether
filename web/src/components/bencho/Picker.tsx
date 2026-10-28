/**
 * From bencho.dev "Picker" / "Assignees" (Picker.tsx / Picker.css). MIT License, Copyright (c) 2026 Lorenzo Cabra; the full
 * notice is in ./LICENSE. Adapted for Tether: it takes real `options`, `value` and `onChange` (bencho's demo kept a fixed
 * cast in state), a listbox with keyboard (arrows, Home and End, type-ahead, Enter and Space, Escape) and a visible label.
 * It keeps bencho's idea: the pill is the readout. The chosen options' faces fill it and overlap into a stack, and the list
 * unfolds out of the pill. Studio tokens through Tailwind classes, opaque fills, short tweened motion (reduced motion: none).
 */
import { Check, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../beui/lib/utils';

export interface PickerOption {
  id: string;
  /** What the option is called; it names the option for assistive tech. */
  name: string;
  /** A second line: what the option is for. */
  hint?: string;
  /** A face or a mark drawn before the name (and stacked in the pill when several are chosen). */
  lead?: ReactNode;
  disabled?: boolean;
}

export interface PickerProps {
  /** Names the control; shown above the pill. */
  label: string;
  options: PickerOption[];
  /** The chosen option ids. */
  value: string[];
  onChange: (ids: string[]) => void;
  /** Several can be chosen; the list stays open between picks. By default one is chosen and the list closes. */
  multiple?: boolean;
  /** What the pill says with nothing chosen. */
  placeholder?: string;
  disabled?: boolean;
  /** Hide the visible label (it still names the control). */
  hideLabel?: boolean;
  /** Adds a text row at the end of the list: type another value and press Enter to choose it (for a free-text field). */
  custom?: { label: string; placeholder?: string };
  className?: string;
  id?: string;
}

const OPEN = { duration: 0.2, ease: [0.16, 1, 0.3, 1] } as const;

export function Picker({ label, options: given, value, onChange, multiple = false, placeholder = 'Choose', disabled, hideLabel, custom, className, id }: PickerProps) {
  const reduce = useReducedMotion();
  const auto = useId();
  const base = id ?? auto;
  const labelId = `${base}-label`;
  const listId = `${base}-list`;
  const root = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = useRef({ text: '', at: 0 });

  // a chosen value the list does not hold (a custom one) still shows in the pill and stays in the list
  const extra = value.filter((v) => v && !given.some((o) => o.id === v)).map((v): PickerOption => ({ id: v, name: v }));
  const options = [...given, ...extra];
  const chosen = value.map((v) => options.find((o) => o.id === v)).filter((o): o is PickerOption => !!o);
  const count = options.length + (custom ? 1 : 0);
  const enabled = (i: number) => i === options.length || !options[i]?.disabled;

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) pill.current?.focus();
  }, []);

  const show = () => {
    const at = options.findIndex((o) => o.id === value[0]);
    setActive(at >= 0 ? at : Math.max(0, options.findIndex((_, i) => enabled(i))));
    setOpen(true);
  };

  // focus follows the active option while the list is open
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus({ preventScroll: false });
  }, [open, active]);

  // a press outside the control puts the list away
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const pick = (o: PickerOption) => {
    if (o.disabled) return;
    if (multiple) onChange(value.includes(o.id) ? value.filter((v) => v !== o.id) : [...value, o.id]);
    else {
      onChange([o.id]);
      close(true);
    }
  };

  const move = (from: number, step: 1 | -1) => {
    for (let k = 1; k <= count; k++) {
      const i = (from + step * k + count * k) % count;
      if (enabled(i)) return i;
    }
    return from;
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => move(a, 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => move(a, -1)));
    else if (e.key === 'Home') (e.preventDefault(), setActive(options.findIndex((_, i) => enabled(i))));
    else if (e.key === 'End') (e.preventDefault(), setActive(count - 1 - [...options, ...(custom ? [{ id: '', name: '' }] : [])].reverse().findIndex((o) => !('disabled' in o && o.disabled))));
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const o = options[active];
      if (o) pick(o);
    } else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), close(true));
    else if (e.key === 'Tab') close(false);
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // type-ahead: the typed letters pick the first option that starts with them
      const now = Date.now();
      typed.current = { text: now - typed.current.at > 700 ? e.key.toLowerCase() : typed.current.text + e.key.toLowerCase(), at: now };
      const hit = options.findIndex((o, i) => enabled(i) && o.name.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  };

  const onPillKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') (e.preventDefault(), open ? close(false) : show());
  };

  const lap = 10;
  return (
    <div ref={root} className={cn('relative min-w-0', className)}>
      <span id={labelId} className={cn('mb-2 block text-sm font-medium text-foreground', hideLabel && 'sr-only')}>
        {label}
      </span>
      <button
        ref={pill}
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={onPillKey}
        className="flex h-11 w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 text-left text-sm text-foreground outline-none transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        {chosen.length ? (
          <>
            <span className="relative flex flex-none items-center" style={{ width: multiple ? 28 + (chosen.length - 1) * (28 - lap) : 28, height: 28 }} aria-hidden="true">
              <AnimatePresence initial={false}>
                {chosen.map((o, i) => (
                  <motion.span
                    key={o.id}
                    className="absolute left-0 top-0 grid size-7 place-items-center overflow-hidden rounded-full bg-muted text-xs font-medium"
                    style={{ zIndex: chosen.length - i, x: multiple ? i * (28 - lap) : 0 }}
                    initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {o.lead ?? o.name.slice(0, 1).toUpperCase()}
                  </motion.span>
                ))}
              </AnimatePresence>
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{multiple && chosen.length > 1 ? `${chosen.length} chosen` : chosen[0]!.name}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{placeholder}</span>
        )}
        <ChevronDown className={cn('size-4 flex-none text-muted-foreground transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            aria-multiselectable={multiple || undefined}
            onKeyDown={onListKey}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scaleY: 0.96 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={reduce ? { duration: 0.1 } : OPEN}
            style={{ originY: 0 }}
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-72 overflow-y-auto rounded-xl border border-border bg-card p-1.5"
          >
            {options.length === 0 ? <div className="px-2.5 py-3 text-sm text-muted-foreground">Nothing to choose from.</div> : null}
            {options.map((o, i) => {
              const on = value.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-label={o.name}
                  aria-selected={on}
                  aria-disabled={o.disabled || undefined}
                  data-index={i}
                  tabIndex={i === active ? 0 : -1}
                  onClick={() => pick(o)}
                  onPointerEnter={() => !o.disabled && setActive(i)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-sm text-foreground outline-none transition-colors',
                    i === active && 'bg-muted',
                    o.disabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span className="grid size-7 flex-none place-items-center overflow-hidden rounded-full bg-muted text-xs font-medium" aria-hidden="true">
                    {o.lead ?? o.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="grid min-w-0 flex-1" aria-hidden="true">
                    <span className="truncate font-medium">{o.name}</span>
                    {o.hint ? <span className="truncate text-xs text-muted-foreground">{o.hint}</span> : null}
                  </span>
                  <span className="grid size-4 flex-none place-items-center" aria-hidden="true">
                    {on ? <Check size={14} strokeWidth={2} /> : null}
                  </span>
                </button>
              );
            })}
            {custom ? (
              <input
                type="text"
                data-index={options.length}
                tabIndex={active === options.length ? 0 : -1}
                aria-label={custom.label}
                placeholder={custom.placeholder ?? custom.label}
                spellCheck={false}
                onFocus={() => setActive(options.length)}
                onKeyDown={(e) => {
                  // typing belongs to the field; arrows and Escape still move through the list
                  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation();
                  if (e.key === 'Enter') {
                    const text = e.currentTarget.value.trim();
                    if (!text) return;
                    onChange(multiple ? [...value, text] : [text]);
                    if (!multiple) close(true);
                    else e.currentTarget.value = '';
                  }
                }}
                className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground"
              />
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
