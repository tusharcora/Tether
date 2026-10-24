import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { calls, routeApi } from './test/fixtures';
import { renderApp } from './test/render';
import { Triggers } from './Triggers';

const trig = (o = {}) => ({ id: 'acme-full-review', repo: 'acme/api', workflow: 'full-review', status: 'idle', last: null, enabled: true, ...o });
const setup = (hasSecret: boolean) => ({ payloadPath: '/api/webhooks/github', hasSecret, secretHint: hasSecret ? 'ab12' : null, secretSource: hasSecret ? 'file' : null, eventsToSelect: ['Pull requests'], contentType: 'application/json' });
let triggers = [trig()];

beforeEach(() => {
  vi.mocked(api).mockReset();
  triggers = [trig()];
  routeApi({
    'GET /api/triggers': () => triggers,
    'GET /api/triggers/deliveries': [],
    'GET /api/triggers/setup': setup(true),
    'GET /api/workspaces': [],
    'GET /api/pipelines': [{ name: 'full-review', nodes: 5 }],
    'GET /api/bots': { agents: { claude: { ok: true, models: [] } } },
    'PATCH /api/triggers/acme-full-review': {},
    'DELETE /api/triggers/acme-full-review': {},
    'POST /api/triggers': (b: unknown) => ({ ...trig(), ...(b as object), id: 'acme-full-review' }),
    'POST /api/triggers/acme-full-review/test': (b: unknown) => ({ matches: true, why: '', fired: (b as { fire: boolean }).fire, runId: (b as { fire: boolean }).fire ? 'r9' : undefined, pr: { repo: 'acme/api', number: 12, title: 'Fix bug', url: 'u' } }),
    'POST /api/triggers/setup/secret': { secret: 'new-secret-value' },
  });
});

describe('Triggers', () => {
  it('pauses and deletes a trigger', async () => {
    renderApp(<Triggers />);
    fireEvent.click(await screen.findByRole('switch', { name: /Pause acme-full-review/ }));
    await waitFor(() => expect(calls('PATCH', '/api/triggers/acme-full-review')[0]![2]).toEqual({ enabled: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' })));
    expect(calls('DELETE', '/api/triggers/acme-full-review')).toHaveLength(1);
  });

  it('saves a new trigger with split lists', async () => {
    renderApp(<Triggers />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New trigger' }));
    fireEvent.change(screen.getByLabelText('Repo'), { target: { value: 'acme/api' } });
    fireEvent.change(screen.getByLabelText('Events'), { target: { value: 'opened, labeled' } });
    fireEvent.change(screen.getByLabelText('Only with labels'), { target: { value: 'aorch' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(calls('POST', '/api/triggers')[0]![2]).toMatchObject({ repo: 'acme/api', workflow: 'full-review', events: ['opened', 'labeled'], labels: ['aorch'], workspace: '', agent: '' });
  });

  it('dry-runs and fires only after confirming', async () => {
    renderApp(<Triggers />);
    fireEvent.change(await screen.findByLabelText('Pull request'), { target: { value: 'https://github.com/acme/api/pull/12' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dry run' })));
    expect(await screen.findByText(/Would start a run/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fire for real…' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, fire' })));
    expect(calls('POST', '/api/triggers/acme-full-review/test')[1]![2]).toEqual({ pr: 'https://github.com/acme/api/pull/12', fire: true });
    expect(await screen.findByText(/Started run r9/)).toBeTruthy();
  });

  it('asks before regenerating an existing secret and shows the new one', async () => {
    renderApp(<Triggers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate secret' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Regenerate' })));
    expect(await screen.findByText('new-secret-value')).toBeTruthy();
  });

  it('renders the status dot with the trigger status class', async () => {
    triggers = [trig(), trig({ id: 'acme-paused', status: 'paused', enabled: false })];
    renderApp(<Triggers />);
    await screen.findByRole('switch', { name: /Enable acme-paused/ });
    expect(document.querySelector('.trig-scroll .dot.idle')).toBeTruthy();
    expect(document.querySelector('.trig-scroll .dot.paused')).toBeTruthy();
  });

  it('keeps focus on a row control across polls', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderApp(<Triggers />);
    const sw = await screen.findByRole('switch', { name: /Pause acme-full-review/ });
    sw.focus();
    triggers = [trig({ status: 'active' })];
    await act(() => vi.advanceTimersByTimeAsync(5100));
    expect(calls('GET', '/api/triggers').length).toBeGreaterThan(1);
    expect(screen.getByText('active')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('switch', { name: /Pause acme-full-review/ }));
  });
});
