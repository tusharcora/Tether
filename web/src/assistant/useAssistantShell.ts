import { useEffect, useRef, useState } from 'react';
import { isTyping } from '../ui/studio/useGoKeys';

export type PanelMode = 'closed' | 'float' | 'docked';
const KEY = 'tether.assistant.dock';

function storedDock(): boolean {
  try {
    return localStorage.getItem(KEY) === 'docked';
  } catch {
    return false;
  }
}

/**
 * Where the assistant is (spec §4): closed (the launcher), floating over the screen, or docked beside it. Docking is
 * remembered on this device; phones never dock. ⌘J toggles it (Ctrl-J outside text fields elsewhere), Escape closes the
 * floating panel. `needs` is how much waits on the person: the launcher's badge shows until the panel is opened, and
 * comes back when that number grows.
 */
export function useAssistantShell(o: { needs: number; phone: boolean }) {
  const [mode, setMode] = useState<PanelMode>('closed');
  const [dockPref, setDockPref] = useState(storedDock);
  const [seenAt, setSeenAt] = useState(0);
  const open = (m?: 'float' | 'docked') => {
    const next = o.phone ? 'float' : (m ?? (dockPref ? 'docked' : 'float'));
    setMode(next);
    setSeenAt(o.needs);
  };
  const dock = (on: boolean) => {
    setDockPref(on);
    try {
      localStorage.setItem(KEY, on ? 'docked' : 'float');
    } catch {
      /* storage unavailable */
    }
    open(on ? 'docked' : 'float');
  };
  const close = () => setMode('closed');
  const keys = useRef({ toggle: () => {}, escape: () => {} });
  keys.current = { toggle: () => (mode === 'closed' ? open() : close()), escape: () => mode === 'float' && close() };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return keys.current.escape();
      if (e.key.toLowerCase() !== 'j' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      // Ctrl-J is a newline in some text fields: there only ⌘J is taken
      if (!e.metaKey && isTyping(e.target)) return;
      e.preventDefault();
      keys.current.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // what was seen shrinks with the list, so the next new item shows the badge again
  useEffect(() => {
    if (o.needs < seenAt) setSeenAt(o.needs);
  }, [o.needs, seenAt]);
  // a docked panel on a window that became a phone floats instead
  useEffect(() => {
    if (o.phone && mode === 'docked') setMode('float');
  }, [o.phone, mode]);
  return { mode, open, close, dock, docked: mode === 'docked', unseen: mode === 'closed' && o.needs > seenAt ? o.needs : 0 };
}
