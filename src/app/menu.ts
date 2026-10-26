/** Tether.app's menu bar (§7.2): Tether, File (Open Folder, Open Recent, Welcome), Edit, View, Window, Help. */
import { app, dialog, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { watch } from 'node:fs';
import { listWorkspaces } from '../workspace.js';

const ISSUES = 'https://github.com/tusharcora/aorch/issues';
const RECENT_MAX = 10;

export interface MenuDeps {
  home: string;
  openPath: (path: string) => void;
  toPage: (channel: 'tether:route' | 'tether:command', value: string) => void;
  getWindow: () => BrowserWindow | undefined;
}

/** The native folder picker, over the window when there is one; undefined when cancelled. */
export async function pickFolder(win?: BrowserWindow): Promise<string | undefined> {
  const options = { properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[], buttonLabel: 'Open' };
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return r.canceled ? undefined : r.filePaths[0];
}

export function menuTemplate(d: MenuDeps): MenuItemConstructorOptions[] {
  // Open Recent mirrors the sidebar's Projects
  const recent: MenuItemConstructorOptions[] = listWorkspaces(d.home)
    .filter((w) => w.exists)
    .slice(0, RECENT_MAX)
    .map((w) => ({ label: w.name, sublabel: w.path, click: () => d.openPath(w.path) }));
  const openFolder = async () => {
    const path = await pickFolder(d.getWindow());
    if (path) d.openPath(path);
  };
  return [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'About Tether' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => d.toPage('tether:route', '#/settings') },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Tether' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Tether' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => void openFolder() },
        { label: 'Open Recent', submenu: recent.length ? recent : [{ label: 'No projects yet', enabled: false }] },
        { label: 'Welcome', click: () => d.toPage('tether:command', 'welcome') },
        { type: 'separator' },
        { role: 'close', label: 'Close Window' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...(app.isPackaged ? [] : ([{ type: 'separator' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Report an Issue…', click: () => void shell.openExternal(ISSUES) }] },
  ];
}

/** Set the menu, and set it again whenever the project registry changes (so Open Recent follows Open Folder… and removals). */
export function installMenu(d: MenuDeps): void {
  const build = () => Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(d)));
  build();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    watch(d.home, (_event, name) => {
      if (name !== 'workspaces.json') return;
      clearTimeout(timer);
      timer = setTimeout(build, 200);
    });
  } catch {
    /* Open Recent stays as it was at launch */
  }
}
