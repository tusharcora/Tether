import { Ellipsis, Settings } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Screen } from '../../hooks';
import { cn } from '../cn';
import { NAV } from './nav';
import type { RailProps } from './Rail';
import './shell.css';

const MAIN: Screen[] = ['home', 'runs', 'builder', 'crew', 'api'];
const MORE = NAV.filter((n) => !MAIN.includes(n.id));

/** Under 900 px: five screens and a More menu (Graph, Triggers, Settings). */
export function BottomBar(p: Omit<RailProps, 'onSearch'>) {
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreActive = !!p.settingsOpen || MORE.some((n) => n.id === p.active);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && e.target !== moreRef.current) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  const close = () => {
    setOpen(false);
    moreRef.current?.focus();
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') return close();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const at = items.findIndex((b) => b === document.activeElement);
    const to: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 };
    if (!(e.key in to) || !items.length) return;
    e.preventDefault();
    items[(to[e.key]! + items.length) % items.length]?.focus();
  };

  return (
    <nav className="sl-bottombar" aria-label="Main">
      {NAV.filter((n) => MAIN.includes(n.id)).map((n) => (
        <button key={n.id} type="button" className={cn('sl-bottom-btn', { current: !p.settingsOpen && p.active === n.id })} aria-current={!p.settingsOpen && p.active === n.id ? 'page' : undefined} onClick={() => p.onGo(n.id)}>
          <n.Icon size={18} strokeWidth={1.75} aria-hidden="true" />
          {n.label}
        </button>
      ))}
      <button ref={moreRef} type="button" className={cn('sl-bottom-btn', { current: moreActive })} aria-haspopup="menu" aria-expanded={open} aria-current={moreActive ? 'page' : undefined} onClick={() => setOpen((o) => !o)}>
        <Ellipsis size={18} strokeWidth={1.75} aria-hidden="true" />
        More
      </button>
      {open ? (
        <div ref={menuRef} className="sl-bottom-menu" role="menu" aria-label="More" onKeyDown={onMenuKey}>
          {MORE.map((n) => (
            <button key={n.id} type="button" role="menuitem" onClick={() => (setOpen(false), p.onGo(n.id))}>
              <n.Icon size={16} aria-hidden="true" />
              {n.label}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => (setOpen(false), p.onSettings())}>
            <Settings size={16} aria-hidden="true" />
            Settings
          </button>
        </div>
      ) : null}
    </nav>
  );
}
