import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
vi.mock('./Runs', () => ({ Runs: (p: { selected?: string; node?: string }) => <div>runs screen {p.selected ?? ''} {p.node ?? ''}</div> }));
vi.mock('./Graph', () => ({ GraphView: () => <div>graph screen</div> }));
vi.mock('./Crew', () => ({ Crew: () => <div>crew screen</div> }));
vi.mock('./Triggers', () => ({ Triggers: () => <div>triggers screen</div> }));
vi.mock('./http/ApiTab', () => ({
  ApiTab: (p: { onStarted: (id: string) => void; onUseAsGate: (g: { run: string; env?: string }) => void; onDirtyChange?: (d: boolean) => void }) => {
    useState(() => mounts.api++);
    return (
      <div>
        api screen
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
const railButton = (name: string) => screen.findByRole('button', { name });
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

  it('opens on Home with the rail as the main navigation', () => {
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

  it('navigates by the rail and reopens the last viewed run', async () => {
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

  it('asks before leaving a dirty API tab by the rail', async () => {
    dirtyApi();
    fireEvent.click(screen.getByRole('button', { name: 'Crew' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(location.hash).toBe('#/api');
    expect(screen.getByText('api screen')).toBeTruthy();
    fireEvent.click(await railButton('Crew'));
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
    fireEvent.click(await railButton('More'));
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

  it('returns focus to the rail Settings button when Settings was opened from ⌘K', async () => {
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

  it('gives the rail the full height and scrolls only the screen', () => {
    const shell = cssRule('ui/studio/shell.css', '.shell');
    expect(shell).toContain('grid-template-rows: minmax(0,1fr)');
    expect(shell).toContain('height: 100%');
    expect(cssRule('ui/studio/shell.css', '.sl-rail')).toContain('height: 100%');
    expect(cssRule('ui/studio/shell.css', '.shell-main')).toContain('overflow: auto');
    expect(cssRule('ui/studio/shell.css', '.shell.phone')).toContain('grid-template-rows: minmax(0,1fr) auto');
    expect(() => cssRule('styles.css', '.topbar')).toThrow();
    expect(() => cssRule('styles.css', '.app')).toThrow();
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
