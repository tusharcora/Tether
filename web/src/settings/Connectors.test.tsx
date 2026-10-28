import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { ConnectorMap, Connectors, ring, STATUS, type ConnectorView } from './Connectors';

const c = (name: string, status: ConnectorView['status'], o: Partial<ConnectorView> = {}): ConnectorView => ({ name, summary: `the ${name}`, status, permissions: ['Reads things'], recent: [], ...o });
const list = [c('repo', 'connected'), c('github', 'needs', { note: 'A call is waiting for your approval.', recent: [{ at: Date.now(), what: 'comment on a/b#3', kind: 'approval', state: 'pending' }] }), c('mcp.files', 'off')];
const poll = (connectors: ConnectorView[]) => ({ data: { connectors }, error: undefined, fails: 0, refresh: async () => {} });

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('connectors', () => {
  it('colours status by meaning and names it', () => {
    expect(STATUS.connected.tone).toBe('done');
    expect(STATUS.needs.tone).toBe('needs');
    expect(STATUS.off.tone).toBe('idle');
    expect(ring(4, 100, 50)[0]).toEqual({ x: 0, y: -50 });
  });

  it('lists every connector with its status, and tests one', async () => {
    routeApi({ 'POST /api/codemode/connectors/repo/test': { ok: true, detail: 'Built in' } });
    renderApp(<Connectors poll={poll(list)} />);
    const rows = within(screen.getByRole('list', { name: 'Connectors' })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText('Needs you')).toBeTruthy();
    expect(within(rows[2]!).getByText('Off')).toBeTruthy();
    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Test' }));
    await waitFor(() => expect(calls('POST', '/api/codemode/connectors/repo/test')).toHaveLength(1));
  });

  it('draws the map with a fan per connector and a panel for the one picked, with room between them', () => {
    renderApp(<ConnectorMap connectors={list} onAdd={() => {}} />);
    expect(screen.getByText('Code Mode · run_code')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add connector' })).toBeTruthy();
    const fan = screen.getByRole('toolbar', { name: 'github actions' });
    expect(within(fan).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Test', 'Reconnect', 'Permissions', 'Settings']);
    expect(screen.getByLabelText('Connector details').style.marginTop).toBe('72px');
    fireEvent.click(within(fan).getByRole('button', { name: 'Permissions' }));
    const panel = within(screen.getByLabelText('Connector details'));
    expect(panel.getByText('A call is waiting for your approval.')).toBeTruthy();
    expect(panel.getByText('comment on a/b#3')).toBeTruthy();
  });
});
