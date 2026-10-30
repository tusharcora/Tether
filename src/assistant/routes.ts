/**
 * /api/assistant*: Tether's chats over the loopback server (Host and Origin are checked by server.ts first). Every route
 * that means one chat takes its id (`chat`), checked before any file is read. The one path that starts a run is
 * POST /api/assistant/proposals/:id with decision "start": a click on a card.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { projectRoot } from '../codeRoutes.js';
import { readPipeline } from '../config.js';
import { loadPrefs, savePrefs } from '../prefs.js';
import { HttpError, readJson, reqObject, send } from '../serverkit.js';
import { checkDraft, draftContext, draftPatch, firstTask } from './goalDraft.js';
import { artifactsDir, deleteArtifact, ensureIgnored, listArtifacts, readArtifact } from './artifacts.js';
import { compactChat, undoCompact } from './compact.js';
import { createPrompt, deletePrompt, listPrompts, promptsFile, updatePrompt } from './prompts.js';
import { latestContext } from './context.js';
import { deleteChat, isChatId, listChats, loadAllow, readChat, saveAllow, saveChat, TITLE_MAX, type Chat } from './history.js';
import { matches, summarize } from './summary.js';
import { assistantAgent, mid, runTurn, type AssistantCtx, type TurnBody } from './turn.js';
import { ATTACH_MAX_BYTES, ATTACH_MAX_FILES, MESSAGE_MAX, type ChatMessage, type ChatView, type Proposal, type StreamEvent } from './types.js';

const wsOf = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const rootOf = (c: AssistantCtx, ws: string | undefined) => (ws ? projectRoot(c.home, ws) : undefined);
/** The run store by id, for the summaries' live run states. */
const runsOf = (c: AssistantCtx) => new Map(c.store.listRows().map((r) => [r.summary.id, r]));

function parseBody(b: Record<string, unknown>): TurnBody {
  if (typeof b.message !== 'string' || !b.message.trim()) throw new HttpError(400, '"message" is required');
  if (b.message.length > MESSAGE_MAX) throw new HttpError(400, `"message" is too long (max ${MESSAGE_MAX})`);
  let attachments: TurnBody['attachments'];
  if (b.attachments !== undefined) {
    if (!Array.isArray(b.attachments) || b.attachments.length > ATTACH_MAX_FILES) throw new HttpError(400, `"attachments" is at most ${ATTACH_MAX_FILES} files`);
    attachments = b.attachments.map((a) => {
      const x = (a ?? {}) as Record<string, unknown>;
      if (typeof x.name !== 'string' || typeof x.text !== 'string') throw new HttpError(400, 'an attachment needs "name" and "text"');
      if (x.text.length > ATTACH_MAX_BYTES) throw new HttpError(400, `${x.name} is too big (max ${ATTACH_MAX_BYTES / 1000} KB of text)`);
      return { name: x.name, text: x.text };
    });
  }
  const ctx = b.context as Record<string, unknown> | undefined;
  const kinds = ['run', 'file', 'note', 'request', 'workflow', 'bot'];
  const sel = ctx?.selection as Record<string, unknown> | undefined;
  const context = ctx && typeof ctx.page === 'string' ? { page: ctx.page.slice(0, 20), ...(sel && typeof sel.kind === 'string' && kinds.includes(sel.kind) && typeof sel.id === 'string' ? { selection: { kind: sel.kind as never, id: sel.id.slice(0, 300), ...(Number.isInteger(sel.line) ? { line: sel.line as number } : {}) } } : {}) } : undefined;
  const ans = b.answer as Record<string, unknown> | undefined;
  return {
    message: b.message,
    ...(context ? { context } : {}),
    ...(typeof b.model === 'string' && b.model ? { model: b.model.slice(0, 120) } : {}),
    ...(typeof b.agent === 'string' && b.agent ? { agent: b.agent.slice(0, 40) } : {}),
    ...(typeof b.bot === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(b.bot) ? { bot: b.bot } : {}),
    ...(attachments?.length ? { attachments } : {}),
    ...(ans && typeof ans.message === 'string' && typeof ans.result === 'string' ? { answer: { message: ans.message, result: ans.result } } : {}),
  };
}

/** The chat a request names: 400 for a malformed id, 404 for one the project does not have. */
function chatIn(c: AssistantCtx, ws: string | undefined, v: unknown): Chat {
  if (!isChatId(v)) throw new HttpError(400, '"chat" must be a chat id');
  const chat = readChat(c.home, ws, v);
  if (!chat) throw new HttpError(404, 'unknown chat');
  return chat;
}

/**
 * A goal card's Start or "Just answer, no goal". Start applies the card's edits (checked strictly: 400 before anything
 * changes), then the goal's first Start (`Goals.begin`); dismiss deletes the goal the card made, if it never started.
 */
async function decideGoal(c: AssistantCtx, ws: string | undefined, chat: Chat, prop: Proposal, b: Record<string, unknown>): Promise<Proposal> {
  const ctx = ws ? draftContext(c.home, ws) : undefined;
  const edit = b.draft === undefined || b.decision !== 'start' ? undefined : ctx ? checkDraft(b.draft, ctx, true) : 'Open a project first.';
  if (typeof edit === 'string') throw new HttpError(400, edit);
  if (prop.status !== 'proposed') return prop;
  const goal = prop.goalId ? c.goals?.db.get(prop.goalId) : undefined;
  if (goal?.startedAt) prop.status = 'started'; // started on Goals meanwhile
  else if (b.decision === 'dismiss') {
    if (goal && goal.status === 'paused' && !goal.startedAt) c.goals!.db.remove(goal.id);
    prop.status = 'dismissed';
  } else if (!goal || !ctx) {
    prop.status = 'failed';
    prop.note = 'This goal is gone: it was deleted on Goals.';
  } else {
    try {
      if (edit) {
        prop.draft = edit;
        c.goals!.update(goal.id, draftPatch(edit, ctx));
      }
      c.goals!.begin(goal.id, firstTask(prop.task, prop.draft!));
      prop.status = 'started';
    } catch (e) {
      prop.status = 'failed';
      prop.note = (e as Error).message.split('\n')[0]!.slice(0, 200);
    }
  }
  saveChat(c.home, ws, chat);
  return prop;
}

/** Find a proposal, tool ask or message in the chat. */
const findProposal = (messages: ChatMessage[], id: string) => messages.flatMap((m) => m.proposals ?? []).find((p) => p.id === id);

export async function assistantRoute(c: AssistantCtx, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const m = req.method ?? 'GET';
  let g: RegExpMatchArray | null;

  if (p === '/api/assistant' && m === 'GET') {
    const ws = wsOf(url.searchParams.get('ws'));
    rootOf(c, ws);
    const id = url.searchParams.get('chat');
    const chat = id === null ? undefined : chatIn(c, ws, id);
    const { agent, model } = assistantAgent(c.home);
    const models = c.registry.has(agent) ? ((await c.registry.get(agent).listModels?.().catch(() => [])) ?? []) : [];
    return send(res, 200, { ...(chat ? { id: chat.id, title: chat.title } : {}), messages: chat?.messages ?? [], agent, ...(model ? { model } : {}), models, ...(agent !== 'openrouter' && c.registry.has('openrouter') ? { openrouter: true } : {}), ...(agent !== 'nvidia' && c.registry.has('nvidia') ? { nvidia: true } : {}), asksToGoals: loadPrefs(c.home).asksToGoals !== false } satisfies ChatView), true;
  }

  // the composer's "Turn asks into goals" switch (a preference, so every chat and the mini chat agree)
  if (p === '/api/assistant/settings' && m === 'PUT') {
    const b = reqObject(await readJson(req));
    if (typeof b.asksToGoals !== 'boolean') throw new HttpError(400, '"asksToGoals" must be true or false');
    savePrefs(c.home, { asksToGoals: b.asksToGoals });
    return send(res, 200, { asksToGoals: b.asksToGoals }), true;
  }

  if (p === '/api/assistant' && m === 'POST') {
    const b = reqObject(await readJson(req, 3_000_000));
    const ws = wsOf(b.ws);
    const root = rootOf(c, ws);
    const body = parseBody(b);
    const chat = b.chat === undefined ? undefined : chatIn(c, ws, b.chat);
    if (b.regenerate !== undefined) {
      const last = chat?.messages.at(-1);
      if (!chat || typeof b.regenerate !== 'string' || last?.id !== b.regenerate || last.role !== 'tether') throw new HttpError(409, 'only the latest reply can be regenerated');
      // drop the reply and the question it answered: the turn asks it again
      const q = chat.messages.findLastIndex((x) => x.role === 'you');
      chat.messages.splice(q >= 0 ? q : -1);
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const ctl = new AbortController();
    // the person pressed Stop (or left): stop the agent
    res.on('close', () => !res.writableEnded && ctl.abort());
    const emit = (e: StreamEvent) => void (!res.destroyed && res.write(`data: ${JSON.stringify(e)}\n\n`));
    try {
      await runTurn(c, { ws, root, chat, body }, emit, ctl.signal);
    } catch (e) {
      emit({ type: 'error', error: (e as Error).message.slice(0, 300) });
    }
    res.end();
    return true;
  }

  if (p === '/api/assistant/chats' && m === 'GET') {
    const ws = wsOf(url.searchParams.get('ws'));
    rootOf(c, ws);
    const q = (url.searchParams.get('q') ?? '').slice(0, 200);
    const rows = runsOf(c);
    return send(res, 200, { chats: listChats(c.home, ws).filter((x) => matches(x, q)).map((x) => summarize(x, rows, c.engine)) }), true;
  }

  if ((g = p.match(/^\/api\/assistant\/chats\/([^/]+)$/)) && (m === 'PATCH' || m === 'DELETE')) {
    const id = decodeURIComponent(g[1]!);
    if (m === 'DELETE') {
      const ws = wsOf(url.searchParams.get('ws'));
      rootOf(c, ws);
      if (!isChatId(id)) throw new HttpError(400, 'not a chat id');
      if (!deleteChat(c.home, ws, id)) throw new HttpError(404, 'unknown chat');
      return send(res, 200, { ok: true }), true;
    }
    const b = reqObject(await readJson(req));
    const ws = wsOf(b.ws);
    rootOf(c, ws);
    const chat = chatIn(c, ws, id);
    const title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim() : '';
    if (!title || title.length > TITLE_MAX) throw new HttpError(400, `"title" is 1 to ${TITLE_MAX} characters`);
    saveChat(c.home, ws, { ...chat, title });
    return send(res, 200, { chat: summarize({ ...chat, title }, runsOf(c), c.engine) }), true;
  }

  // Compact now (one model call, on the model that answered last) or Undo; the chat's messages come back
  if (p === '/api/assistant/compact' && m === 'POST') {
    const b = reqObject(await readJson(req));
    const ws = wsOf(b.ws);
    rootOf(c, ws);
    const chat = chatIn(c, ws, b.chat);
    if (b.undo === true) {
      if (!undoCompact(chat)) throw new HttpError(409, 'nothing to undo');
    } else {
      const last = latestContext(chat.messages)?.use;
      const who = last ? { agent: last.agent, model: last.model } : assistantAgent(c.home);
      const s = await compactChat(c, chat, { ...who, signal: AbortSignal.timeout(130_000) }).catch((e: Error) => {
        throw new HttpError(502, `Could not summarize: ${e.message.split('\n')[0]!.slice(0, 300)}`);
      });
      if (!s) throw new HttpError(409, 'nothing to compact yet');
    }
    saveChat(c.home, ws, chat);
    return send(res, 200, { messages: chat.messages }), true;
  }

  if (p === '/api/assistant/proposals' && m === 'POST') {
    const b = reqObject(await readJson(req));
    const ws = wsOf(b.ws);
    rootOf(c, ws);
    const chat = chatIn(c, ws, b.chat);
    const msg = chat.messages.find((x) => x.id === b.from && x.role === 'tether');
    if (!msg) throw new HttpError(404, 'unknown message');
    const task = msg.text.replace(/```tether[\s\S]*$/, '').trim().slice(0, 2000);
    const proposal: Proposal = { id: mid('p'), kind: 'team', task: task || 'Follow up on this answer', why: 'Turned from an answer', status: 'proposed' };
    msg.proposals = [...(msg.proposals ?? []), proposal];
    saveChat(c.home, ws, chat);
    return send(res, 200, { message: msg }), true;
  }

  if ((g = p.match(/^\/api\/assistant\/proposals\/([^/]+)$/)) && m === 'POST') {
    const b = reqObject(await readJson(req));
    const ws = wsOf(b.ws);
    const root = rootOf(c, ws);
    if (b.decision !== 'start' && b.decision !== 'dismiss') throw new HttpError(400, '"decision" must be "start" or "dismiss"');
    const chat = chatIn(c, ws, b.chat);
    const prop = findProposal(chat.messages, decodeURIComponent(g[1]!));
    if (!prop) throw new HttpError(404, 'unknown proposal');
    if (prop.kind === 'goal') return send(res, 200, { proposal: await decideGoal(c, ws, chat, prop, b) }), true;
    // a proposal is decided once: a second click returns what the first did
    if (prop.status === 'proposed') {
      if (b.decision === 'dismiss') prop.status = 'dismissed';
      else if (!root) {
        prop.status = 'failed';
        prop.note = 'Open a project first: a run needs a project folder.';
      } else {
        try {
          prop.runId =
            prop.kind === 'workflow'
              ? await c.engine.start({ pipeline: readPipeline(c.home, prop.workflow!), task: prop.task, repo: resolve(root) })
              : await c.engine.startTeam({ task: prop.task, repo: resolve(root), mode: prop.mode, background: true });
          prop.status = 'started';
        } catch (e) {
          prop.status = 'failed';
          prop.note = (e as Error).message.split('\n')[0]!.slice(0, 200);
        }
      }
      saveChat(c.home, ws, chat);
    }
    return send(res, 200, { proposal: prop }), true;
  }

  if ((g = p.match(/^\/api\/assistant\/tools\/([^/]+)$/)) && m === 'POST') {
    const b = reqObject(await readJson(req));
    const ws = wsOf(b.ws);
    rootOf(c, ws);
    if (b.decision !== 'once' && b.decision !== 'always' && b.decision !== 'deny') throw new HttpError(400, '"decision" must be "once", "always" or "deny"');
    const chat = chatIn(c, ws, b.chat);
    const ask = chat.messages.flatMap((x) => x.toolAsks ?? []).find((a) => a.id === decodeURIComponent(g![1]!));
    if (!ask) throw new HttpError(404, 'unknown approval');
    if (ask.status === 'pending') {
      ask.status = b.decision === 'deny' ? 'denied' : b.decision;
      if (b.decision === 'once') chat.once.push(ask.what);
      const always = loadAllow(c.home, ws);
      if (b.decision === 'always' && !always.includes(ask.what)) saveAllow(c.home, ws, [...always, ask.what]);
      saveChat(c.home, ws, chat);
    }
    return send(res, 200, { ask }), true;
  }

  if ((g = p.match(/^\/api\/assistant\/feedback\/([^/]+)$/)) && m === 'POST') {
    const b = reqObject(await readJson(req));
    const ws = wsOf(b.ws);
    rootOf(c, ws);
    if (b.value !== null && b.value !== 'up' && b.value !== 'down') throw new HttpError(400, '"value" must be "up", "down" or null');
    const reasons = b.reasons ?? [];
    if (!Array.isArray(reasons) || reasons.length > 6 || !reasons.every((r) => typeof r === 'string' && r.trim() && r.length <= 60)) throw new HttpError(400, '"reasons" is at most 6 strings of up to 60 characters');
    if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 1000)) throw new HttpError(400, '"note" is a string of up to 1000 characters');
    const note = typeof b.note === 'string' ? b.note.trim() : '';
    if ((reasons.length || note) && b.value !== 'down') throw new HttpError(400, 'reasons and a note go with "down"');
    const chat = chatIn(c, ws, b.chat);
    const msg = chat.messages.find((x) => x.id === decodeURIComponent(g![1]!));
    if (!msg) throw new HttpError(404, 'unknown message');
    if (b.value) msg.feedback = b.value;
    else delete msg.feedback;
    // a plain thumbs down keeps what was said before; anything else drops it
    if (reasons.length || note) msg.feedbackNote = { reasons: (reasons as string[]).map((r) => r.trim()), ...(note ? { note } : {}) };
    else if (b.value !== 'down') delete msg.feedbackNote;
    saveChat(c.home, ws, chat);
    return send(res, 200, { ok: true }), true;
  }

  // The project's artifacts (no project: Tether's own folder). An id is checked before any path is made from it.
  if (p === '/api/assistant/artifacts' && m === 'GET') {
    const dir = artifactsDir(c.home, rootOf(c, wsOf(url.searchParams.get('ws'))));
    return send(res, 200, { artifacts: listArtifacts(dir) }), true;
  }
  if ((g = p.match(/^\/api\/assistant\/artifacts\/([^/]+)$/)) && (m === 'GET' || m === 'DELETE')) {
    const dir = artifactsDir(c.home, rootOf(c, wsOf(url.searchParams.get('ws'))));
    const id = decodeURIComponent(g[1]!);
    if (m === 'DELETE') {
      if (!deleteArtifact(dir, id)) throw new HttpError(404, 'no such artifact');
      return send(res, 200, { ok: true }), true;
    }
    const v = url.searchParams.get('v');
    if (v !== null && !/^\d{1,4}$/.test(v)) throw new HttpError(400, '"v" must be a version number');
    return send(res, 200, readArtifact(dir, id, v === null ? undefined : Number(v))), true;
  }

  // The person's saved prompts (no project: Tether's own file)
  if (p === '/api/assistant/prompts' && (m === 'GET' || m === 'POST')) {
    if (m === 'GET') return send(res, 200, { prompts: listPrompts(promptsFile(c.home, rootOf(c, wsOf(url.searchParams.get('ws'))))) }), true;
    const b = reqObject(await readJson(req, 100_000));
    const root = rootOf(c, wsOf(b.ws));
    const file = promptsFile(c.home, root);
    if (root) ensureIgnored(root);
    return send(res, 200, { prompt: createPrompt(file, b) }), true;
  }
  if ((g = p.match(/^\/api\/assistant\/prompts\/([^/]+)$/)) && (m === 'PATCH' || m === 'DELETE')) {
    const id = decodeURIComponent(g[1]!);
    const b = m === 'PATCH' ? reqObject(await readJson(req, 100_000)) : {};
    const root = rootOf(c, wsOf(m === 'PATCH' ? b.ws : url.searchParams.get('ws')));
    const file = promptsFile(c.home, root);
    if (root) ensureIgnored(root);
    if (m === 'DELETE') {
      if (!deletePrompt(file, id)) throw new HttpError(404, 'no such prompt');
      return send(res, 200, { ok: true }), true;
    }
    return send(res, 200, { prompt: updatePrompt(file, id, b) }), true;
  }

  // Discard a stopped or failed reply
  if ((g = p.match(/^\/api\/assistant\/messages\/([^/]+)$/)) && m === 'DELETE') {
    const ws = wsOf(url.searchParams.get('ws'));
    rootOf(c, ws);
    const chat = chatIn(c, ws, url.searchParams.get('chat'));
    const i = chat.messages.findIndex((x) => x.id === decodeURIComponent(g![1]!) && x.role === 'tether' && !!x.error);
    if (i < 0) throw new HttpError(404, 'no stopped or failed reply with that id');
    chat.messages.splice(i, 1);
    saveChat(c.home, ws, chat);
    return send(res, 200, { ok: true }), true;
  }

  return false;
}
