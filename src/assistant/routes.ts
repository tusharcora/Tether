/**
 * /api/assistant*: Tether's chat over the loopback server (Host and Origin are checked by server.ts first).
 * The one path that starts a run is POST /api/assistant/proposals/:id with decision "start": a click on a card.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { projectRoot } from '../codeRoutes.js';
import { readPipeline } from '../config.js';
import { HttpError, readJson, reqObject, send } from '../serverkit.js';
import { loadChat, newChat, saveChat } from './history.js';
import { assistantAgent, mid, runTurn, type AssistantCtx, type TurnBody } from './turn.js';
import { ATTACH_MAX_BYTES, ATTACH_MAX_FILES, MESSAGE_MAX, type ChatMessage, type ChatView, type Proposal, type StreamEvent } from './types.js';

const wsOf = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const rootOf = (c: AssistantCtx, ws: string | undefined) => (ws ? projectRoot(c.home, ws) : undefined);

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
    ...(attachments?.length ? { attachments } : {}),
    ...(ans && typeof ans.message === 'string' && typeof ans.result === 'string' ? { answer: { message: ans.message, result: ans.result } } : {}),
  };
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
    const { agent, model } = assistantAgent(c.home);
    const models = c.registry.has(agent) ? ((await c.registry.get(agent).listModels?.().catch(() => [])) ?? []) : [];
    return send(res, 200, { messages: loadChat(c.home, ws).messages, agent, ...(model ? { model } : {}), models } satisfies ChatView), true;
  }

  if (p === '/api/assistant' && m === 'POST') {
    const b = reqObject(await readJson(req, 3_000_000));
    const ws = wsOf(b.ws);
    const root = rootOf(c, ws);
    const body = parseBody(b);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const ctl = new AbortController();
    // the person pressed Stop (or left): stop the agent
    res.on('close', () => !res.writableEnded && ctl.abort());
    const emit = (e: StreamEvent) => void (!res.destroyed && res.write(`data: ${JSON.stringify(e)}\n\n`));
    try {
      await runTurn(c, { ws, root, body }, emit, ctl.signal);
    } catch (e) {
      emit({ type: 'error', error: (e as Error).message.slice(0, 300) });
    }
    res.end();
    return true;
  }

  if (p === '/api/assistant/new' && m === 'POST') {
    const b = reqObject(await readJson(req));
    const ws = wsOf(b.ws);
    rootOf(c, ws);
    return send(res, 200, { messages: newChat(c.home, ws).messages }), true;
  }

  if (p === '/api/assistant/proposals' && m === 'POST') {
    const b = reqObject(await readJson(req));
    const ws = wsOf(b.ws);
    rootOf(c, ws);
    const chat = loadChat(c.home, ws);
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
    const chat = loadChat(c.home, ws);
    const prop = findProposal(chat.messages, decodeURIComponent(g[1]!));
    if (!prop) throw new HttpError(404, 'unknown proposal');
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
    const chat = loadChat(c.home, ws);
    const ask = chat.messages.flatMap((x) => x.toolAsks ?? []).find((a) => a.id === decodeURIComponent(g![1]!));
    if (!ask) throw new HttpError(404, 'unknown approval');
    if (ask.status === 'pending') {
      ask.status = b.decision === 'deny' ? 'denied' : b.decision;
      if (b.decision === 'once') chat.once.push(ask.what);
      if (b.decision === 'always' && !chat.always.includes(ask.what)) chat.always.push(ask.what);
      saveChat(c.home, ws, chat);
    }
    return send(res, 200, { ask }), true;
  }

  if ((g = p.match(/^\/api\/assistant\/feedback\/([^/]+)$/)) && m === 'POST') {
    const b = reqObject(await readJson(req));
    const ws = wsOf(b.ws);
    rootOf(c, ws);
    if (b.value !== null && b.value !== 'up' && b.value !== 'down') throw new HttpError(400, '"value" must be "up", "down" or null');
    const chat = loadChat(c.home, ws);
    const msg = chat.messages.find((x) => x.id === decodeURIComponent(g![1]!));
    if (!msg) throw new HttpError(404, 'unknown message');
    if (b.value) msg.feedback = b.value;
    else delete msg.feedback;
    saveChat(c.home, ws, chat);
    return send(res, 200, { ok: true }), true;
  }

  return false;
}
