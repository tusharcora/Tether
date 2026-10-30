import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type AttentionItem } from '../api';
import { Inbox } from '../home/Inbox';
import type { ProviderView } from '../settings/accountsApi';
import { Accounts } from '../settings/Accounts';
import type { TelegramView } from '../settings/Telegram';
import { calls, FakeEventSource, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { NewTeam } from './NewTeam';
import type { TeamView } from './teamsApi';
import { SquadScreen } from '../squads/SquadScreen';

beforeEach(() => {
  vi.mocked(api).mockReset();
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

const telegram = (o: Partial<ProviderView> = {}): ProviderView => ({ id: 'telegram', name: 'Telegram', kind: 'key', available: true, scopes: [], account: null, ...o });
const TG_ACCOUNT = { provider: 'telegram', login: 'tether_bot', scopes: [], via: 'key' as const, connectedAt: Date.now() - 60_000 };
const tgView = (o: Partial<TelegramView> = {}): TelegramView => ({ connected: true, bot: { username: 'tether_bot', readsAll: false }, polling: true, voice: { model: { phase: 'missing' }, size: 241_357_257, decoder: 'afconvert', engine: true, why: 'Voice notes need the speech model' }, ...o });
const accounts = (p: ProviderView) => ({ data: { user: 'tushar', providers: [p] }, error: undefined, fails: 0, refresh: vi.fn(async () => {}) });

describe('Settings → Accounts → Telegram', () => {
  it('connects with a pasted token that never sits in the DOM', async () => {
    routeApi({ 'POST /api/accounts/telegram': { account: TG_ACCOUNT } });
    const p = accounts(telegram());
    renderApp(<Accounts poll={p} />);
    const input = screen.getByLabelText('Bot token') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '123456789:AAsecret' } });
    expect(input.getAttribute('value')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(calls('POST', '/api/accounts/telegram')[0]![2]).toEqual({ token: '123456789:AAsecret' }));
    await waitFor(() => expect(p.refresh).toHaveBeenCalled());
  });

  it('connected: the bot listening, the admin hint, the /iam code, and the speech model download with progress', async () => {
    let v = tgView();
    routeApi({ 'GET /api/telegram': () => v, 'POST /api/telegram/iam': { code: 'K7M2QX', bot: 'tether_bot' }, 'POST /api/telegram/voice': () => ((v = tgView({ voice: { ...v.voice, model: { phase: 'downloading', done: 120_000_000, total: 241_357_257 } } })), v.voice) });
    renderApp(<Accounts poll={accounts(telegram({ account: TG_ACCOUNT }))} />);
    expect(await screen.findByText('listening')).toBeTruthy();
    expect(screen.getByText(/^@tether_bot · the token stays in your Keychain/)).toBeTruthy();
    expect(screen.getByText(/make the bot an admin/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Link my Telegram' }));
    expect(await screen.findByText('/iam K7M2QX')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Voice notes: download model (~241 MB)' }));
    await waitFor(() => expect(calls('POST', '/api/telegram/voice')).toHaveLength(1));
    expect(await screen.findByText('120 MB of 241 MB')).toBeTruthy();
  });
});

const owner = { id: 'owner', name: 'you' };
const maya = { id: 'tg42', name: 'Maya K.', via: 'telegram' as const, tgUserId: 42, username: 'mayak', canStartRuns: false, joinedAt: Date.now() };
const room = (o: Partial<TeamView['team']> = {}): TeamView => ({
  team: { id: 'ops', name: 'On the go', place: 'telegram', link: '-100123', project: 'app', agents: ['coder'], people: [owner, maya], approvers: ['owner'], level: 'balanced', limits: { usdPerDay: 10, runsPerDay: 20 }, learn: true, createdAt: 1, ...o },
  messages: [{ id: 'm1', at: Date.now(), from: { kind: 'person', id: 'tg42', name: 'Maya K.' }, text: '@Bolt why is this red?' }],
  members: [{ id: 'coder', name: 'Bolt', specialty: 'code', state: 'idle' }],
  queue: [],
  working: [],
  spend: { usd: 0, runs: 0 },
  status: 'idle',
});

describe('a Telegram squad’s room', () => {
  it('is a read-only mirror with the T mark; People and permissions switches people (board 7)', async () => {
    routeApi({ 'GET /api/squads/ops': room(), 'GET /api/schedules': [], 'PATCH /api/squads/ops/people/tg42': (b: unknown) => ({ ...room().team, b }) });
    renderApp(<SquadScreen id="ops" tickets={[]} agents={[]} projects={[]} onGo={vi.fn()} onChanged={vi.fn()} onNewAgent={vi.fn()} />);
    const h = await screen.findByRole('heading', { name: 'On the go' });
    expect(h.textContent).toBe('T On the go');
    expect(screen.getByText(/^app · 0 working · \$0\.00 today$/)).toBeTruthy();
    expect(screen.getByText(/lives in Telegram: talk to it in the group/)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'People and permissions' }));
    const dialog = await screen.findByRole('dialog');
    const you = within(dialog).getByRole('switch', { name: 'You can approve' }) as HTMLButtonElement;
    expect(you.getAttribute('aria-checked')).toBe('true');
    expect(you.disabled).toBe(true);
    expect(within(dialog).getByText('@mayak · Telegram · joined today')).toBeTruthy();
    expect(within(dialog).getByText('people only')).toBeTruthy();
    expect(within(dialog).getByText('via a person')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Maya K. can start runs' }));
    await waitFor(() => expect(calls('PATCH', '/api/squads/ops/people/tg42')[0]![2]).toEqual({ canStartRuns: true }));
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Maya K. can approve' }));
    await waitFor(() => expect(calls('PATCH', '/api/squads/ops/people/tg42')[1]![2]).toEqual({ approver: true }));
  });

  it('not linked yet: shows the one-time /pair code to send in the group', async () => {
    routeApi({ 'GET /api/squads/ops': room({ link: undefined }), 'GET /api/schedules': [], 'POST /api/squads/ops/pair': { code: 'P4IRME', exp: Date.now() + 600_000, bot: 'tether_bot' } });
    renderApp(<SquadScreen id="ops" tickets={[]} agents={[]} projects={[]} onGo={vi.fn()} onChanged={vi.fn()} onNewAgent={vi.fn()} />);
    expect(await screen.findByText('/pair P4IRME')).toBeTruthy();
    expect(screen.getByText(/Add @tether_bot to the group/)).toBeTruthy();
  });
});

describe('New Telegram squad', () => {
  it('sends place telegram and leaves approvers to board 7', async () => {
    routeApi({ 'POST /api/squads': (b: Record<string, unknown>) => ({ id: 'ops-1a2b', ...b }) });
    const onCreated = vi.fn();
    renderApp(<NewTeam place="telegram" agents={[{ id: 'coder', name: 'Bolt', specialty: 'code' }]} projects={[{ id: 'app', name: 'app', path: '/p', isDefault: true, exists: true, repos: [] }]} onCreated={onCreated} onCancel={vi.fn()} onNewAgent={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'New Telegram squad' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Any teammate in the channel' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'On the go' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Bolt/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create squad' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ops-1a2b'));
    expect(calls('POST', '/api/squads')[0]![2]).toEqual({ name: 'On the go', place: 'telegram', project: 'app', agents: ['coder'], level: 'balanced', limits: { usdPerDay: 10, runsPerDay: 20 }, learn: true });
  });
});

describe('Inbox: a squad’s own card', () => {
  it('a recurring ticket’s ship card is decided through its squad', async () => {
    const item: AttentionItem = { id: 'r1:team:m7', ts: Date.now(), runId: 'r1', kind: 'approval', title: 'Ship “keep main green”?', meta: 'On the go · Telegram · npm test passed', actions: ['approve', 'open'], team: { id: 'ops', name: 'On the go', place: 'telegram', msg: 'm7' } };
    routeApi({ 'GET /api/attention': { items: [item] }, 'POST /api/squads/ops/cards/m7': { id: 'm7' } });
    renderApp(<Inbox onGo={vi.fn()} goals={[]} />);
    expect(await screen.findAllByText('On the go · Telegram · npm test passed')).not.toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(calls('POST', '/api/squads/ops/cards/m7')[0]![2]).toEqual({ action: 'approve' }));
    expect(calls('POST', '/api/runs/r1/approve')).toHaveLength(0);
  });
});
