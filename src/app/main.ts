/**
 * Tether.app's main process: the login shell's PATH, the server in this process on a free loopback port (the same home,
 * guards and routes as `tether serve`, so a running `tether serve` never clashes), and one window on it. Everything the
 * person sees is the web app; the preload hands it a small `window.tether` bridge.
 *
 * TETHER_SMOKE=1 boots, loads the page, checks /api/runs, prints one `TETHER_SMOKE {…}` line and quits (the boot test).
 */
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification, screen, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeModeMcpCommand } from '../codemode/launch.js';
import { serveTether } from '../serve.js';
import { installMenu, pickFolder } from './menu.js';
import { shellPath } from './path.js';
import { loadBounds, MIN_HEIGHT, MIN_WIDTH, saveBounds } from './windowState.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const smoke = process.env.TETHER_SMOKE === '1';
/** Runs stopped at quit get this long to record that before the process goes. */
const STOP_GRACE_MS = 1500;

let win: BrowserWindow | undefined;
let origin = '';
let pageReady = false;
/** Folders handed over before the page listens (a Dock drop can launch the app). */
const pending: string[] = [];

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const show = () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};

/** A folder from outside the page (File → Open Folder…, the Dock, `open -a Tether <dir>`): the page registers it and switches to it. */
export function openPath(path: string): void {
  if (!isDir(path)) return;
  if (!win || !pageReady) return void pending.push(path);
  win.webContents.send('tether:open', path);
  show();
}

/** Send the page a hash to show, or a menu command. */
export const toPage = (channel: 'tether:route' | 'tether:command', value: string) => {
  show();
  win?.webContents.send(channel, value);
};

if (!smoke && !app.requestSingleInstanceLock()) app.quit();
app.setName('Tether');
app.on('open-file', (e, path) => {
  e.preventDefault();
  openPath(path);
});
app.on('second-instance', show);

/** IPC only counts when it comes from Tether's own page. */
const fromPage = (e: IpcMainEvent | IpcMainInvokeEvent) => !!origin && e.senderFrame?.url.startsWith(`${origin}/`) === true;

ipcMain.handle('tether:open-folder', (e) => (fromPage(e) ? pickFolder(win) : undefined));
ipcMain.on('tether:reveal', (e, path: unknown) => fromPage(e) && typeof path === 'string' && shell.showItemInFolder(path));
ipcMain.on('tether:badge', (e, n: unknown) => fromPage(e) && app.dock?.setBadge(typeof n === 'number' && n > 0 ? String(Math.floor(n)) : ''));
ipcMain.on('tether:notify', (e, n: { title?: unknown; body?: unknown; route?: unknown }) => {
  if (!fromPage(e) || typeof n?.title !== 'string' || !Notification.isSupported()) return;
  const note = new Notification({ title: n.title, body: typeof n.body === 'string' ? n.body : '' });
  const route = typeof n.route === 'string' && n.route.startsWith('#/') ? n.route : undefined;
  note.on('click', () => (route ? toPage('tether:route', route) : show()));
  note.show();
});
ipcMain.on('tether:ready', (e) => {
  if (!fromPage(e)) return;
  pageReady = true;
  pending.splice(0).forEach(openPath);
});

const openOutside = (to: string) => void (/^https?:\/\//.test(to) && shell.openExternal(to));

function createWindow(url: string, home: string): void {
  const saved = loadBounds(home, screen.getAllDisplays().map((d) => d.workArea));
  win = new BrowserWindow({
    ...(saved ?? { width: 1440, height: 900 }),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: 'Tether',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    // the sidebar's colour, so the window never flashes white before the page paints
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f11' : '#f4f4f3',
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const page = process.env.TETHER_DEV_URL || url;
  origin = new URL(page).origin;
  win.webContents.on('will-navigate', (e, to) => {
    if (new URL(to).origin === origin) return;
    e.preventDefault();
    openOutside(to);
  });
  win.webContents.setWindowOpenHandler(({ url: to }) => (openOutside(to), { action: 'deny' }));
  // the page's beforeunload (unsaved files, a dirty request) would cancel the close silently: ask instead
  win.webContents.on('will-prevent-unload', (e) => {
    const r = dialog.showMessageBoxSync(win!, { type: 'question', buttons: ['Discard', 'Keep editing'], defaultId: 1, cancelId: 1, message: 'Discard unsaved changes?', detail: 'Some open work in Tether has edits that are not saved.' });
    if (r === 0) e.preventDefault();
  });
  win.once('ready-to-show', () => !smoke && win?.show());
  win.on('close', () => win && !win.isFullScreen() && saveBounds(home, win.getNormalBounds()));
  win.on('closed', () => {
    win = undefined;
    pageReady = false;
  });
  void win.loadURL(page);
}

/**
 * The window's content policy: only Tether's own scripts, styles (inline too: React style attributes and CodeMirror's
 * injected sheets), images, fonts and API. Not set for the Vite dev server, whose hot reload needs more.
 */
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
function enforceCsp(): void {
  if (process.env.TETHER_DEV_URL) return;
  session.defaultSession.webRequest.onHeadersReceived((details, done) => {
    const own = !!origin && details.url.startsWith(`${origin}/`);
    done({ responseHeaders: own ? { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } : details.responseHeaders });
  });
}

/** The boot test's report: the page loaded, /api/runs answered, the bridge is there, and how Code Mode's MCP server starts here. */
function smokeCheck(w: BrowserWindow, url: string): void {
  const report = (r: Record<string, unknown>) => {
    console.log(`TETHER_SMOKE ${JSON.stringify({ url, ...r })}`);
    app.quit();
  };
  w.webContents.once('did-fail-load', (_e, code, desc) => report({ loaded: false, error: `${code} ${desc}` }));
  w.webContents.once('did-finish-load', async () => {
    const runs = await fetch(`${url}/api/runs`).then((r) => r.status, () => 0);
    const bridge = await w.webContents.executeJavaScript('typeof window.tether === "object" ? window.tether.platform : null');
    // the content policy let the app run: React has drawn into #root
    const rendered = await w.webContents.executeJavaScript('new Promise((r) => setTimeout(() => r(document.getElementById("root")?.childElementCount > 0), 500))');
    report({ loaded: true, runs, bridge, rendered, title: w.webContents.getTitle(), mcp: codeModeMcpCommand('<session>') });
  });
}

async function start(path: string): Promise<void> {
  process.env.PATH = path;
  const server = await serveTether({ host: '127.0.0.1', port: Number(process.env.TETHER_PORT ?? 0), webDir: join(root, 'web/dist'), examplesDir: join(root, 'examples/pipelines') });
  installMenu({ home: server.cfg.home, openPath, toPage, getWindow: () => win });
  enforceCsp();
  createWindow(server.url, server.cfg.home);
  if (smoke) smokeCheck(win!, server.url);

  // macOS: closing the window keeps Tether (and its server) running; the Dock icon brings a window back
  app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
  app.on('activate', () => (win ? show() : createWindow(server.url, server.cfg.home)));

  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    const stopped = server.stopLive();
    void new Promise((r) => setTimeout(r, stopped ? STOP_GRACE_MS : 0))
      .then(() => server.close())
      .finally(() => app.quit());
  });
}

// Not a top-level await: Electron fires `ready` only once the entry module has finished evaluating, so awaiting it here would hang.
const loginPath = shellPath();
void app.whenReady().then(async () => {
  try {
    await start(await loginPath);
  } catch (e) {
    dialog.showErrorBox('Tether could not start', (e as Error).message);
    app.exit(1);
  }
});
