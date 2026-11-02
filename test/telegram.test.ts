/**
 * Teams in a Telegram group, driven by recorded-shape Bot API updates against a fake Bot API (no network): pairing, /iam,
 * what is ignored, ping/task/loop, the permission refusals, buttons and Inbox parity both ways, edits in place and their
 * gap, the pinned status, /mute, photos, voice notes and polling with backoff.
 */
import { describe, expect, it } from 'vitest';
import type { SecretStore } from '../src/accounts/secretStore.js';
import { accountOf, setAccount } from '../src/accounts/store.js';
import { OWNER } from '../src/teams/store.js';
import { TelegramError, type BotApi } from '../src/teams/telegram/api.js';
import { NO_MODEL, Telegram, type Voice } from '../src/teams/telegram/bot.js';
import { editTg, loadTg } from '../src/teams/telegram/store.js';
import { rig } from './teams-rig.js';

const CHAT = -1001234567890;
const TOKEN = '123456789:AAFakeTokenFakeTokenFakeTokenXYZ';
type Call = { method: string; params: Record<string, any>; at: number };

/** A fake Bot API: answers every method, records each call; getUpdates waits for `feed` (or for the poller to stop). */
function fakeApi() {
  const calls: Call[] = [];
  let n = 5000;
  const handlers: Record<string, (p: Record<string, any>) => unknown> = {};
  const batches: unknown[][] = [];
  let wake: (() => void) | undefined;
  const api: BotApi = {
    async call<T>(method: string, params: Record<string, any> = {}, o: { signal?: AbortSignal } = {}): Promise<T> {
      if (method === 'getUpdates' && !handlers.getUpdates) {
        calls.push({ method, params, at: Date.now() });
        while (!batches.length) {
          if (o.signal?.aborted) throw new Error('aborted');
          await new Promise<void>((r) => ((wake = r), o.signal?.addEventListener('abort', () => r(), { once: true })));
        }
        return batches.shift() as T;
      }
      calls.push({ method, params, at: Date.now() });
      if (handlers[method]) return handlers[method]!(params) as T;
      if (method === 'sendMessage') return { message_id: ++n } as T;
      if (method === 'getFile') return { file_path: `files/${String(params.file_id)}.oga` } as T;
      if (method === 'getMe') return { id: 999, username: 'tether_bot', first_name: 'Tether', can_read_all_group_messages: false } as T;
      return true as T;
    },
    async download(path: string) {
      calls.push({ method: 'download', params: { path }, at: Date.now() });
      return Buffer.from(`bytes of ${path}`);
    },
  };
  const of = (method: string) => calls.filter((c) => c.method === method);
  const texts = () => of('sendMessage').map((c) => String(c.params.text));
  const feed = (...updates: unknown[]) => (batches.push(updates), wake?.());
  return { api, calls, handlers, of, texts, feed };
}

const memStore = (): SecretStore & { items: Map<string, string> } => {
  const items = new Map<string, string>();
  return { kind: 'file', items, get: async (a) => items.get(a), set: async (a, v) => void items.set(a, v), delete: async (a) => void items.delete(a) };
};

const TUSHAR = { id: 7, is_bot: false, first_name: 'Tushar' };
const MAYA = { id: 42, is_bot: false, first_name: 'Maya', last_name: 'K.', username: 'mayak' };
const JON = { id: 43, is_bot: false, first_name: 'Jon' };
const OTHER_BOT = { id: 77, is_bot: true, first_name: 'Spam', username: 'spam_bot' };

function tgRig(o: { link?: boolean; owner?: boolean; level?: 'tight' | 'balanced' | 'loose'; readsImages?: boolean; voice?: Voice } = {}) {
  const r = rig({ place: 'telegram', ...(o.level ? { level: o.level } : {}) });
  if (o.link !== false) r.teams.setLink(r.team.id, String(CHAT));
  const f = fakeApi();
  const secrets = memStore();
  const tg = new Telegram({ home: r.home, teams: r.teams, store: r.store, goals: r.goals, secrets, api: () => f.api, editGapMs: 40, backoffMs: 5, readsImages: async () => !!o.readsImages, ...(o.voice ? { voice: o.voice } : {}) });
  setAccount(r.home, 'telegram', { provider: 'telegram', login: 'tether_bot', scopes: [], via: 'key', connectedAt: 1 });
  editTg(r.home, (s) => {
    s.bot = { id: 999, username: 'tether_bot', readsAll: true };
    if (o.owner !== false) s.owner = { id: TUSHAR.id, name: 'Tushar' };
  });
  tg.start(f.api);
  let uid = 1;
  let mid = 100;
  const msg = (from: object, text: string, extra: object = {}, chat: object = { id: CHAT, type: 'supergroup', title: 'On the go' }) => ({ update_id: uid++, message: { message_id: mid++, date: 0, chat, from, text, ...extra } });
  const press = (from: object, data: string, message_id = 1) => ({ update_id: uid++, callback_query: { id: `q${uid}`, from, data, message: { message_id, chat: { id: CHAT, type: 'supergroup' } } } });
  const send = async (u: Record<string, unknown>) => {
    await tg.handle(u);
    await settle();
  };
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await r.idle();
      await tg.idle();
    }
  };
  /** The Telegram id a team message was sent as. */
  const tgIdOf = (msgId: string) => loadTg(r.home).teams[r.team.id]?.msgs[msgId];
  const answers = () => f.of('answerCallbackQuery').map((c) => c.params.text as string | undefined);
  return { ...r, f, tg, secrets, msg, press, send, settle, tgIdOf, answers };
}

describe('connecting a bot', () => {
  it('checks the token with getMe, keeps it in the secret store, sets the command menu; disconnect forgets it', async () => {
    const r = rig({ place: 'telegram' });
    const f = fakeApi();
    const secrets = memStore();
    const tg = new Telegram({ home: r.home, teams: r.teams, store: r.store, secrets, api: () => f.api });
    await expect(tg.connect('nope')).rejects.toThrow(/not a bot token/);
    const a = await tg.connect(TOKEN);
    expect(a).toMatchObject({ provider: 'telegram', login: 'tether_bot', via: 'key' });
    expect(secrets.items.get('telegram')).toBe(TOKEN);
    expect(JSON.stringify(accountOf(r.home, 'telegram'))).not.toContain(TOKEN);
    expect(JSON.stringify(loadTg(r.home))).not.toContain(TOKEN);
    expect(f.of('setMyCommands')[0]!.params.commands.map((c: { command: string }) => c.command)).toEqual(['status', 'runs', 'new', 'mute']);
    expect(tg.view()).toMatchObject({ connected: true, bot: { username: 'tether_bot', readsAll: false } });
    await tg.disconnect();
    expect(secrets.items.has('telegram')).toBe(false);
    expect(tg.view()).toMatchObject({ connected: false, polling: false });
    f.handlers.getMe = () => {
      throw new TelegramError('Telegram: Unauthorized', 401);
    };
    await expect(tg.connect(TOKEN)).rejects.toThrow(/did not accept/);
  });
});

describe('pairing and /iam', () => {
  it('a group links to a team with its one-time code; a wrong or used code links nothing', async () => {
    const r = tgRig({ link: false });
    const { code } = r.tg.pairCode(r.team.id);
    await r.send(r.msg(MAYA, '/pair WRONG1'));
    expect(r.now().link).toBeUndefined();
    expect(r.f.texts().at(-1)).toMatch(/not valid any more/);
    await r.send(r.msg(MAYA, `/pair@tether_bot ${code}`));
    expect(r.now().link).toBe(String(CHAT));
    expect(r.f.texts().some((t) => /Linked to the Tether team “<b>Core<\/b>”/.test(t))).toBe(true);
    // the pinned status goes up at once
    expect(r.f.of('pinChatMessage')).toHaveLength(1);
    expect(loadTg(r.home).teams[r.team.id]!.pin).toBe(r.f.of('pinChatMessage')[0]!.params.message_id);
    // Maya paired, so she is a person, with both switches off
    expect(r.now().people.find((p) => p.id === 'tg42')).toMatchObject({ name: 'Maya K.', username: 'mayak', canStartRuns: false });
    const other = { id: -1009, type: 'group', title: 'Elsewhere' };
    await r.send(r.msg(MAYA, `/pair ${code}`, {}, other));
    expect(r.f.texts().at(-1)).toMatch(/not valid any more/);
    expect(() => r.tg.pairCode(r.team.id)).toThrow(/already linked/);
  });

  it('/iam in a private chat makes that Telegram user the owner; nothing else works in private', async () => {
    const r = tgRig({ owner: false });
    await r.send(r.msg(TUSHAR, 'hello'));
    expect(r.now().people.map((p) => p.id)).toEqual(['owner', 'tg7']);
    const { code } = r.tg.iamCode();
    const dm = { id: 7, type: 'private' };
    const before = r.f.calls.length;
    await r.send(r.msg(TUSHAR, '@Bolt fix the thing', {}, dm));
    expect(r.f.calls.length).toBe(before);
    await r.send(r.msg(TUSHAR, `/iam ${code}`, {}, dm));
    expect(loadTg(r.home).owner).toEqual({ id: 7, name: 'Tushar' });
    expect(r.now().people.map((p) => p.id)).toEqual(['owner']);
    expect(r.f.texts().at(-1)).toMatch(/linked as the owner/);
  });
});

describe('what is ignored', () => {
  it('an unlinked group, another bot, a channel post: nothing happens and nothing is sent', async () => {
    const r = tgRig();
    const before = r.f.calls.length;
    await r.send(r.msg(MAYA, '@Bolt fix the thing', {}, { id: -1005, type: 'supergroup' }));
    await r.send(r.msg(OTHER_BOT, '@Bolt fix the thing'));
    await r.send({ update_id: 99, channel_post: { message_id: 1, chat: { id: CHAT, type: 'channel' }, text: '@Bolt fix' } });
    await r.send(r.press(OTHER_BOT, 'a|m1'));
    expect(r.msgs()).toEqual([]);
    expect(r.store.listRows()).toHaveLength(0);
    expect(r.f.calls.slice(before).map((c) => c.method)).toEqual(['answerCallbackQuery']);
    expect(r.now().people.map((p) => p.id)).toEqual(['owner']);
  });
});

describe('talking to agents in the group', () => {
  it('a ping gets one labelled answer (typing while it is written)', async () => {
    const r = tgRig();
    await r.send(r.msg(TUSHAR, '@Lens what does the README say?'));
    expect(r.msgs()[0]).toMatchObject({ from: { id: 'owner', name: 'Tushar' } });
    // the placeholder is never posted: only the written answer is
    expect(r.f.texts().filter((t) => t.startsWith('<b>Lens</b>'))).toEqual(['<b>Lens</b>: It says fixture.']);
  });

  it('a task: its run card is sent once and edited in place; the ship card has Approve / Reject / Diff', async () => {
    const r = tgRig();
    await r.send(r.msg(TUSHAR, '@Bolt fix the thing'));
    const runId = await r.until(() => r.tasks()[0]?.runId);
    await r.engine.wait(runId);
    await r.settle();
    const card = r.msgs().find((m) => m.card?.kind === 'run')!;
    const tgId = r.tgIdOf(card.id)!;
    expect(r.f.of('sendMessage').filter((c) => /R-/.test(c.params.text) && /On it/.test(c.params.text))).toHaveLength(1);
    const edits = r.f.of('editMessageText').filter((c) => c.params.message_id === tgId);
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.at(-1)!.params.text).toMatch(/Work ✓ · tests ✓ · Approve ship ▸\npaused/);
    // edits of one message keep their gap
    for (let i = 1; i < edits.length; i++) expect(edits[i]!.at - edits[i - 1]!.at).toBeGreaterThanOrEqual(35);
    const ship = r.msgs().find((m) => m.card?.kind === 'approval')!;
    const sent = r.f.of('sendMessage').find((c) => c.params.reply_markup && /Ship/.test(c.params.text))!;
    expect(sent.params.reply_markup.inline_keyboard[0].map((b: { callback_data: string }) => b.callback_data)).toEqual([`a|${ship.id}`, `r|${ship.id}`, `f|${ship.id}`]);
  });

  it('a loop from the owner becomes a goal', async () => {
    const r = tgRig();
    await r.send(r.msg(TUSHAR, '@Probe keep `test -f fix.txt` passing, 2 runs'));
    const goal = await r.until(() => r.goals.db.list()[0]);
    expect(goal).toMatchObject({ team: r.team.id, agent: 'tester', maxRuns: 2 });
    await r.until(() => ['met', 'stopped', 'paused'].includes(r.goals.db.must(goal.id).status));
    await r.settle();
    expect(r.f.texts().some((t) => /^<b>Probe<\/b>: On it\. I made it a loop/.test(t))).toBe(true);
  });

  it('/new forces a task on the first agent; /status and /runs answer in the group', async () => {
    const r = tgRig({ level: 'loose' });
    await r.send(r.msg(TUSHAR, '/new the back button is broken'));
    const runId = await r.until(() => r.tasks()[0]?.runId);
    expect(r.tasks()[0]).toMatchObject({ agent: 'coder', task: 'the back button is broken', by: 'owner' });
    await r.engine.wait(runId);
    await r.settle();
    await r.send(r.msg(TUSHAR, '/runs'));
    expect(r.f.texts().at(-1)).toMatch(new RegExp(`^<b>R-${runId.slice(-4).toUpperCase()}</b> · the back button is broken · done · \\$0\\.00 · <a href="https://github.com/o/r/pull/7">PR #7</a>`));
    await r.send(r.msg(TUSHAR, '/status'));
    expect(r.f.texts().at(-1)).toMatch(/^<b>Nothing running<\/b>\n0 live · 0 need you · \$0\.00 of \$10\.00 today$/);
  });
});

describe('permissions, from the group', () => {
  it('a person without "Can start runs": a proposal, told once; their Start is refused; an allowed person starts it', async () => {
    const r = tgRig();
    await r.send(r.msg(MAYA, '@Bolt fix the thing'));
    expect(r.store.listRows()).toHaveLength(0);
    const prop = r.msgs().find((m) => m.card?.kind === 'proposal')!;
    const sent = r.f.of('sendMessage').find((c) => /Maya K\. asked/.test(c.params.text))!;
    expect(sent.params.reply_markup.inline_keyboard[0].map((b: { text: string }) => b.text)).toEqual(['Start run', 'Edit', 'Dismiss']);
    expect(r.f.texts().filter((t) => /Can start runs/.test(t))).toHaveLength(1);
    await r.send(r.press(MAYA, `s|${prop.id}`));
    expect(r.answers().at(-1)).toMatch(/Can start runs/);
    expect(r.store.listRows()).toHaveLength(0);
    await r.send(r.msg(JON, 'hi'));
    r.teams.setPerson(r.team.id, 'tg43', { canStartRuns: true });
    await r.send(r.press(JON, `s|${prop.id}`));
    expect(r.answers().at(-1)).toBe('Started');
    expect(r.tasks()[0]).toMatchObject({ by: 'tg43' });
    await r.engine.wait(r.tasks()[0]!.runId);
    await r.settle();
    expect(r.f.of('editMessageText').some((c) => c.params.message_id === r.tgIdOf(prop.id) && /Started R-\w{4} by Jon/.test(c.params.text))).toBe(true);
  });

  it('Edit asks for the task as a reply; the reply starts it (still permission-checked)', async () => {
    const r = tgRig();
    await r.send(r.msg(MAYA, '@Bolt fix the thing'));
    const prop = r.msgs().find((m) => m.card?.kind === 'proposal')!;
    await r.send(r.press(TUSHAR, `e|${prop.id}`));
    const ask = r.f.of('sendMessage').at(-1)!;
    expect(ask.params.reply_markup).toMatchObject({ force_reply: true });
    const promptId = r.f.of('sendMessage').length + 5000;
    await r.send(r.msg(TUSHAR, 'fix the thing, with a test', { reply_to_message: { message_id: promptId } }));
    expect(r.tasks()[0]).toMatchObject({ task: 'fix the thing, with a test', by: 'owner' });
    await r.engine.wait(r.tasks()[0]!.runId);
    await r.settle();
  });

  it('only approvers decide: a person who is not one is told so, and nothing is decided', async () => {
    const r = tgRig();
    await r.send(r.msg(TUSHAR, '@Bolt fix the thing'));
    const runId = await r.until(() => r.tasks()[0]?.runId);
    await r.engine.wait(runId);
    await r.settle();
    const ship = r.msgs().find((m) => m.card?.kind === 'approval')!;
    await r.send(r.msg(MAYA, 'looks good'));
    await r.send(r.press(MAYA, `a|${ship.id}`));
    expect(r.answers().at(-1)).toBe('Only approvers can decide this');
    expect(r.msgs().find((m) => m.id === ship.id)!.card).toMatchObject({ status: 'pending' });
    expect(r.store.state(runId)!.status).toBe('paused');
  });
});

describe('approvals both ways (Inbox parity)', () => {
  it('Approve in Telegram settles the run (and so the Inbox); a second press is told who decided', async () => {
    const r = tgRig();
    await r.send(r.msg(TUSHAR, '@Bolt fix the thing'));
    const runId = await r.until(() => r.tasks()[0]?.runId);
    await r.engine.wait(runId);
    await r.settle();
    const ship = r.msgs().find((m) => m.card?.kind === 'approval')!;
    await r.send(r.press(TUSHAR, `a|${ship.id}`));
    expect(r.answers().at(-1)).toBe('Approved');
    expect(r.store.state(runId)!.nodes.ship!.status).not.toBe('awaiting');
    const edit = r.f.of('editMessageText').filter((c) => c.params.message_id === r.tgIdOf(ship.id)).at(-1)!;
    expect(edit.params.text).toMatch(/✓ Approved by Tushar · \d\d:\d\d$/);
    expect(edit.params.reply_markup).toEqual({ inline_keyboard: [] });
    await r.send(r.press(TUSHAR, `a|${ship.id}`));
    expect(r.answers().at(-1)).toMatch(/^Already approved by Tushar/);
  });

  it('decided in Tether’s Inbox: the Telegram card is edited the same way', async () => {
    const r = tgRig();
    await r.send(r.msg(TUSHAR, '@Bolt fix the thing'));
    const runId = await r.until(() => r.tasks()[0]?.runId);
    await r.engine.wait(runId);
    await r.settle();
    const ship = r.msgs().find((m) => m.card?.kind === 'approval')!;
    r.engine.approve(runId, 'ship', false, 'dashboard');
    await r.settle();
    const edit = r.f.of('editMessageText').filter((c) => c.params.message_id === r.tgIdOf(ship.id)).at(-1)!;
    expect(edit.params.text).toMatch(/✕ Rejected by Tushar/);
  });

  it('Diff replies with the diff in a code block', async () => {
    const r = tgRig();
    await r.send(r.msg(TUSHAR, '@Bolt fix the thing'));
    const runId = await r.until(() => r.tasks()[0]?.runId);
    await r.engine.wait(runId);
    await r.settle();
    const ship = r.msgs().find((m) => m.card?.kind === 'approval')!;
    await r.send(r.press(MAYA, `f|${ship.id}`, 77));
    const diff = r.f.of('sendMessage').at(-1)!;
    expect(diff.params.text).toMatch(/^<pre>diff --git a\/fix\.txt/);
    expect(diff.params.reply_parameters).toMatchObject({ message_id: 77 });
  });
});

describe('the pinned status and /mute', () => {
  it('one pinned message, edited as work moves; a failed pin asks once to be made admin', async () => {
    const r = tgRig({ level: 'loose' });
    r.f.handlers.pinChatMessage = () => {
      throw new TelegramError('Telegram: Bad Request: not enough rights', 400);
    };
    await r.send(r.msg(TUSHAR, '@Bolt fix the thing'));
    const runId = await r.until(() => r.tasks()[0]?.runId);
    await r.engine.wait(runId);
    await r.settle();
    const pin = loadTg(r.home).teams[r.team.id]!.pin!;
    expect(r.f.of('sendMessage').filter((c) => c.params.disable_notification)).toHaveLength(1);
    expect(r.f.texts().filter((t) => /Make me an admin/.test(t))).toHaveLength(1);
    expect(r.f.of('editMessageText').filter((c) => c.params.message_id === pin).at(-1)!.params.text).toMatch(/^<b>Nothing running<\/b>/);
  });

  it('/mute holds back posts but not approvals; /mute off lets them through again', async () => {
    const r = tgRig();
    await r.send(r.msg(TUSHAR, '/mute 1h'));
    expect(r.f.texts().some((t) => /^Muted until \d\d:\d\d\. Approvals and proposals still come\.$/.test(t))).toBe(true);
    await r.send(r.msg(TUSHAR, '@Lens what does the README say?'));
    expect(r.f.texts()).not.toContain('<b>Lens</b>: It says fixture.');
    await r.send(r.msg(TUSHAR, '@Bolt fix the thing'));
    const runId = await r.until(() => r.tasks()[0]?.runId);
    await r.engine.wait(runId);
    await r.settle();
    expect(r.f.texts().some((t) => /On it\. Started/.test(t))).toBe(false);
    expect(r.f.texts().some((t) => /Ship “fix the thing”\?/.test(t))).toBe(true);
    await r.send(r.msg(TUSHAR, '/mute off'));
    await r.send(r.msg(TUSHAR, '@Lens and now?'));
    expect(r.f.texts()).toContain('<b>Lens</b>: It says fixture.');
    await r.send(r.msg(TUSHAR, '/mute forever'));
    expect(r.f.texts().at(-1)).toMatch(/Mute for how long/);
  });
});

describe('photos and voice notes', () => {
  it('a photo to an agent whose model reads images reaches it; otherwise the agent gets the text and the group is told', async () => {
    const yes = tgRig({ readsImages: true });
    let images: string[] | undefined;
    const run = yes.talk.run.bind(yes.talk);
    yes.talk.run = async (req) => ((images = req.images), run(req));
    await yes.send(yes.msg(TUSHAR, '', { text: undefined, caption: '@Lens why is this red?', photo: [{ file_id: 'small', file_size: 100 }, { file_id: 'big', file_size: 2000 }] }));
    expect(yes.f.of('getFile')[0]!.params).toEqual({ file_id: 'big' });
    expect(images).toHaveLength(1);
    expect(images![0]).toMatch(/tether-img-.*photo\.jpg$/);
    const no = tgRig({ readsImages: false });
    await no.send(no.msg(TUSHAR, '', { text: undefined, caption: '@Lens why is this red?', photo: [{ file_id: 'big' }] }));
    expect(no.f.of('getFile')).toHaveLength(0);
    expect(no.f.texts()).toContain("<b>Tether</b>: Lens's model can't read images, so it only gets your text.");
    expect(no.f.texts()).toContain('<b>Lens</b>: It says fixture.');
  });

  it('a voice note: the notice until the model is there; then transcribed here, echoed, and handled like typed text', async () => {
    const none = tgRig();
    await none.send(none.msg(TUSHAR, '', { text: undefined, voice: { file_id: 'v1', duration: 6 } }));
    expect(none.f.texts().at(-1)).toBe(NO_MODEL);
    const heard: Buffer[] = [];
    const voice: Voice = { unavailable: () => undefined, transcribe: async (ogg) => (heard.push(ogg), '@Lens what does the README say') };
    const r = tgRig({ voice });
    await r.send(r.msg(MAYA, '', { text: undefined, voice: { file_id: 'v2', duration: 6 } }));
    expect(heard[0]!.toString()).toBe('bytes of files/v2.oga');
    expect(r.f.texts()).toContain('Voice: <i>@Lens what does the README say</i>');
    expect(r.msgs()[0]).toMatchObject({ from: { name: 'Maya K.' }, text: '@Lens what does the README say' });
    expect(r.f.texts()).toContain('<b>Lens</b>: It says fixture.');
    await r.send(r.msg(MAYA, '', { text: undefined, voice: { file_id: 'v3', duration: 600 } }));
    expect(r.f.texts().at(-1)).toMatch(/up to 2 minutes/);
  });

  it('a reply to an agent’s message pings that agent', async () => {
    const r = tgRig();
    await r.send(r.msg(TUSHAR, '@Lens what does the README say?'));
    const answer = r.msgs().find((m) => m.from.kind === 'agent')!;
    await r.send(r.msg(TUSHAR, 'and the tests?', { reply_to_message: { message_id: r.tgIdOf(answer.id) } }));
    expect(r.msgs().filter((m) => m.from.name === 'Lens')).toHaveLength(2);
  });
});

describe('polling', () => {
  it('keeps the offset past each update, backs off on 429 and errors, and stops when the token is refused', async () => {
    const r = rig({ place: 'telegram' });
    r.teams.setLink(r.team.id, String(CHAT));
    editTg(r.home, (s) => void (s.owner = { id: TUSHAR.id, name: 'Tushar' }));
    const f = fakeApi();
    const script: (() => unknown)[] = [
      () => [{ update_id: 10, message: { message_id: 1, chat: { id: CHAT, type: 'group' }, from: TUSHAR, text: 'hello team' } }],
      () => {
        throw new TelegramError('Telegram: Too Many Requests', 429, 0);
      },
      () => {
        throw new TelegramError('Telegram: Bad Gateway', 502);
      },
      () => [{ update_id: 11, message: { message_id: 2, chat: { id: CHAT, type: 'group' }, from: TUSHAR, text: 'again' } }],
      () => {
        throw new TelegramError('Telegram: Unauthorized', 401);
      },
    ];
    f.handlers.getUpdates = () => script.shift()!();
    const tg = new Telegram({ home: r.home, teams: r.teams, store: r.store, secrets: memStore(), api: () => f.api, backoffMs: 5 });
    tg.start(f.api);
    await tg.polling;
    expect(f.of('getUpdates').map((c) => c.params.offset)).toEqual([0, 11, 11, 11, 12]);
    expect(loadTg(r.home).offset).toBe(12);
    expect(r.msgs().map((m) => m.text)).toEqual(['hello team', 'again']);
    expect(tg.view()).toMatchObject({ polling: false, error: expect.stringMatching(/no longer accepts this token/) });
    expect(r.team.people).toEqual([OWNER]);
  });
});
