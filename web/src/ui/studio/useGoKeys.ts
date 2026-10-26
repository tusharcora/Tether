import { useEffect, useRef } from 'react';
import type { Screen } from '../../hooks';
import { NAV } from './nav';

/** How long `G` waits for its second key. */
export const GO_WINDOW_MS = 1000;

/** A text field, a select or anything editable: keys typed there are text, never shortcuts. */
export const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

/**
 * Linear's two-key navigation: `G` then a screen's letter within a second (`G C` Code, `G I` Inbox…), and `C` alone to
 * compose a new run. Ignored while typing in a field, with a modifier held, or while a dialog is open.
 */
export function useGoKeys(onGo: (s: Screen) => void, onCompose: () => void): void {
  const handlers = useRef({ onGo, onCompose });
  handlers.current = { onGo, onCompose };
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTyping(e.target) || document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (armed && Date.now() - armed <= GO_WINDOW_MS) {
        armed = 0;
        const to = NAV.find((n) => n.go === k);
        if (to) {
          e.preventDefault();
          handlers.current.onGo(to.id);
        }
        return;
      }
      armed = 0;
      if (k === 'g' && !e.shiftKey) armed = Date.now();
      else if (k === 'c' && !e.shiftKey) {
        e.preventDefault();
        handlers.current.onCompose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
