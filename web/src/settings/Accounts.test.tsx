import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import type { Poll } from '../hooks';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { Accounts, DEVICE_POLL_MS } from './Accounts';
import { FLOW_POLL_MS } from './FreeModels';
import { accountChip, type AccountsView, type ProviderView } from './accountsApi';

const SETUP = 'Signing in with GitHub needs a GitHub OAuth App with Device Flow turned on (a one-time step).';
const github = (o: Partial<ProviderView> = {}): ProviderView => ({ id: 'github', name: 'GitHub', kind: 'device', available: true, scopes: ['repo'], account: null, cli: { login: 'octo' }, device: { ready: true }, ...o });
const google: ProviderView = { id: 'google', name: 'Google', kind: 'pkce', available: false, scopes: [], account: null, note: 'Coming when a feature needs it: nothing in Tether uses Google yet.' };
const view = (gh: Partial<ProviderView> = {}): AccountsView => ({ user: 'tushar', providers: [github(gh), google] });
const poll = (data: AccountsView): Poll<AccountsView> => ({ data, error: undefined, fails: 0, refresh: vi.fn(async () => {}) });
const ghRow = () => screen.getByText('GitHub').closest('li') as HTMLElement;
const FREE = 'nvidia/nemotron-3.5-super-vl:free';
const OR_ACCOUNT = { provider: 'openrouter', login: 'Tether', scopes: [], via: 'browser' as const, connectedAt: Date.now() - 60_000 };
const openrouter = (o: Partial<ProviderView> = {}): ProviderView => ({ id: 'openrouter', name: 'OpenRouter', kind: 'pkce-key', available: true, scopes: [], account: null, setup: false, defaults: null, ...o });
const orRow = () => screen.getByText('OpenRouter').closest('li') as HTMLElement;

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('Settings → Accounts', () => {
  it('offers the GitHub CLI login with Use this, and adopts it', async () => {
    routeApi({ 'POST /api/accounts/github/cli': { account: { login: 'octo' } } });
    const p = poll(view());
    renderApp(<Accounts poll={p} />);
    expect(within(ghRow()).getByText(/Signed in via GitHub CLI as/).textContent).toContain('@octo');
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    await waitFor(() => expect(calls('POST', '/api/accounts/github/cli')).toHaveLength(1));
    await waitFor(() => expect(p.refresh).toHaveBeenCalled());
    expect(await screen.findByText(/GitHub connected/)).toBeTruthy();
  });

  it('lists Google as coming, with its reason and no connect button', () => {
    renderApp(<Accounts poll={poll(view())} />);
    const row = screen.getByText('Google').closest('li') as HTMLElement;
    expect(within(row).getByText('coming')).toBeTruthy();
    expect(within(row).getByText(/nothing in Tether uses Google yet/)).toBeTruthy();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('device flow: shows the one-time code and the GitHub link, follows pending → connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    let state: unknown = { state: 'pending', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresAt: Date.now() + 900_000 };
    routeApi({ 'POST /api/accounts/github/device': { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 }, 'GET /api/accounts/github/device': () => state });
    const p = poll(view({ cli: null }));
    renderApp(<Accounts poll={p} />);
    expect(screen.getByText(/The GitHub CLI is not signed in/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    expect(await screen.findByText('ABCD-1234')).toBeTruthy();
    expect(open).toHaveBeenCalledWith('https://github.com/login/device', '_blank', 'noopener');
    expect(screen.getByRole('link', { name: 'Open github.com/login/device' }).getAttribute('href')).toBe('https://github.com/login/device');
    expect(screen.getByText('waiting for you to approve').closest('[data-status]')!.getAttribute('data-status')).toBe('warning');
    await act(() => vi.advanceTimersByTimeAsync(DEVICE_POLL_MS));
    expect(screen.getByText('ABCD-1234')).toBeTruthy();
    state = { state: 'connected', account: { provider: 'github', login: 'octo', scopes: ['repo'], via: 'device', connectedAt: Date.now() } };
    await act(() => vi.advanceTimersByTimeAsync(DEVICE_POLL_MS));
    await waitFor(() => expect(p.refresh).toHaveBeenCalled());
    expect(await screen.findByText(/GitHub connected/)).toBeTruthy();
  });

  it('device flow: says when the code expired or access was denied, with a retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(window, 'open').mockImplementation(() => null);
    let state: unknown = { state: 'expired' };
    routeApi({ 'POST /api/accounts/github/device': { userCode: 'WXYZ-0000', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 }, 'GET /api/accounts/github/device': () => state });
    renderApp(<Accounts poll={poll(view())} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    await screen.findByText('WXYZ-0000');
    await act(() => vi.advanceTimersByTimeAsync(DEVICE_POLL_MS));
    expect(await screen.findByText('The code expired before it was approved.')).toBeTruthy();
    state = { state: 'denied' };
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('WXYZ-0000');
    await act(() => vi.advanceTimersByTimeAsync(DEVICE_POLL_MS));
    expect(await screen.findByText('GitHub access was denied.')).toBeTruthy();
  });

  it('without a client id, explains the one-time setup and saves the id', async () => {
    let saved: unknown;
    routeApi({ 'PUT /api/accounts/github/client': (b: unknown) => ((saved = b), { ready: true }) });
    const p = poll(view({ device: { ready: false, setup: SETUP } }));
    renderApp(<Accounts poll={p} />);
    expect(screen.getByText(SETUP)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in with GitHub' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Use this' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('OAuth App client id'), { target: { value: ' Iv1.abc ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toEqual({ clientId: 'Iv1.abc' }));
    expect(p.refresh).toHaveBeenCalled();
  });

  it('shows who is connected, how, the scopes, and disconnects after asking', async () => {
    routeApi({ 'DELETE /api/accounts/github': { ok: true } });
    const p = poll(view({ account: { provider: 'github', login: 'octo', scopes: ['repo', 'read:user'], via: 'gh', connectedAt: Date.now() - 60_000 } }));
    renderApp(<Accounts poll={p} />);
    expect(within(ghRow()).getByText('connected').closest('[data-status]')!.getAttribute('data-status')).toBe('success');
    expect(within(ghRow()).getByText(/via the GitHub CLI/).textContent).toContain('@octo');
    expect(within(screen.getByLabelText('Scopes')).getAllByRole('code').map((c) => c.textContent)).toEqual(['repo', 'read:user']);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(screen.getByText(/gh itself stays signed in/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' }).at(-1)!);
    await waitFor(() => expect(calls('DELETE', '/api/accounts/github')).toHaveLength(1));
  });

  it('OpenRouter: Connect opens the approval page and follows it until connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const url = 'https://openrouter.ai/auth?callback_url=http%3A%2F%2Flocalhost%3A5050%2Foauth%2Fcallback&state=s';
    let state: unknown = { state: 'pending', url };
    routeApi({ 'POST /api/accounts/openrouter': { url }, 'GET /api/accounts/openrouter/flow': () => state });
    const p = poll({ user: 'tushar', providers: [openrouter(), github()] });
    renderApp(<Accounts poll={p} />);
    expect(within(orRow()).getByText(/approve once in your browser, no key to copy/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect OpenRouter' }));
    expect(await screen.findByRole('link', { name: 'Open the OpenRouter approval page' })).toBeTruthy();
    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener');
    state = { state: 'connected', bound: ['coder'] };
    await act(() => vi.advanceTimersByTimeAsync(FLOW_POLL_MS));
    await waitFor(() => expect(p.refresh).toHaveBeenCalled());
    expect(await screen.findByText(/OpenRouter connected/)).toBeTruthy();
  });

  it('OpenRouter connected: the free requests left, the credits link and the free defaults', async () => {
    routeApi({ 'GET /api/accounts/openrouter/allowance': { used: 18, limit: 50, remaining: 32, resetsAt: new Date(2026, 9, 29, 2, 0).getTime() } });
    renderApp(<Accounts poll={poll({ user: 'tushar', providers: [openrouter({ account: OR_ACCOUNT, defaults: { crew: FREE, assistant: FREE, fallback: false } })] })} />);
    expect(await within(orRow()).findByText('32 of 50 free requests left today')).toBeTruthy();
    expect(within(orRow()).getByText('resets 02:00')).toBeTruthy();
    expect(within(orRow()).getByRole('meter', { name: 'Free requests left today' }).getAttribute('aria-valuenow')).toBe('32');
    expect(within(orRow()).getByRole('link', { name: 'Add $10 of credits ↗' }).getAttribute('href')).toBe('https://openrouter.ai/settings/credits');
    expect(within(screen.getByLabelText('Free defaults')).getAllByRole('code').map((c) => c.textContent)).toEqual(['crew · nemotron-3.5-super-vl:free', '⌘J · nemotron-3.5-super-vl:free']);
    expect(screen.queryByRole('button', { name: 'Use free models for the crew' })).toBeNull();
  });

  it('OpenRouter connected while other agents run the crew: Use free models for the crew, and Disconnect', async () => {
    routeApi({ 'GET /api/accounts/openrouter/allowance': { used: 0, limit: 1000, remaining: 1000, resetsAt: Date.now() + 3_600_000 }, 'POST /api/accounts/openrouter/crew': { bound: ['coder', 'planner'] }, 'DELETE /api/accounts/openrouter': { ok: true } });
    const p = poll({ user: 'tushar', providers: [openrouter({ account: OR_ACCOUNT, defaults: { fallback: false } })] });
    renderApp(<Accounts poll={p} />);
    expect(await within(orRow()).findByText('1000 of 1000 free requests left today')).toBeTruthy();
    expect(within(orRow()).queryByRole('link', { name: /Add \$10/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use free models for the crew' }));
    expect(await screen.findByText(/2 bots now run on free models/)).toBeTruthy();
    expect(calls('POST', '/api/accounts/openrouter/crew')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' }).at(-1)!);
    await waitFor(() => expect(calls('DELETE', '/api/accounts/openrouter')).toHaveLength(1));
  });

  it('gives the sidebar the account’s name and GitHub chip, or the local user and Connect', () => {
    expect(accountChip(view({ account: { provider: 'github', login: 'octo', name: 'Octo Cat', scopes: [], via: 'device', connectedAt: 1 } }))).toEqual({ name: 'Octo Cat', provider: 'GitHub' });
    expect(accountChip(view())).toEqual({ name: 'tushar' });
    expect(accountChip(undefined)).toEqual({ name: 'You' });
  });
});
