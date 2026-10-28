import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { calls, routeApi } from './test/fixtures';
import { cssRule } from './test/css';
import { renderApp } from './test/render';
import { Triggers } from './Triggers';

const trig = (o = {}) => ({ id: 'acme-full-review', repo: 'acme/api', workflow: 'full-review', status: 'idle', last: null, enabled: true, ...o });
const setup = (hasSecret: boolean) => ({ payloadPath: '/api/webhooks/github', hasSecret, secretHint: hasSecret ? 'ab12' : null, secretSource: hasSecret ? 'file' : null, eventsToSelect: ['Pull requests'], contentType: 'application/json' });
let triggers = [trig()];

const baseRoutes = () => ({
  'GET /api/triggers': () => triggers,
  'GET /api/triggers/deliveries': [] as unknown,
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

beforeEach(() => {
  vi.mocked(api).mockReset();
  triggers = [trig()];
  routeApi(baseRoutes());
});

const openCard = async (id = 'acme-full-review') => fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Open ${id}`) }));
const setupDock = async () => fireEvent.click(await screen.findByRole('button', { name: 'Setup & test' }));

describe('Triggers', () => {
  it('shows the ascii skeleton while triggers load', () => {
    routeApi({ 'GET /api/triggers': new Promise(() => {}), 'GET /api/triggers/deliveries': [], 'GET /api/triggers/setup': setup(true), 'GET /api/workspaces': [], 'GET /api/pipelines': [], 'GET /api/bots': { agents: {} } });
    const { container } = renderApp(<Triggers />);
    expect(screen.getByRole('status', { name: 'Loading triggers' })).toBeTruthy();
    expect(container.querySelector('[data-ascii-skeleton]')).toBeTruthy();
  });
  it('pauses and deletes a trigger', async () => {
    renderApp(<Triggers />);
    fireEvent.click(await screen.findByRole('switch', { name: /Pause acme-full-review/ }));
    await waitFor(() => expect(calls('PATCH', '/api/triggers/acme-full-review')[0]![2]).toEqual({ enabled: false }));
    await openCard();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' })));
    expect(calls('DELETE', '/api/triggers/acme-full-review')).toHaveLength(1);
  });

  it('opens the new trigger form when the Create menu asks for one', async () => {
    renderApp(<Triggers create={1} />);
    expect(await screen.findByLabelText('Repo')).toBeTruthy();
  });

  it('saves a new trigger with split lists', async () => {
    renderApp(<Triggers />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New trigger' }));
    expect(screen.getByRole('complementary', { name: 'Trigger' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Repo'), { target: { value: 'acme/api' } });
    fireEvent.change(screen.getByLabelText('Events'), { target: { value: 'opened, labeled' } });
    fireEvent.change(screen.getByLabelText('Only with labels'), { target: { value: 'aorch' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(calls('POST', '/api/triggers')[0]![2]).toMatchObject({ repo: 'acme/api', workflow: 'full-review', events: ['opened', 'labeled'], labels: ['aorch'], workspace: '', agent: '' });
  });

  it('dry-runs and fires only after confirming', async () => {
    renderApp(<Triggers />);
    await setupDock();
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
    await setupDock();
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate secret' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Regenerate' })));
    expect(await screen.findByText('new-secret-value')).toBeTruthy();
  });

  it('renders the status dot with the trigger status class', async () => {
    triggers = [trig(), trig({ id: 'acme-paused', status: 'paused', enabled: false })];
    renderApp(<Triggers />);
    await screen.findByRole('switch', { name: /Enable acme-paused/ });
    expect(document.querySelector('.tg-dot[data-status="idle"]')).toBeTruthy();
    expect(document.querySelector('.tg-dot[data-status="paused"]')).toBeTruthy();
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

  it('lists deliveries with run links and reasons, sorts them and filters by trigger', async () => {
    const now = Date.now();
    const deliveries = [
      { at: new Date(now - 60_000).toISOString(), trigger: 'zeta', source: 'webhook', repo: 'acme/api', pr: 41, outcome: 'skipped', reason: 'draft PR (include drafts is off)' },
      { at: new Date(now - 1_000).toISOString(), trigger: 'acme-full-review', source: 'webhook', repo: 'acme/api', pr: 42, outcome: 'started', runId: 'r7' },
    ];
    routeApi({ ...baseRoutes(), 'GET /api/triggers/deliveries': deliveries });
    renderApp(<Triggers />);
    const log = await screen.findByRole('region', { name: 'Delivery log' });
    expect(await within(log).findByRole('link', { name: 'Open the run →' })).toHaveProperty('hash', '#/runs/r7');
    expect(within(log).getByText('draft PR (include drafts is off)')).toBeTruthy();
    const order = () => [...log.querySelectorAll('.tg-delivery .tg-what')].map((e) => e.textContent);
    expect(order()).toEqual(['acme/api#42', 'acme/api#41']);
    const when = within(log).getByRole('columnheader', { name: /When/ });
    expect(when.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(within(when).getByRole('button'));
    expect(order()).toEqual(['acme/api#41', 'acme/api#42']);
    fireEvent.click(within(log).getByRole('button', { name: /^Trigger/ }));
    expect(order()).toEqual(['acme/api#42', 'acme/api#41']);
    fireEvent.click(within(log).getByRole('button', { name: /^Pull request/ }));
    expect(order()).toEqual(['acme/api#41', 'acme/api#42']);
    // a row opens what the delivery said and did
    fireEvent.click(within(log).getByRole('row', { name: /acme\/api#41, skipped/ }));
    expect((await within(log).findAllByText('Delivery details')).length).toBeGreaterThan(0);
    expect(within(log).getByRole('log').textContent).toContain('reason   draft PR (include drafts is off)');
    await openCard();
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    await waitFor(() => expect(calls('GET', '/api/triggers/deliveries?trigger=acme-full-review&limit=50').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('menuitem', { name: 'acme-full-review' }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'all triggers' }));
    await waitFor(() => expect(calls('GET', '/api/triggers/deliveries?limit=50').length).toBeGreaterThan(1));
    // the log is a bottom-wide bar that stops short of the assistant launcher
    expect(log.closest('.tf-bar')!.classList.contains('tf-wide')).toBe(true);
  });

  it('draws Event → Filter → Workflow for the selected trigger, with the fans and "All events" when nothing filters', async () => {
    renderApp(<Triggers />);
    const flow = await screen.findByRole('region', { name: 'acme-full-review flow' });
    expect(within(flow).getByText('All events')).toBeTruthy();
    const names = (n: string) => within(within(flow).getByRole('toolbar', { name: n })).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names('Event actions')).toEqual(['Test fire', 'Pause trigger', 'Copy URL', 'Settings']);
    expect(names('Workflow actions')).toEqual(['Open workflow', 'Run now', 'Settings']);
    fireEvent.click(within(flow).getByRole('button', { name: 'Pause trigger' }));
    await waitFor(() => expect(calls('PATCH', '/api/triggers/acme-full-review')[0]![2]).toEqual({ enabled: false }));
    // Test fire is the existing test panel, which calls the existing endpoint
    fireEvent.click(within(flow).getByRole('button', { name: 'Test fire' }));
    // the test panel now opens in the dock, which focuses the field once it is up
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Pull request')));
    fireEvent.change(screen.getByLabelText('Pull request'), { target: { value: 'https://github.com/acme/api/pull/12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dry run' }));
    await waitFor(() => expect(calls('POST', '/api/triggers/acme-full-review/test')[0]![2]).toEqual({ pr: 'https://github.com/acme/api/pull/12', fire: false }));
  });

  it('opens Setup & test in the dock with the PR field focused, and Test on a trigger picks it there', async () => {
    triggers = [trig(), trig({ id: 'acme-two' })];
    renderApp(<Triggers />);
    await screen.findByRole('switch', { name: /Pause acme-full-review/ });
    await setupDock();
    const dock = screen.getByRole('complementary', { name: 'Setup & test' });
    expect(within(dock).getByText('Payload URL')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Pull request')));
    await openCard('acme-two');
    expect(screen.queryByRole('complementary', { name: 'Setup & test' })).toBeNull();
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Trigger' })).getByRole('button', { name: 'Test' }));
    expect(screen.getByRole('complementary', { name: 'Setup & test' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Trigger to test' }).textContent).toContain('acme-two');
  });

  it('opens a trigger card in the dock to edit it, and Esc closes it', async () => {
    renderApp(<Triggers />);
    await openCard();
    const dock = screen.getByRole('complementary', { name: 'Trigger' });
    expect(within(dock).getByRole('heading', { name: 'acme-full-review' })).toBeTruthy();
    expect((within(dock).getByLabelText('Repo') as HTMLInputElement).value).toBe('acme/api');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Trigger' })).toBeNull();
  });

  it('sizes the loading wrapper to the screen so the cards and the log sit in the frame', () => {
    // AsciiReveal positions the wrapper inline; the absolute card column inside it needs it to fill the screen
    expect(cssRule('triggers/triggers.css', '.tg-load')).toContain('height: 100%');
    expect(cssRule('triggers/triggers.css', '.tg-cards')).toContain('inset: 0');
    // the webhook setup is one column inside the 320 px dock
    expect(cssRule('triggers/triggers.css', '.tf-dock .tg-dl')).toContain('grid-template-columns: 1fr');
  });

  it('says so in one quiet line when there are no triggers, with New trigger and Setup & test', async () => {
    triggers = [];
    renderApp(<Triggers />);
    expect(await screen.findByText(/^No triggers yet/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '+ New trigger' }).length).toBeGreaterThan(1);
    expect(screen.getAllByRole('button', { name: 'Setup & test' }).length).toBeGreaterThan(1);
  });
});
