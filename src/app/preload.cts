/**
 * Tether.app's preload: the page's only way to the Mac. Context isolation is on and the renderer is sandboxed, so the
 * page gets these functions and nothing else (CommonJS: sandboxed preloads cannot be ES modules).
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppCommand, TetherBridge } from '../types.js';

const listen =
  <T,>(channel: string) =>
  (cb: (value: T) => void) => {
    const on = (_e: unknown, value: T) => cb(value);
    ipcRenderer.on(channel, on);
    return () => void ipcRenderer.removeListener(channel, on);
  };

const bridge: TetherBridge = {
  platform: process.platform,
  openFolder: () => ipcRenderer.invoke('tether:open-folder'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  revealInFinder: (path) => ipcRenderer.send('tether:reveal', path),
  setBadge: (n) => ipcRenderer.send('tether:badge', n),
  notify: (n) => ipcRenderer.send('tether:notify', n),
  onOpen: listen<string>('tether:open'),
  onRoute: listen<string>('tether:route'),
  onCommand: listen<AppCommand>('tether:command'),
  ready: () => ipcRenderer.send('tether:ready'),
};

contextBridge.exposeInMainWorld('tether', bridge);
