import { useEffect, useRef } from 'react';
import type { AppCommand, TetherBridge } from '../../src/types.js';

export type { AppCommand, TetherBridge };

declare global {
  interface Window {
    /** Set by Tether.app's preload; absent in a browser. */
    tether?: TetherBridge;
  }
}

/** Tether.app's bridge to the Mac, or undefined in a browser (every caller has a browser fallback). */
export const bridge = (): TetherBridge | undefined => (typeof window === 'undefined' ? undefined : window.tether);

/** The folder in a drop, when running in Tether.app and one of the dropped items is a folder (a browser cannot tell its path). */
export function droppedFolder(dt: DataTransfer | null | undefined): string | undefined {
  const b = bridge();
  if (!b || !dt) return undefined;
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file' || !item.webkitGetAsEntry?.()?.isDirectory) continue;
    const file = item.getAsFile();
    if (file) return b.pathForFile(file);
  }
  return undefined;
}

/** A drag that carries files or folders (not text or a link). */
export const carriesFiles = (dt: DataTransfer | null | undefined): boolean => !!dt && Array.from(dt.types ?? []).includes('Files');

/**
 * Tether.app's events for the page: a folder to open (File → Open Folder…, Open Recent, the Dock, `open -a`, or a folder
 * dropped anywhere on the window), a hash to show (a clicked notification, Settings…) and menu commands. Then it tells
 * the app the page listens, so a folder that launched the app is delivered. Nothing happens in a browser.
 */
export function useBridgeEvents(on: { open: (path: string) => void; command: (c: AppCommand) => void }): void {
  const handlers = useRef(on);
  handlers.current = on;
  useEffect(() => {
    const b = bridge();
    if (!b) return;
    const offs = [b.onOpen((path) => handlers.current.open(path)), b.onRoute((hash) => void (location.hash = hash)), b.onCommand((c) => handlers.current.command(c))];
    // a dropped file would otherwise replace the page; a dropped folder opens as a project
    const over = (e: DragEvent) => carriesFiles(e.dataTransfer) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      const path = droppedFolder(e.dataTransfer);
      if (path) handlers.current.open(path);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    b.ready();
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
}
