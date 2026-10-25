import { Search, Settings, type LucideIcon } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import type { Screen } from '../../hooks';
import { cn } from '../cn';
import { Kbd } from './Kbd';
import { NAV } from './nav';
import './shell.css';

const TIP_DELAY_MS = 300;

export interface RailProps {
  active: Screen;
  /** The Settings drawer is open over the active screen. */
  settingsOpen?: boolean;
  onGo: (s: Screen) => void;
  onSearch: () => void;
  onSettings: () => void;
}

interface Item { key: string; label: string; Icon: LucideIcon; pick: () => void; current: boolean }

/** The left icon rail: ⌘K search, the screens, Settings at the bottom. One tab stop; arrows, Home and End move inside. */
export function Rail(p: RailProps) {
  const items: Item[] = [
    { key: 'search', label: 'Search or jump to', Icon: Search, pick: p.onSearch, current: false },
    ...NAV.map((n) => ({ key: n.id, label: n.label, Icon: n.Icon, pick: () => p.onGo(n.id), current: !p.settingsOpen && n.id === p.active })),
    { key: 'settings', label: 'Settings', Icon: Settings, pick: p.onSettings, current: !!p.settingsOpen },
  ];
  const activeIndex = Math.max(0, items.findIndex((i) => i.current));
  const [focus, setFocus] = useState<number>();
  const stop = focus ?? activeIndex;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [tip, setTip] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showTip = (key: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setTip(key), TIP_DELAY_MS);
  };
  const hideTip = () => {
    clearTimeout(timer.current);
    setTip(undefined);
  };
  const move = (i: number) => {
    const n = (i + items.length) % items.length;
    setFocus(n);
    refs.current[n]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const at = refs.current.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    const to: Record<string, number> = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: items.length - 1 };
    if (!(e.key in to)) return;
    e.preventDefault();
    move(to[e.key]!);
  };

  return (
    <nav className="sl-rail" aria-label="Main" onKeyDown={onKeyDown}>
      {items.map((it, i) => (
        <div key={it.key} className={cn('sl-rail-slot', { 'sl-rail-bottom': it.key === 'settings' })}>
          <button
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            className={cn('sl-rail-btn', { current: it.current })}
            aria-label={it.label}
            aria-current={it.current ? 'page' : undefined}
            tabIndex={i === stop ? 0 : -1}
            onClick={() => {
              setFocus(i);
              it.pick();
            }}
            onFocus={() => {
              setFocus(i);
              showTip(it.key);
            }}
            onBlur={hideTip}
            onPointerEnter={() => showTip(it.key)}
            onPointerLeave={hideTip}
          >
            <it.Icon size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {tip === it.key ? (
            <span className="sl-rail-tip" aria-hidden="true">
              {it.label}
              {it.key === 'search' ? <Kbd mod>K</Kbd> : null}
            </span>
          ) : null}
        </div>
      ))}
    </nav>
  );
}
