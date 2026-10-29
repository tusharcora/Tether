import { Check, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button, type ButtonVariant } from '../../components/beui/kit/Button';
import { cn } from '../cn';
import { isTyping } from './useGoKeys';
import { useMenu } from './useMenu';
import './toolframe.css';

/**
 * The tool screens' frame (spec §5, mockup docs/design/Round2Screens.html): the work fills the screen on a dotted
 * backdrop, small toolbars float at its edges, and one panel docks on the right while something is open.
 */
export const ToolScreen = (p: { className?: string; children: ReactNode }) => <div className={cn('tf-screen', p.className)}>{p.children}</div>;

export type BarAt = 'left' | 'center' | 'right' | 'bottom';
export const FloatBar = (p: { at: BarAt; className?: string; children: ReactNode }) => <div className={cn('tf-bar', `tf-${p.at}`, p.className)}>{p.children}</div>;

/** A popup on the page (a dialog, a menu, an open select or picker) owns Esc while it is up. */
const POPUP = '[role="dialog"], [role="menu"], [role="listbox"]:not([aria-hidden="true"])';

/**
 * The docked panel: opened by selecting something, closed by × or Esc. It never takes focus when it opens (the Builder
 * canvas keeps Delete); closing it with focus inside puts focus back where it was when the panel opened.
 */
export function Dock(p: { label: string; head?: ReactNode; onClose: () => void; className?: string; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const close = useRef(() => {});
  close.current = () => {
    const back = panel.current?.contains(document.activeElement) ? opener.current : null;
    p.onClose();
    if (back instanceof HTMLElement && back.isConnected) back.focus();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(POPUP)) return;
      if (isTyping(e.target)) (e.target as HTMLElement).blur();
      else close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <aside ref={panel} className={cn('tf-dock', p.className)} aria-label={p.label}>
      <header className="tf-dock-head">
        {p.head}
        <button type="button" className="tf-x" aria-label={`Close ${p.label}`} onClick={() => close.current()}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="tf-dock-body">{p.children}</div>
    </aside>
  );
}

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; current?: boolean; danger?: boolean };

/** A button that opens a small menu (useMenu: arrows, Esc, a click outside closes). Picking an item closes the menu first. */
export function MenuButton(p: { title: string; label: ReactNode; items: (MenuItem | 'rule')[]; variant?: ButtonVariant; align?: 'start' | 'end'; className?: string }) {
  const menu = useMenu();
  return (
    <span className="tf-menu-anchor">
      <Button ref={menu.triggerRef} variant={p.variant ?? 'ghost'} size="sm" className={p.className} aria-label={p.title} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
        {p.label}
      </Button>
      {menu.open ? (
        <div ref={menu.menuRef} className={cn('sl-menu tf-menu', { end: p.align === 'end' })} role="menu" aria-label={p.title} onKeyDown={menu.onMenuKey}>
          {p.items.map((it, i) =>
            it === 'rule' ? (
              <div key={`rule-${i}`} className="sl-menu-rule" role="separator" />
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={cn({ 'sl-menu-danger': !!it.danger })}
                disabled={it.disabled}
                aria-current={it.current || undefined}
                onClick={() => (menu.close(), it.onSelect())}
              >
                {it.label}
                {it.current ? <Check size={14} className="tf-check" aria-hidden="true" /> : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </span>
  );
}
