/**
 * The run page's tools (spec 2026-10-30): rewind and its undo, fork, try more ways and Compare, the Terminal and the
 * Preview. Loopback only like every route (server.ts checks Host and Origin first); every input is checked here.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_MORE, type AgentPick, type Attempts } from './attempts.js';
import type { Engine } from './engine.js';
import { checkCommand, devCommand, type RunProcs } from './runProcs.js';
import { HttpError, readJson, reqObject, send } from './serverkit.js';
import type { Store } from './store.js';
import type { RunState } from './types.js';

export interface RunToolsDeps {
  store: Store;
  engine: Engine;
  attempts: Attempts;
  procs: RunProcs;
  /** The run as the page gets it (state and whether it is live). */
  runView: (id: string) => unknown;
  /** May the owner decide this run (a team's approver rule)? */
  mayApprove: (runId: string) => boolean;
}

const SET_RE = /^a[0-9a-z]{1,40}$/;
const decode = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, 'malformed id');
  }
};
/** An engine refusal as an HTTP error: an unknown run 404, an unknown step 400, anything else (live, not finished, moved on) 409. */
const refused = (e: unknown): HttpError => {
  if (e instanceof HttpError) return e;
  const msg = (e as Error).message;
  return new HttpError(/^unknown run/.test(msg) ? 404 : /^no step/.test(msg) ? 400 : 409, msg.split('\n')[0]!);
};
const engineCall = async <T>(f: () => Promise<T>): Promise<T> => {
  try {
    return await f();
  } catch (e) {
    throw refused(e);
  }
};
const nodeOf = (b: Record<string, unknown>): string => {
  if (typeof b.node !== 'string' || !b.node || b.node.length > 200 || /[\n\r]/.test(b.node)) throw new HttpError(400, '"node" must be a step id');
  return b.node;
};
function agentsOf(v: unknown): AgentPick[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length > MAX_MORE) throw new HttpError(400, `"agents" must be a list of at most ${MAX_MORE} { agent, model? }`);
  return v.map((x) => {
    const o = x as Record<string, unknown>;
    if (!o || typeof o !== 'object' || typeof o.agent !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(o.agent)) throw new HttpError(400, 'each of "agents" needs an "agent" id');
    if (o.model !== undefined && (typeof o.model !== 'string' || o.model.length > 200 || /[\s]/.test(o.model))) throw new HttpError(400, '"model" must be a model id');
    return { agent: o.agent, ...(o.model ? { model: o.model as string } : {}) };
  });
}

export async function runToolsRoute(d: RunToolsDeps, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const m = req.method ?? 'GET';
  let g: RegExpMatchArray | null;

  // ---- Compare ----
  if ((g = p.match(/^\/api\/attempts\/([^/]+)(\/pick)?$/))) {
    const set = decode(g[1]!);
    if (!SET_RE.test(set)) throw new HttpError(400, 'malformed attempt set id');
    if (!g[2] && m === 'GET') return send(res, 200, await d.attempts.view(set)), true;
    if (g[2] && m === 'POST') {
      const b = reqObject(await readJson(req));
      if (typeof b.run !== 'string' || !b.run) throw new HttpError(400, '"run" is required');
      if (b.merge !== undefined && typeof b.merge !== 'boolean') throw new HttpError(400, '"merge" must be true or false');
      if (!d.mayApprove(b.run)) throw new HttpError(403, 'Only the team’s chosen approvers can decide this run');
      await d.attempts.pick(set, b.run, b.merge === true);
      return send(res, 200, await d.attempts.view(set)), true;
    }
    return false;
  }

  g = p.match(/^\/api\/runs\/([^/]+)\/(rewind|rewind\/undo|fork|attempts|exec|exec\/stop|preview)$/);
  if (!g) return false;
  const id = decode(g[1]!);
  const what = g[2]!;
  const s: RunState | undefined = d.store.state(id);
  if (!s) throw new HttpError(404, `unknown run ${id}`);

  if (what === 'rewind' && m === 'POST') {
    const node = nodeOf(reqObject(await readJson(req)));
    await engineCall(() => d.engine.rewind(id, node));
    return send(res, 200, d.runView(id)), true;
  }
  if (what === 'rewind/undo' && m === 'POST') {
    await engineCall(() => d.engine.undoRewind(id));
    return send(res, 200, d.runView(id)), true;
  }
  if (what === 'fork' && m === 'POST') {
    const node = nodeOf(reqObject(await readJson(req)));
    const child = await engineCall(() => d.engine.fork(id, node));
    return send(res, 201, { id: child }), true;
  }
  if (what === 'attempts' && m === 'GET') {
    const count = Number(url.searchParams.get('count') ?? 2);
    if (!Number.isInteger(count) || count < 1 || count > MAX_MORE) throw new HttpError(400, `"count" must be a whole number from 1 to ${MAX_MORE}`);
    return send(res, 200, d.attempts.picks(id, count)), true;
  }
  if (what === 'attempts' && m === 'POST') {
    const b = reqObject(await readJson(req));
    const ids = await d.attempts.start(id, { count: b.count as number, agents: agentsOf(b.agents) });
    return send(res, 201, { ids, set: d.store.state(id)!.attemptSet }), true;
  }
  if (what === 'exec' && m === 'GET') return send(res, 200, { workdir: s.workdir, branch: s.branch, commands: d.procs.history(id) }), true;
  if (what === 'exec' && m === 'POST') {
    const command = checkCommand(reqObject(await readJson(req)).command);
    return send(res, 202, d.procs.exec(id, command)), true;
  }
  if (what === 'exec/stop' && m === 'POST') return send(res, 200, { stopped: d.procs.stopExec(id) }), true;
  if (what === 'preview' && m === 'GET') return send(res, 200, { preview: d.procs.preview(id) ?? null, command: devCommand(s.workdir) ?? null }), true;
  if (what === 'preview' && m === 'POST') {
    const b = reqObject(await readJson(req));
    const command = b.command === undefined || b.command === null || b.command === '' ? undefined : checkCommand(b.command);
    return send(res, 200, await d.procs.startPreview(id, command)), true;
  }
  if (what === 'preview' && m === 'DELETE') return send(res, 200, { stopped: d.procs.stopPreview(id) }), true;
  return false;
}
