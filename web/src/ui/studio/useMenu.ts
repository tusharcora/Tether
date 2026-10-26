import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * A small popup menu opened by a button: focus moves to the first item, a click outside closes it, Escape closes it and
 * hands focus back to the button, arrows, Home and End move between items. Used by the bottom bar's More and the sidebar's ⋯.
 */
export function useMenu() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!triggerRef.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  /** Closes and puts focus back on the button, so it doesn't drop to the body when the picked item unmounts. */
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') return close();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const at = items.findIndex((b) => b === document.activeElement);
    const to: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 };
    if (!(e.key in to) || !items.length) return;
    e.preventDefault();
    items[(to[e.key]! + items.length) % items.length]?.focus();
  };
  return { open, toggle: () => setOpen((o) => !o), close, triggerRef, menuRef, onMenuKey };
}
