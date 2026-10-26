import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mounts = vi.hoisted(() => ({ api: 0 }));
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
vi.mock('./home/Home', () => ({ Home: (p: { onGo: (r: { tab: string }) => void }) => <div>home screen <button onClick={() => p.onGo({ tab: 'crew' })}>crew link</button></div> }));
vi.mock('./Builder', () => ({
  Builder: (p: { pipeline?: string; gate?: { run: string; env?: string }; onGateUsed?: () => void }) => (
    <div>
      builder screen {p.pipeline ?? ''}
      {p.gate ? ` gate ${p.gate.run} in ${p.gate.env ?? '-'}` : ''}
      {p.gate ? <button onClick={p.onGateUsed}>use gate</button> : null}
    </div>
  ),
}));
vi.mock('./Runs', () => ({
  Runs: (p: { selected?: string; node?: string; onOpenFile?: (repo: string, file: string) => void }) => (
    <div>
      runs screen {p.selected ?? ''} {p.node ?? ''}
      <button onClick={() => p.onOpenFile?.('/code/blog/api', 'src/x.ts')}>open changed file</button>
      <button onClick={() => p.onOpenFile?.('/elsewhere', 'src/x.ts')}>open stray file</button>
    </div>
  ),
}));
vi.mock('./Graph', () => ({ GraphView: (p: { note?: string }) => <div>graph screen {p.note ?? ''}</div> }));
vi.mock('./Crew', () => ({ Crew: (p: { bot?: string }) => <div>crew screen {p.bot ?? ''}</div> }));
vi.mock('./Triggers', () => ({ Triggers: () => <div>triggers screen</div> }));
vi.mock('./code/Code', () => ({
  Code: (p: { project: { id: string }; path?: string; line?: number; onPath: (path?: string, line?: number) => void; onDirtyChange?: (d: boolean) => void }) => (
    <div>
      code screen {p.project.id} {p.path ?? ''} {p.line ?? ''}
      <button onClick={() => p.onPath('lib/b.ts', 4)}>open b</button>
      <button onClick={() => p.onDirtyChange?.(true)}>edit file</button>
    </div>
  ),
}));
vi.mock('./http/ApiTab', () => ({
  ApiTab: (p: { workspace?: string; request?: string; onStarted: (id: string) => void; onUseAsGate: (g: { run: string; env?: string }) => void; onDirtyChange?: (d: boolean) => void; onOpenRequest?: (r?: { id: string; label: string }) => void }) => {
    useState(() => mounts.api++);
    return (
      <div>
        api screen {p.workspace ?? ''} {p.request ?? ''}
        <button onClick={() => p.onOpenRequest?.({ id: 'crew/list', label: 'List crew' })}>open request</button>
        <button onClick={() => p.onDirtyChange?.(true)}>edit draft</button>
        <button onClick={() => p.onUseAsGate({ run: 'runs/list', env: 'stage' })}>gate it</button>
        <button onClick={() => p.onStarted('r9')}>started</button>
      </div>
    );
  },
}));
import { api } from './api';
import { App } from './App';
import { cssRule } from './test/css';
import { routeApi } from './test/fixtures';

/** The app starts on this hash (no hashchange: the page was loaded there). */
const startAt = (hash: string) => history.replaceState(null, '', hash);
/** What the browser does on Back/Forward or a typed hash: a new entry and exactly one hashchange. */
const browserGoes = (hash: string) =>
  act(() => {
    history.pushState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
const navButton = (name: string) => screen.findByRole('button', { name });
const phone = () =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 899px)', media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
const dirtyApi = () => {
  startAt('#/api');
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'edit draft' }));
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  mounts.api = 0;
  startAt('#/home');
  routeApi({ 'GET /api/health': { ok: true, vault: '/home/me/notes/aorch' }, 'GET /api/crew': { bots: [] }, 'GET /api/runs': [], 'GET /api/pipelines': [] });
});

describe('App shell', () => {
  it('passes the step named in the route to Runs', () => {
    location.hash = '#/runs/r5/code';
    render(<App />);
    expect(screen.getByText(/runs screen r5 code/)).toBeTruthy();
  });

  it('opens on Home with the sidebar as the main navigation', () => {
    startAt('#');
    render(<App />);
    expect(screen.getByText('home screen')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('sends an unknown hash to Home', () => {
    startAt('#/nowhere');
    render(<App />);
    expect(screen.getByText('home screen')).toBeTruthy();
  });

  it('navigates by the sidebar and reopens the last viewed run', async () => {
    startAt('#/runs/r5');
    render(<App />);
    expect(screen.getByText(/runs screen r5/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Crew' }));
    expect(location.hash).toBe('#/crew');
    expect(screen.getByText('crew screen')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(location.hash).toBe('#/runs/r5');
    browserGoes('#/graph');
    expect(screen.getByText('graph screen')).toBeTruthy();
  });

  it('hands the bot in the hash to Crew', () => {
    startAt('#/crew/coder');
    render(<App />);
    expect(screen.getByText('crew screen coder')).toBeTruthy();
  });

  it('hands the note in the hash to the Graph', () => {
    startAt('#/graph/Roles%2Fcoder.md');
    render(<App />);
    expect(screen.getByText('graph screen Roles/coder.md')).toBeTruthy();
  });

  it('asks before leaving a dirty API tab by the sidebar', async () => {
    dirtyApi();
    fireEvent.click(screen.getByRole('button', { name: 'Crew' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(location.hash).toBe('#/api');
    expect(screen.getByText('api screen')).toBeTruthy();
    fireEvent.click(await navButton('Crew'));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(location.hash).toBe('#/crew');
    expect(screen.getByText('crew screen')).toBeTruthy();
  });

  it('asks before leaving a dirty API tab by ⌘K', async () => {
    dirtyApi();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.click(await screen.findByText('Go to Crew'));
    expect(await screen.findByRole('button', { name: 'Discard' })).toBeTruthy();
    expect(location.hash).toBe('#/api');
  });

  it('asks before an in-screen link leaves a dirty API tab', async () => {
    dirtyApi();
    fireEvent.click(screen.getByRole('button', { name: 'started' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(location.hash).toBe('#/runs/r9');
  });

  it('asks before the bottom bar and its More menu leave a dirty API tab', async () => {
    phone();
    dirtyApi();
    fireEvent.click(screen.getByRole('button', { name: 'Crew' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(location.hash).toBe('#/api');
    fireEvent.click(await navButton('More'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Graph' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(location.hash).toBe('#/graph');
    expect(screen.getByText('graph screen')).toBeTruthy();
  });

  it('asks before browser Back leaves a dirty API tab, restoring the hash first', async () => {
    dirtyApi();
    browserGoes('#/crew');
    expect(await screen.findByRole('button', { name: 'Discard' })).toBeTruthy();
    expect(location.hash).toBe('#/api');
    expect(screen.getByText('api screen')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(location.hash).toBe('#/crew');
    await waitFor(() => expect(screen.getByText('crew screen')).toBeTruthy());
  });

  it('opens Settings over a dirty API tab without asking and without remounting it', async () => {
    dirtyApi();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(location.hash).toBe('#/settings');
    const drawer = await screen.findByRole('dialog', { name: 'Settings' });
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(screen.getByText('api screen')).toBeTruthy();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(location.hash).toBe('#/api'));
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(mounts.api).toBe(1);
  });

  it('still guards the dirty API tab under Settings', async () => {
    dirtyApi();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('dialog', { name: 'Settings' });
    browserGoes('#/crew');
    expect(await screen.findByRole('button', { name: 'Discard' })).toBeTruthy();
    expect(location.hash).toBe('#/settings');
    expect(screen.getByText('api screen')).toBeTruthy();
  });

  it('hands a request gate from the API tab to the Builder once, and opens started runs', async () => {
    startAt('#/api');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'gate it' }));
    expect(location.hash).toBe('#/builder');
    expect(screen.getByText(/gate runs\/list in stage/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'use gate' }));
    expect(screen.queryByText(/gate runs\/list/)).toBeNull();
    browserGoes('#/api');
    fireEvent.click(screen.getByRole('button', { name: 'started' }));
    expect(location.hash).toBe('#/runs/r9');
  });

  it('follows in-screen links from Home', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'crew link' }));
    expect(location.hash).toBe('#/crew');
  });

  it('shows the vault path and connection in Settings', async () => {
    startAt('#/settings');
    render(<App />);
    expect(await screen.findByText('/home/me/notes/aorch')).toBeTruthy();
    expect(await screen.findByText('connected')).toBeTruthy();
    expect(screen.getByText('home screen')).toBeTruthy();
  });

  it('says connecting, not offline, before the first health poll answers', async () => {
    routeApi({ 'GET /api/health': new Promise(() => {}), 'GET /api/crew': { bots: [] } });
    startAt('#/settings');
    render(<App />);
    expect(await screen.findByText('connecting')).toBeTruthy();
    expect(screen.queryByText('offline')).toBeNull();
  });

  it('shows offline when the server is down', async () => {
    routeApi({ 'GET /api/health': new Error('down'), 'GET /api/crew': { bots: [] } });
    startAt('#/settings');
    render(<App />);
    expect(await screen.findByText('offline')).toBeTruthy();
  });

  it('returns focus to the sidebar Settings button when Settings was opened from ⌘K', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.click(await screen.findByText('Open Settings'));
    const drawer = await screen.findByRole('dialog', { name: 'Settings' });
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Settings' }));
  });

  it('returns focus to More when Settings was opened from the bottom bar menu', async () => {
    phone();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const item = screen.getByRole('menuitem', { name: 'Settings' });
    item.focus();
    fireEvent.click(item);
    const drawer = await screen.findByRole('dialog', { name: 'Settings' });
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' }));
  });

  it('opens the command menu with Ctrl-K and navigates', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(await screen.findByText('Go to Triggers'));
    await waitFor(() => expect(screen.getByText('triggers screen')).toBeTruthy());
  });

  it('leaves Ctrl-K to text fields but always opens on Meta-K', async () => {
    render(<App />);
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    try {
      ta.focus();
      fireEvent.keyDown(ta, { key: 'k', ctrlKey: true });
      await act(async () => {});
      expect(screen.queryByText('Go to Triggers')).toBeNull();
      fireEvent.keyDown(ta, { key: 'k', metaKey: true });
      expect(await screen.findByText('Go to Triggers')).toBeTruthy();
    } finally {
      ta.remove();
    }
  });

  it('gives the sidebar the full height and scrolls only the screen', () => {
    const shell = cssRule('ui/studio/shell.css', '.shell');
    expect(shell).toContain('grid-template-rows: minmax(0,1fr)');
    expect(shell).toContain('grid-template-columns: auto minmax(0,1fr)');
    expect(shell).toContain('height: 100%');
    expect(cssRule('ui/studio/shell.css', '.sl-side')).toContain('height: 100%');
    expect(cssRule('ui/studio/shell.css', '.shell-main')).toContain('overflow: auto');
    expect(cssRule('ui/studio/shell.css', '.shell.phone')).toContain('grid-template-rows: minmax(0,1fr) auto');
    expect(() => cssRule('styles.css', '.topbar')).toThrow();
    expect(() => cssRule('styles.css', '.app')).toThrow();
  });

  it('opens Settings with ⌘, and Open folder… with ⌘O', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: ',', metaKey: true });
    expect(location.hash).toBe('#/settings');
    fireEvent.keyDown(window, { key: 'o', metaKey: true });
    expect(await screen.findByRole('dialog', { name: 'Open a folder' })).toBeTruthy();
  });

  describe('projects and pins', () => {
    const two = [
      { id: 'shop', name: 'shop', path: '/code/shop', isDefault: true, exists: true, repos: [] },
      { id: 'blog', name: 'blog', path: '/code/blog', isDefault: false, exists: true, repos: [] },
    ];
    let saved: unknown;
    beforeEach(() => {
      localStorage.clear();
      saved = undefined;
      routeApi({
        'GET /api/health': { ok: true },
        'GET /api/crew': { bots: [] },
        'GET /api/runs': [{ id: 'r5', task: 'Add rate limiting\nmore', repo: '/code/blog/api', live: true, status: 'running', startedAt: 0 }],
        'GET /api/pipelines': [],
        'GET /api/attention': { items: [{}, {}] },
        'GET /api/workspaces': two,
        'GET /api/pins': () => ({ pins: saved ?? [] }),
        'PUT /api/pins': (b: { pins: unknown }) => ((saved = b.pins), b),
      });
    });

    it('lists projects with a live dot, counts, and switches the API tab to the picked project', async () => {
      startAt('#/api');
      render(<App />);
      expect(await screen.findByText(/api screen shop/)).toBeTruthy();
      expect(await screen.findByText('2')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'blog' }));
      expect(await screen.findByText(/api screen blog/)).toBeTruthy();
      expect(localStorage.getItem('aorch.api.ws')).toBe('blog');
      expect(screen.getByRole('button', { name: 'blog' }).querySelector('.sl-side-live')).toBeTruthy();
    });

    it('hands the file and line in the hash to Code, keeps them in the hash and reopens the last file', async () => {
      startAt('#/code/src/a.ts:3');
      render(<App />);
      expect(await screen.findByText(/code screen shop src\/a\.ts 3/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'open b' }));
      expect(location.hash).toBe('#/code/lib/b.ts:4');
      fireEvent.click(screen.getByRole('button', { name: 'Crew' }));
      fireEvent.click(screen.getByRole('button', { name: 'Code' }));
      expect(location.hash).toBe('#/code/lib/b.ts');
    });

    it('opens a file a run changed in Code, in the project holding the run, and says so when no project holds it', async () => {
      startAt('#/runs/r5');
      render(<App />);
      await screen.findByRole('button', { name: 'blog' });
      fireEvent.click(screen.getByRole('button', { name: 'open stray file' }));
      expect(await screen.findByText(/\/elsewhere is not one of your projects/)).toBeTruthy();
      expect(location.hash).toBe('#/runs/r5');
      fireEvent.click(screen.getByRole('button', { name: 'open changed file' }));
      expect(location.hash).toBe('#/code/src/x.ts');
      expect(await screen.findByText(/code screen blog src\/x\.ts/)).toBeTruthy();
    });

    it('asks before leaving Code, or switching project, with unsaved files', async () => {
      startAt('#/code');
      render(<App />);
      await screen.findByText(/code screen shop/);
      fireEvent.click(screen.getByRole('button', { name: 'edit file' }));
      fireEvent.click(screen.getByRole('button', { name: 'Crew' }));
      expect(await screen.findByText('Some open files have edits that are not saved.')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      fireEvent.click(screen.getByRole('button', { name: 'blog' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
      expect(await screen.findByText(/code screen blog/)).toBeTruthy();
    });

    it('asks before switching project under a dirty API tab', async () => {
      startAt('#/api');
      render(<App />);
      await screen.findByText(/api screen shop/);
      fireEvent.click(screen.getByRole('button', { name: 'edit draft' }));
      fireEvent.click(screen.getByRole('button', { name: 'blog' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
      expect(screen.getByText(/api screen shop/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'blog' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
      expect(await screen.findByText(/api screen blog/)).toBeTruthy();
    });

    it('pins the open run and the open request, and opens a pinned request in its project', async () => {
      startAt('#/runs/r5');
      render(<App />);
      await screen.findByRole('button', { name: 'blog' });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Pin this run or request' }).hasAttribute('disabled')).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: 'Pin this run or request' }));
      await waitFor(() => expect(saved).toEqual([{ kind: 'run', id: 'r5', label: 'Add rate limiting' }]));
      fireEvent.click(await screen.findByRole('button', { name: 'Add rate limiting' }));
      expect(location.hash).toBe('#/runs/r5');

      fireEvent.click(screen.getByRole('button', { name: 'blog' }));
      fireEvent.click(screen.getByRole('button', { name: 'API client' }));
      fireEvent.click(await screen.findByRole('button', { name: 'open request' }));
      fireEvent.click(screen.getByRole('button', { name: 'Pin this run or request' }));
      await waitFor(() => expect(saved).toContainEqual({ kind: 'request', id: 'crew/list', label: 'List crew', ws: 'blog' }));
      fireEvent.click(screen.getByRole('button', { name: 'shop' }));
      fireEvent.click(screen.getByRole('button', { name: 'Home' }));
      fireEvent.click(await screen.findByRole('button', { name: 'List crew' }));
      expect(location.hash).toBe('#/api/crew%2Flist');
      expect(await screen.findByText(/api screen blog crew\/list/)).toBeTruthy();
    });
  });

  it('offers Open folder… on Code when there is no project', async () => {
    routeApi({ 'GET /api/health': { ok: true }, 'GET /api/crew': { bots: [] }, 'GET /api/runs': [], 'GET /api/workspaces': [], 'GET /api/pins': { pins: [] } });
    startAt('#/code');
    render(<App />);
    expect(await screen.findByText('No project open')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Open folder…' }));
    expect(await screen.findByRole('dialog', { name: 'Open a folder' })).toBeTruthy();
  });

  it('uses the bottom bar under 900 px', () => {
    phone();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Graph' }));
    expect(location.hash).toBe('#/graph');
    expect(screen.queryByRole('button', { name: 'Search or jump to' })).toBeNull();
  });
});
