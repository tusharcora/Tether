import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
vi.mock('./Builder', () => ({
  Builder: (p: { pipeline?: string; gate?: { run: string; env?: string }; onGateUsed?: () => void }) => (
    <div>
      builder screen {p.pipeline ?? ''}
      {p.gate ? ` gate ${p.gate.run} in ${p.gate.env ?? '-'}` : ''}
      {p.gate ? <button onClick={p.onGateUsed}>use gate</button> : null}
    </div>
  ),
}));
vi.mock('./Runs', () => ({ Runs: (p: { selected?: string }) => <div>runs screen {p.selected ?? ''}</div> }));
vi.mock('./Graph', () => ({ GraphView: () => <div>graph screen</div> }));
vi.mock('./Crew', () => ({ Crew: () => <div>crew screen</div> }));
vi.mock('./Triggers', () => ({ Triggers: () => <div>triggers screen</div> }));
vi.mock('./http/ApiTab', () => ({
  ApiTab: (p: { onStarted: (id: string) => void; onUseAsGate: (g: { run: string; env?: string }) => void }) => (
    <div>
      api screen
      <button onClick={() => p.onUseAsGate({ run: 'runs/list', env: 'stage' })}>gate it</button>
      <button onClick={() => p.onStarted('r9')}>started</button>
    </div>
  ),
}));
import { api } from './api';
import { App } from './App';
import { routeApi } from './test/fixtures';

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({ 'GET /api/health': { ok: true, vault: '/home/me/notes/aorch' }, 'GET /api/crew': { bots: [] }, 'GET /api/runs': [], 'GET /api/pipelines': [] });
});

describe('App', () => {
  it('has an API tab', async () => {
    location.hash = '#/api';
    render(<App />);
    expect(screen.getByText('api screen')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'API' })).toBeTruthy();
  });

  it('hands a request gate from the API tab to the Builder once, and opens started runs', async () => {
    location.hash = '#/api';
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'gate it' }));
    expect(location.hash).toBe('#/builder');
    expect(screen.getByText(/gate runs\/list in stage/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'use gate' }));
    expect(screen.queryByText(/gate runs\/list/)).toBeNull();
    act(() => {
      location.hash = '#/api';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'started' }));
    expect(location.hash).toBe('#/runs/r9');
  });

  it('switches tabs through the hash and remembers the last run', async () => {
    location.hash = '#/runs/r5';
    render(<App />);
    expect(screen.getByText('runs screen r5')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Crew' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Crew' }));
    expect(location.hash).toBe('#/crew');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Runs' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Runs' }));
    expect(location.hash).toBe('#/runs/r5');
    act(() => {
      location.hash = '#/graph';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByText('graph screen')).toBeTruthy();
  });

  it('shows the vault and connection state', async () => {
    render(<App />);
    expect(await screen.findByText('vault · notes/aorch')).toBeTruthy();
    expect(await screen.findByText('connected')).toBeTruthy();
  });

  it('shows offline when the server is down', async () => {
    routeApi({ 'GET /api/health': new Error('down'), 'GET /api/crew': { bots: [] } });
    render(<App />);
    expect(await screen.findByText('offline')).toBeTruthy();
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
});
