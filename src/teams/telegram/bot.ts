/**
 * Teams in a Telegram group (spec 2026-10-30): one shared bot, long polling on this Mac while Tether runs, no public URL.
 *
 * In: every update is checked before anything happens. Only a linked group acts; an unlinked group may only `/pair <code>`
 * and a private chat only `/iam <code>`. Telegram bots, anonymous admins and channels are never people. A person's text
 * becomes `Teams.post` (the same team logic, permission checks and limits as a Tether team), a button press `Teams.decide`
 * with that person, so the approver rule and "Can start runs" are the team's, whatever the surface. Ignored updates are
 * logged by id only.
 *
 * Out: every new agent or Tether message of a linked team is sent, labelled with its speaker; a changed one is edited in
 * place, at most once per `editGapMs` per message (the latest state wins). One pinned live-status message per team.
 * `/mute` holds back everything but approvals and proposals.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleepMs } from 'node:timers/promises';
import { AccountError } from '../../accounts/github.js';
import { defaultStore, type SecretStore } from '../../accounts/secretStore.js';
import { accountOf, setAccount, type PublicAccount } from '../../accounts/store.js';
import type { Goals } from '../../goals/loop.js';
import { HttpError } from '../../serverkit.js';
import type { Store } from '../../store.js';
import { mentionsOf } from '../rules.js';
import { OWNER, readState } from '../store.js';
import type { Teams } from '../teams.js';
import type { Person, Team, TeamMessage } from '../types.js';
import { botApi, TelegramError, type BotApi } from './api.js';
import { esc, isAsk, parseAction, renderMessage, renderStatus } from './render.js';
import { editTg, loadTg, newCode, remember, takeCode, tgTeam } from './store.js';

/** Voice notes, as the bridge needs them (src/stt, faked in tests). */
export interface Voice {
  /** Why voice notes cannot be transcribed now (the model is not downloaded, no decoder…), or undefined. */
  unavailable(): string | undefined;
  /** An Ogg/Opus voice note to text, on this Mac. */
  transcribe(ogg: Buffer): Promise<string>;
}

export interface TelegramDeps {
  home: string;
  teams: Teams;
  store: Store;
  goals?: Goals;
  /** Where the token lives (the Keychain on a Mac; tests: in memory). */
  secrets?: SecretStore;
  /** The Bot API for a token (tests: a fake). */
  api?: (token: string) => BotApi;
  voice?: Voice;
  /** Does this agent's model read images? */
  readsImages?: (bot: string) => Promise<boolean>;
  /** The shortest gap between two edits of one message, and between two status updates (Telegram's rate). */
  editGapMs?: number;
  /** The first wait after a failed poll; it doubles up to a minute. */
  backoffMs?: number;
}

const TOKEN_RE = /^\d{4,20}:[A-Za-z0-9_-]{20,80}$/;
const POLL_S = 25;
const MAX_BACKOFF_MS = 60_000;
const VOICE_MAX_S = 120;
const VOICE_MAX_BYTES = 5_000_000;
const PHOTO_MAX_BYTES = 10_000_000;
const DIFF_MAX = 3500;
const MUTE_MAX_MS = 24 * 3_600_000;
export const COMMANDS = [
  { command: 'status', description: 'What is running, what needs you, today’s spend' },
  { command: 'runs', description: 'The last 5 runs' },
  { command: 'new', description: 'Start a run: /new <task>' },
  { command: 'mute', description: 'Hold back posts for a while: /mute 1h (approvals still come)' },
];
export const NO_MODEL = 'Voice notes need the speech model — download it in Tether settings';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown): v is number => Number.isSafeInteger(v);
interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}
const userOf = (v: unknown): TgUser | undefined => (isObj(v) && int(v.id) ? (v as unknown as TgUser) : undefined);
const nameOf = (u: TgUser) => [u.first_name, u.last_name].filter((x) => typeof x === 'string' && x).join(' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 60) || (typeof u.username === 'string' ? u.username : '') || 'Someone';
const usernameOf = (u: TgUser) => (typeof u.username === 'string' && /^\w{3,32}$/.test(u.username) ? u.username : undefined);

export interface TelegramView {
  connected: boolean;
  bot?: { username: string; readsAll: boolean };
  polling: boolean;
  error?: string;
  owner?: { name: string };
}

export class Telegram {
  private api?: BotApi;
  private poller?: AbortController;
  private state: { polling: boolean; error?: string } = { polling: false };
  private queues = new Map<string, Promise<unknown>>();
  private jobs = new Set<Promise<unknown>>();
  private timers = new Set<NodeJS.Timeout>();
  /** `${team}:${msg}` -> when its last send or edit started, and a scheduled sync. */
  private edits = new Map<string, { last: number; timer?: NodeJS.Timeout }>();
  /** What each Telegram message shows now, so an unchanged render is not sent again. */
  private shown = new Map<string, string>();
  private statusTimers = new Map<string, NodeJS.Timeout>();
  /** Force-reply prompts of the Edit button: Telegram message id -> the proposal. shortcut: in memory, lost on restart (the card's Start still works); persist if people miss it. */
  private prompts = new Map<number, { team: string; msg: string }>();
  private pinNoted = new Set<string>();

  constructor(private d: TelegramDeps) {
    d.teams.onMessage((tid, m) => this.mirror(tid, m));
    d.goals?.onChange((g) => g.team && this.statusSoon(g.team));
  }

  private get secrets(): SecretStore {
    return this.d.secrets ?? defaultStore(this.d.home);
  }
  private makeApi(token: string): BotApi {
    return (this.d.api ?? ((t) => botApi(t)))(token);
  }
  private get gap(): number {
    return this.d.editGapMs ?? 3000;
  }

  // ---------- the account ----------

  account(): PublicAccount | undefined {
    return accountOf(this.d.home, 'telegram');
  }
  view(): TelegramView {
    const s = loadTg(this.d.home);
    return { connected: !!this.account(), ...(s.bot ? { bot: { username: s.bot.username, readsAll: s.bot.readsAll } } : {}), ...this.state, ...(s.owner ? { owner: { name: s.owner.name } } : {}) };
  }

  /** A pasted @BotFather token: checked with getMe, kept in the secret store, then polled. */
  async connect(input: string): Promise<PublicAccount> {
    const token = input.trim();
    if (!TOKEN_RE.test(token)) throw new AccountError('That is not a bot token: @BotFather gives one like 123456789:AA…');
    const api = this.makeApi(token);
    let me: { id?: unknown; username?: unknown; first_name?: unknown; can_read_all_group_messages?: unknown };
    try {
      me = await api.call('getMe');
    } catch (e) {
      const t = e as TelegramError;
      throw t.status === 401 || t.status === 404 ? new AccountError('Telegram did not accept this token') : new AccountError("can't reach Telegram", 'upstream');
    }
    if (!int(me.id) || typeof me.username !== 'string') throw new AccountError('Telegram answered getMe without a bot', 'upstream');
    this.stop();
    await this.secrets.set('telegram', token);
    const prev = loadTg(this.d.home).bot;
    editTg(this.d.home, (s) => {
      // another bot starts from its own first update
      if (prev?.id !== me.id) s.offset = 0;
      s.bot = { id: me.id as number, username: me.username as string, readsAll: me.can_read_all_group_messages === true };
    });
    setAccount(this.d.home, 'telegram', { provider: 'telegram', login: me.username, ...(typeof me.first_name === 'string' ? { name: me.first_name } : {}), scopes: [], via: 'key', connectedAt: Date.now() });
    await api.call('setMyCommands', { commands: COMMANDS }).catch(() => {});
    this.start(api);
    return this.account()!;
  }

  /** Stop polling and forget the token (linked teams keep their link for a later reconnect). */
  async disconnect(): Promise<void> {
    this.stop();
    await this.secrets.delete('telegram');
    setAccount(this.d.home, 'telegram', undefined);
    editTg(this.d.home, (s) => void delete s.bot);
    this.state = { polling: false };
  }

  /** On server start: poll again when an account is connected (the secret store is only read then). */
  async resume(): Promise<void> {
    if (!this.account()) return;
    const token = await this.secrets.get('telegram').catch(() => undefined);
    if (token) this.start(this.makeApi(token));
    else this.state = { polling: false, error: 'The Telegram token is missing from the Keychain. Connect again.' };
  }

  start(api: BotApi): void {
    this.stop();
    this.api = api;
    const c = new AbortController();
    this.poller = c;
    // not a tracked job: it runs until stop()
    this.polling = this.loop(api, c.signal).catch((e: unknown) => console.error(`[telegram] poll: ${(e as Error).message}`));
  }
  /** The poll loop's end (tests). */
  polling: Promise<void> = Promise.resolve();
  stop(): void {
    this.poller?.abort();
    this.poller = undefined;
    this.api = undefined;
    for (const t of [...this.timers, ...this.statusTimers.values()]) clearTimeout(t);
    this.timers.clear();
    this.statusTimers.clear();
    for (const e of this.edits.values()) e.timer = undefined;
  }

  /** Resolves when nothing is scheduled or in flight (tests). */
  async idle(): Promise<void> {
    for (let i = 0; i < 50 && (this.jobs.size || this.timers.size || this.statusTimers.size); i++) {
      await Promise.allSettled([...this.jobs]);
      if (!this.jobs.size && (this.timers.size || this.statusTimers.size)) await sleepMs(Math.max(5, this.gap / 2));
    }
  }
  private track(p: Promise<unknown>): void {
    const j: Promise<unknown> = p.catch((e: unknown) => console.error(`[telegram] ${(e as Error).message}`)).finally(() => this.jobs.delete(j));
    this.jobs.add(j);
  }
  private later(ms: number, fn: () => void): NodeJS.Timeout {
    const t = setTimeout(() => (this.timers.delete(t), fn()), ms);
    t.unref?.();
    this.timers.add(t);
    return t;
  }
  /** One team's Telegram calls, in order (a send lands before its edits). */
  private enqueue(teamId: string, fn: () => Promise<unknown>): void {
    const next = (this.queues.get(teamId) ?? Promise.resolve()).then(fn).catch((e: unknown) => console.error(`[telegram] ${(e as Error).message}`));
    this.queues.set(teamId, next);
    this.track(next);
  }

  // ---------- polling ----------

  private async loop(api: BotApi, signal: AbortSignal): Promise<void> {
    const base = this.d.backoffMs ?? 1000;
    let backoff = base;
    while (!signal.aborted) {
      try {
        const updates = await api.call<unknown[]>('getUpdates', { offset: loadTg(this.d.home).offset, timeout: POLL_S, allowed_updates: ['message', 'callback_query'] }, { signal, timeoutMs: (POLL_S + 15) * 1000 });
        this.state = { polling: true };
        backoff = base;
        for (const u of Array.isArray(updates) ? updates : []) {
          if (signal.aborted) break;
          if (!isObj(u) || !int(u.update_id)) continue;
          // stored before it is handled: an update that fails is never replayed
          editTg(this.d.home, (s) => void (s.offset = Math.max(s.offset, (u.update_id as number) + 1)));
          await this.handle(u);
        }
      } catch (e) {
        if (signal.aborted) break;
        const t = e as TelegramError;
        if (t.status === 401 || t.status === 404) {
          this.state = { polling: false, error: 'Telegram no longer accepts this token. Connect again.' };
          break;
        }
        this.state = { polling: false, error: t.status === 409 ? 'Another program is reading this bot’s updates (a second Tether, or a webhook).' : t.message };
        await sleepMs(Math.max(backoff, (t.retryAfter ?? 0) * 1000), undefined, { signal }).catch(() => {});
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  // ---------- in ----------

  private linked(chat: number): Team | undefined {
    return this.d.teams.all().find((t) => t.place === 'telegram' && t.link === String(chat));
  }
  private say(chat: number, text: string, extra: Obj = {}): Promise<{ message_id: number } | undefined> {
    if (!this.api) return Promise.resolve(undefined);
    return this.api.call<{ message_id: number }>('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
  }
  private ignore(u: Obj, why: string): void {
    console.error(`[telegram] ignored update ${String(u.update_id)}: ${why}`);
  }

  /** The person behind a Telegram user in a team: the owner once `/iam` linked them, else a teammate (added as they speak). */
  private person(team: Team, u: TgUser): Person {
    const owner = loadTg(this.d.home).owner;
    if (owner?.id === u.id) return { ...OWNER, name: owner.name };
    const username = usernameOf(u);
    return this.d.teams.addPerson(team.id, { id: `tg${u.id}`, name: nameOf(u), via: 'telegram', tgUserId: u.id, ...(username ? { username } : {}) });
  }

  /** `/name@thisbot args` or `/name args`; a command for another bot is not ours. */
  private command(text: string): { name: string; args: string } | undefined {
    const m = /^\/([a-z]{2,32})(?:@(\w+))?(?:\s+([\s\S]*))?$/i.exec(text.trim());
    if (!m) return undefined;
    const bot = loadTg(this.d.home).bot?.username;
    if (m[2] && m[2].toLowerCase() !== bot?.toLowerCase()) return undefined;
    return { name: m[1]!.toLowerCase(), args: (m[3] ?? '').trim() };
  }

  /** One update. Never throws: a bad update is logged by id and dropped. */
  async handle(u: Obj): Promise<void> {
    try {
      if (isObj(u.callback_query)) return await this.onButton(u.callback_query);
      const m = u.message;
      if (!isObj(m) || !isObj(m.chat) || !int(m.chat.id) || !int(m.message_id)) return this.ignore(u, 'not a message');
      const chat = m.chat.id as number;
      const team = this.linked(chat);
      // a group upgraded to a supergroup gets a new id: the link follows
      if (team && int(m.migrate_to_chat_id)) return void this.d.teams.setLink(team.id, String(m.migrate_to_chat_id));
      const from = userOf(m.from);
      if (!from || from.is_bot) return this.ignore(u, 'not from a person');
      const text = typeof m.text === 'string' ? m.text : typeof m.caption === 'string' ? m.caption : '';
      const cmd = this.command(text);
      if (m.chat.type === 'private') return cmd?.name === 'iam' ? await this.iam(chat, from, cmd.args) : this.ignore(u, 'private chat');
      if (m.chat.type !== 'group' && m.chat.type !== 'supergroup') return this.ignore(u, 'not a group');
      if (!team) return cmd?.name === 'pair' ? await this.pair(chat, from, cmd.args) : this.ignore(u, 'chat not linked');
      if (Array.isArray(m.new_chat_members)) {
        for (const x of m.new_chat_members.map(userOf)) if (x && !x.is_bot) this.person(team, x);
        return;
      }
      const person = this.person(team, from);
      if (cmd) return await this.onCommand(team, person, cmd, chat);
      const reply = isObj(m.reply_to_message) && int(m.reply_to_message.message_id) ? (m.reply_to_message.message_id as number) : undefined;
      // the reply to an Edit prompt is the proposal's new task
      const prompt = reply === undefined ? undefined : this.prompts.get(reply);
      if (prompt && prompt.team === team.id && text) {
        this.prompts.delete(reply!);
        return await this.decide(team, person, prompt.msg, 'start', chat, undefined, text);
      }
      const to = this.repliedAgent(team, reply);
      if (isObj(m.voice)) return this.track(this.voiceNote(team, person, m, to));
      if (Array.isArray(m.photo)) return this.track(this.photo(team, person, m, text, to));
      if (text) this.d.teams.post(team.id, { text, from: person, ...(to ? { to } : {}) });
    } catch (e) {
      console.error(`[telegram] update ${String(u.update_id)}: ${(e as Error).message.split('\n')[0]}`);
    }
  }

  /** The agent whose message this replies to (a reply pings it, like an @mention). */
  private repliedAgent(team: Team, tgId: number | undefined): string | undefined {
    if (tgId === undefined) return undefined;
    const msgs = loadTg(this.d.home).teams[team.id]?.msgs ?? {};
    const id = Object.keys(msgs).find((k) => msgs[k] === tgId);
    const m = id ? readState(this.d.home, team.id).messages.find((x) => x.id === id) : undefined;
    return m?.from.kind === 'agent' ? m.from.id : undefined;
  }

  private async pair(chat: number, from: TgUser, code: string): Promise<void> {
    const what = editTg(this.d.home, (s) => takeCode(s, code));
    const team = what && what !== 'iam' ? this.d.teams.all().find((t) => t.id === what && t.place === 'telegram') : undefined;
    if (!team) return void (await this.say(chat, 'That pairing code is not valid any more. Make a new one in Tether: New team → Telegram group.'));
    if (team.link) return void (await this.say(chat, `The Tether team “${esc(team.name)}” is already linked to another group.`));
    this.d.teams.setLink(team.id, String(chat));
    this.person({ ...team, link: String(chat) }, from);
    const names = this.d.teams.who(team).map((w) => `@${w.name}`);
    await this.say(chat, `Linked to the Tether team “<b>${esc(team.name)}</b>”. Mention an agent (${esc(names.join(', '))}) to ask a question, hand over a task or start a loop. /status shows what is running.`);
    this.statusSoon(team.id, 0);
  }

  private async iam(chat: number, from: TgUser, code: string): Promise<void> {
    const ok = editTg(this.d.home, (s) => {
      if (takeCode(s, code) !== 'iam') return false;
      s.owner = { id: from.id, name: nameOf(from) };
      return true;
    });
    if (!ok) return void (await this.say(chat, 'That code is not valid any more. Get a new one in Tether: Settings → Accounts → Telegram.'));
    // the owner is the owner everywhere now, not a teammate with switches
    for (const t of this.d.teams.all()) if (t.people.some((p) => p.id === `tg${from.id}`)) this.d.teams.removePerson(t.id, `tg${from.id}`);
    await this.say(chat, 'You are linked as the owner of this Tether: you can approve and start runs in every Telegram team.');
  }

  private async onCommand(team: Team, person: Person, cmd: { name: string; args: string }, chat: number): Promise<void> {
    if (cmd.name === 'status') return void (await this.say(chat, renderStatus(this.d.teams.view(team.id), { mute: loadTg(this.d.home).teams[team.id]?.mute })));
    if (cmd.name === 'runs') return void (await this.say(chat, this.runs(team)));
    if (cmd.name === 'pair') return void (await this.say(chat, `This group is already linked to “${esc(team.name)}”.`));
    if (cmd.name === 'mute') return this.mute(team, cmd.args, chat);
    if (cmd.name === 'new') {
      if (!cmd.args) return void (await this.say(chat, 'Say what to do: /new fix the Back button after a new chat'));
      const agents = this.d.teams.who(team);
      const to = mentionsOf(cmd.args, agents)[0] ?? agents[0]?.id;
      if (!to) return void (await this.say(chat, 'This team has no agents left in the crew.'));
      this.d.teams.post(team.id, { text: cmd.args, from: person, to, force: 'task' });
    }
  }

  private runs(team: Team): string {
    const tasks = readState(this.d.home, team.id).tasks.slice(-5).reverse();
    if (!tasks.length) return 'No runs yet. Mention an agent with a task to start one.';
    return tasks
      .map((k) => {
        const s = this.d.store.state(k.runId);
        const pr = k.pr ? ` · <a href="${esc(k.pr.url)}">PR #${k.pr.number}</a>` : '';
        return `<b>R-${k.runId.slice(-4).toUpperCase()}</b> · ${esc(k.task.split('\n')[0]!.slice(0, 60))} · ${s?.status ?? 'gone'} · $${(s?.costUsd ?? 0).toFixed(2)}${pr}`;
      })
      .join('\n');
  }

  private async mute(team: Team, args: string, chat: number): Promise<void> {
    const a = args.toLowerCase();
    const m = /^(\d{1,4})\s*(m|min|h|hr|hours?)?$/.exec(a);
    const ms = a === 'off' ? 0 : m ? Math.min(Number(m[1]) * (m[2]?.startsWith('m') ? 60_000 : 3_600_000), MUTE_MAX_MS) : a ? -1 : 3_600_000;
    if (ms < 0) return void (await this.say(chat, 'Mute for how long? /mute 1h, /mute 30m, or /mute off'));
    const until = ms ? Date.now() + ms : undefined;
    editTg(this.d.home, (s) => {
      const t = tgTeam(s, team.id);
      if (until) t.mute = until;
      else delete t.mute;
    });
    await this.say(chat, until ? `Muted until ${new Date(until).toTimeString().slice(0, 5)}. Approvals and proposals still come.` : 'Unmuted.');
    this.statusSoon(team.id, 0);
  }

  private async onButton(q: Obj): Promise<void> {
    const from = userOf(q.from);
    const m = q.message;
    if (typeof q.id !== 'string' || !from || !isObj(m) || !isObj(m.chat) || !int(m.chat.id)) return;
    const answer = async (text?: string) => void (await this.api?.call('answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text, show_alert: false } : {}) }).catch(() => {}));
    const team = this.linked(m.chat.id as number);
    const act = parseAction(q.data);
    if (!team || from.is_bot || !act) return void (await answer());
    return this.decide(team, this.person(team, from), act.msg, act.action, m.chat.id as number, answer, undefined, int(m.message_id) ? (m.message_id as number) : undefined);
  }

  /** A button (or the reply to an Edit prompt): the team decides, with the person who pressed it. */
  private async decide(team: Team, person: Person, msg: string, action: string, chat: number, answer?: (t?: string) => Promise<unknown>, task?: string, at?: number): Promise<void> {
    try {
      if (action === 'diff') {
        const diff = await this.d.teams.diff(team.id, msg);
        await this.say(chat, diff ? `<pre>${esc(diff.length > DIFF_MAX ? `${diff.slice(0, DIFF_MAX)}\n… (the full diff is in Tether)` : diff)}</pre>` : 'No changes.', at ? { reply_parameters: { message_id: at, allow_sending_without_reply: true } } : {});
        return void (await answer?.());
      }
      if (action === 'edit') {
        const sent = await this.say(chat, `${esc(person.name)}, reply to this message with the task as it should run.`, { reply_markup: { force_reply: true, selective: false, input_field_placeholder: 'The task' } });
        if (sent) this.prompts.set(sent.message_id, { team: team.id, msg });
        return void (await answer?.());
      }
      await this.d.teams.decide(team.id, msg, { action, by: person, ...(task ? { task } : {}) });
      await answer?.(action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : action === 'start' ? 'Started' : 'Dismissed');
    } catch (e) {
      const h = e as HttpError;
      const why = h.status === 403 && (action === 'approve' || action === 'reject') ? 'Only approvers can decide this' : h.message.charAt(0).toUpperCase() + h.message.slice(1);
      if (answer) await answer(why.slice(0, 190));
      else await this.say(chat, esc(why));
    }
  }

  private async photo(team: Team, person: Person, m: Obj, caption: string, to: string | undefined): Promise<void> {
    const agents = this.d.teams.who(team);
    const target = mentionsOf(caption, agents)[0] ?? to;
    const text = caption || 'What do you see in this image?';
    // a photo to nobody is just a photo in the group
    if (!target) return void (caption && this.d.teams.post(team.id, { text: caption, from: person }));
    if (!(await (this.d.readsImages?.(target) ?? Promise.resolve(false)))) {
      await this.say((m.chat as Obj).id as number, `<b>Tether</b>: ${esc(agents.find((a) => a.id === target)?.name ?? 'This agent')}'s model can't read images, so it only gets your text.`);
      return void this.d.teams.post(team.id, { text, from: person, ...(to ? { to } : {}) });
    }
    const sizes = (m.photo as unknown[]).filter((p): p is Obj => isObj(p) && typeof p.file_id === 'string' && (!int(p.file_size) || (p.file_size as number) <= PHOTO_MAX_BYTES));
    const best = sizes.at(-1);
    if (!best || !this.api) return;
    const f = await this.api.call<{ file_path?: string }>('getFile', { file_id: best.file_id });
    if (!f.file_path) return;
    const bytes = await this.api.download(f.file_path, PHOTO_MAX_BYTES);
    const dir = mkdtempSync(join(tmpdir(), 'tether-img-'));
    const file = join(dir, `photo.${/\.png$/i.test(f.file_path) ? 'png' : 'jpg'}`);
    writeFileSync(file, bytes, { mode: 0o600 });
    this.d.teams.post(team.id, { text, from: person, images: [file], ...(to ? { to } : {}) });
  }

  private async voiceNote(team: Team, person: Person, m: Obj, to: string | undefined): Promise<void> {
    const chat = (m.chat as Obj).id as number;
    const v = m.voice as Obj;
    const reply = (text: string) => this.say(chat, text, { reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } });
    const why = this.d.voice ? this.d.voice.unavailable() : NO_MODEL;
    if (why) return void (await reply(esc(why)));
    if (typeof v.file_id !== 'string' || !this.api) return;
    if (int(v.duration) && (v.duration as number) > VOICE_MAX_S) return void (await reply('Voice notes up to 2 minutes, please.'));
    const f = await this.api.call<{ file_path?: string }>('getFile', { file_id: v.file_id });
    if (!f.file_path) return;
    let text: string;
    try {
      text = (await this.d.voice!.transcribe(await this.api.download(f.file_path, VOICE_MAX_BYTES))).trim();
    } catch (e) {
      return void (await reply(`I could not transcribe that voice note: ${esc((e as Error).message.split('\n')[0]!.slice(0, 200))}`));
    }
    if (!text) return void (await reply('I could not make out any words in that voice note.'));
    await reply(`Voice: <i>${esc(text)}</i>`);
    this.d.teams.post(team.id, { text, from: person, ...(to ? { to } : {}) });
  }

  // ---------- out ----------

  /** A team message was made or changed: send or edit its Telegram copy (people's own messages came from the group). */
  private mirror(teamId: string, m: TeamMessage): void {
    if (!this.api || m.from.kind === 'person') return;
    const team = this.d.teams.all().find((t) => t.id === teamId);
    if (team?.place !== 'telegram' || !team.link) return;
    this.statusSoon(teamId);
    const key = `${teamId}:${m.id}`;
    const e = this.edits.get(key) ?? { last: 0 };
    this.edits.set(key, e);
    if (e.timer) return; // already scheduled: it reads the latest state when it runs
    e.timer = this.later(Math.max(0, e.last + this.gap - Date.now()), () => {
      e.timer = undefined;
      e.last = Date.now();
      this.enqueue(teamId, () => this.sync(teamId, m.id, key));
    });
  }

  private async sync(teamId: string, msgId: string, key: string): Promise<void> {
    const team = this.d.teams.all().find((t) => t.id === teamId);
    const m = readState(this.d.home, teamId).messages.find((x) => x.id === msgId);
    if (!team?.link || !m || !this.api) return;
    const chat = Number(team.link);
    const tg = loadTg(this.d.home);
    const t = tg.teams[teamId];
    const tgId = t?.msgs[msgId];
    if (tgId === undefined) {
      // an answer being written shows as "typing…"; it is posted once written
      if (m.pending) return void (await this.api.call('sendChatAction', { chat_id: chat, action: 'typing' }).catch(() => {}));
      if (t?.mute && t.mute > Date.now() && !isAsk(m)) return;
    }
    const r = renderMessage(m, tg.owner?.name);
    const shown = JSON.stringify(r);
    if (tgId !== undefined && this.shown.get(key) === shown) return;
    if (tgId === undefined) {
      const sent = await this.say(chat, r.text, r.reply_markup ? { reply_markup: r.reply_markup } : {});
      if (sent) editTg(this.d.home, (s) => remember(tgTeam(s, teamId), msgId, sent.message_id));
    } else {
      try {
        await this.api.call('editMessageText', { chat_id: chat, message_id: tgId, text: r.text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: r.reply_markup ?? { inline_keyboard: [] } });
      } catch (e) {
        const msg = (e as Error).message;
        if (/not modified/i.test(msg)) return void this.shown.set(key, shown);
        if (/not found|can't be edited/i.test(msg)) editTg(this.d.home, (s) => void delete tgTeam(s, teamId).msgs[msgId]);
        throw e;
      }
    }
    this.shown.set(key, shown);
  }

  /** The pinned live status, edited at most once per gap. */
  private statusSoon(teamId: string, wait = this.gap): void {
    if (!this.api || this.statusTimers.has(teamId)) return;
    const t = setTimeout(() => {
      this.statusTimers.delete(teamId);
      this.enqueue(teamId, () => this.pinStatus(teamId));
    }, wait);
    t.unref?.();
    this.statusTimers.set(teamId, t);
  }

  private async pinStatus(teamId: string): Promise<void> {
    const team = this.d.teams.all().find((t) => t.id === teamId);
    if (!team?.link || team.place !== 'telegram' || !this.api) return;
    const chat = Number(team.link);
    const t = loadTg(this.d.home).teams[teamId];
    const text = renderStatus(this.d.teams.view(teamId), { mute: t?.mute });
    const key = `${teamId}:status`;
    if (t?.pin !== undefined) {
      if (this.shown.get(key) === text) return;
      try {
        await this.api.call('editMessageText', { chat_id: chat, message_id: t.pin, text, parse_mode: 'HTML' });
        return void this.shown.set(key, text);
      } catch (e) {
        if (/not modified/i.test((e as Error).message)) return void this.shown.set(key, text);
        if (!/not found|can't be edited/i.test((e as Error).message)) throw e;
      }
    }
    // no pinned message yet, or it was deleted: post one and pin it (edited, never re-pinned, from then on)
    const sent = await this.say(chat, text, { disable_notification: true });
    if (!sent) return;
    editTg(this.d.home, (s) => void (tgTeam(s, teamId).pin = sent.message_id));
    this.shown.set(key, text);
    await this.api.call('pinChatMessage', { chat_id: chat, message_id: sent.message_id, disable_notification: true }).catch(async () => {
      if (this.pinNoted.has(teamId)) return;
      this.pinNoted.add(teamId);
      await this.say(chat, 'Make me an admin of this group so I can pin the live status (and read every message, not only commands).');
    });
  }

  // ---------- codes ----------

  /** A one-time `/pair` code for a Telegram team that is not linked yet. */
  pairCode(teamId: string): { code: string; exp: number; bot?: string } {
    const team = this.d.teams.must(teamId);
    if (team.place !== 'telegram') throw new HttpError(400, 'only a Telegram team pairs with a group');
    if (team.link) throw new HttpError(409, 'this team is already linked to a group');
    if (!this.account()) throw new HttpError(409, 'connect a Telegram bot first: Settings → Accounts → Telegram');
    const c = editTg(this.d.home, (s) => newCode(s, teamId));
    const bot = loadTg(this.d.home).bot?.username;
    return { ...c, ...(bot ? { bot } : {}) };
  }
  /** A one-time `/iam` code: whoever sends it to the bot in a private chat becomes the owner on Telegram. */
  iamCode(): { code: string; exp: number; bot?: string } {
    if (!this.account()) throw new HttpError(409, 'connect a Telegram bot first');
    const c = editTg(this.d.home, (s) => newCode(s, 'iam'));
    const bot = loadTg(this.d.home).bot?.username;
    return { ...c, ...(bot ? { bot } : {}) };
  }
}
