/**
 * From bencho.dev "Create menu" / liq-create (Create.tsx / Create.css). MIT License, Copyright (c) 2026 Lorenzo Cabra; the full
 * notice is in ./LICENSE. Adapted for Tether: the items and what they do come from props (bencho's four were fixed and only
 * closed the menu), the trigger is the caller's compact button, and the menu is a real menu: arrows, Home and End, Enter and
 * Space, Escape back to the trigger, a press outside closes. It keeps bencho's idea: one shape, no second panel. The trigger
 * spreads into the menu (width, height and corner on one curve) while the rows rise in a few milliseconds apart. It is
 * drawn fixed to the viewport (the sidebar clips its own content) and every fill is opaque, so a filter could fuse it with
 * its trigger the way bencho's goo does. Studio tokens through Tailwind classes; reduced motion fades instead of spreading.
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../beui/lib/utils';

export interface CreateItem {
  id: string;
  label: string;
  icon: ReactNode;
  /** A quiet trailing hint (a shortcut, or "soon"). */
  hint?: ReactNode;
  /** Shown but not taken: the arrows pass over it and a press does nothing. */
  disabled?: boolean;
}

export interface CreateMenuProps {
  /** Names the trigger and the menu. */
  label: string;
  items: CreateItem[];
  onSelect: (id: string) => void;
  /** What the trigger draws (an icon). */
  children: ReactNode;
  className?: string;
  /** The tooltip of the trigger. */
  title?: string;
}

const W = 216;
const ROW = 34;
const PAD = 8;
const EASE = [0.16, 1, 0.3, 1] as const;

export function CreateMenu({ label, items, onSelect, children, className, title }: CreateMenuProps) {
  const reduce = useReducedMotion();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; w: number; h: number }>();
  const [active, setActive] = useState(0);
  const height = items.length * ROW + (items.length - 1) * 2 + PAD * 2;
  /** The next row the arrows land on from `from`, passing over disabled ones. */
  const step = (from: number, by: 1 | -1) => {
    for (let k = 1; k <= items.length; k++) {
      const i = (from + by * k + items.length * k) % items.length;
      if (!items[i]?.disabled) return i;
    }
    return from;
  };

  const show = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    setBox({ top: r.top, left: Math.max(8, r.right - W), w: r.width, h: r.height });
    setActive(step(-1, 1));
    setOpen(true);
  };
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menu.current?.contains(t) || trigger.current?.contains(t)) return;
      setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener('pointerdown', away);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('resize', resize);
    };
  }, [open]);

  // focus follows the active row once the menu is on screen
  useLayoutEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus({ preventScroll: true });
  }, [open, active, box]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => step(a, 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => step(a, -1)));
    else if (e.key === 'Home') (e.preventDefault(), setActive(step(-1, 1)));
    else if (e.key === 'End') (e.preventDefault(), setActive(step(items.length, -1)));
    else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), close(true));
    else if (e.key === 'Tab') close(false);
  };

  const pick = (item: CreateItem) => {
    if (item.disabled) return;
    close(false);
    onSelect(item.id);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={className}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) (e.preventDefault(), show());
        }}
      >
        {children}
      </button>
      {box
        ? createPortal(
            <AnimatePresence>
              {open ? (
            <motion.div
              ref={menu}
              id={id}
              role="menu"
              aria-label={label}
              onKeyDown={onKey}
              initial={reduce ? { opacity: 0 } : { width: box.w, height: box.h, left: box.left + W - box.w, borderRadius: 7, opacity: 1 }}
              animate={reduce ? { opacity: 1 } : { width: W, height, left: box.left, borderRadius: 14, opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={reduce ? { duration: 0.12 } : { duration: 0.22, ease: EASE }}
              style={{ position: 'fixed', top: box.top, left: box.left, zIndex: 60 }}
              className="overflow-hidden border border-border bg-card"
            >
              <ul className="m-0 grid list-none gap-0.5 p-2" style={{ width: W }}>
                {items.map((item, i) => (
                  <motion.li
                    key={item.id}
                    role="none"
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={reduce ? { duration: 0 } : { duration: 0.2, ease: EASE, delay: 0.03 + i * 0.022 }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      aria-label={item.label}
                      aria-disabled={item.disabled || undefined}
                      data-index={i}
                      tabIndex={i === active ? 0 : -1}
                      onClick={() => pick(item)}
                      onPointerEnter={() => !item.disabled && setActive(i)}
                      className={cn('flex w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-3 text-left text-sm text-foreground outline-none transition-colors', i === active && 'bg-muted', item.disabled && 'cursor-not-allowed opacity-50')}
                      style={{ height: ROW }}
                    >
                      <span aria-hidden="true" className="grid size-4 flex-none place-items-center text-muted-foreground">
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.hint ? <span className="flex-none text-xs text-muted-foreground">{item.hint}</span> : null}
                    </button>
                  </motion.li>
                ))}
              </ul>
            </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}
