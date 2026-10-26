/** /api/code/*: the Code screen over the existing loopback server (Host and Origin are checked by server.ts first). */
import { realpathSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gitInfo, listDir, readCode, resolveInWorkspace, saveCode } from './code.js';
import { changedByRuns, runsForFile, writingRun } from './codeRuns.js';
import { searchNames, searchText } from './codeSearch.js';
import type { Engine } from './engine.js';
import { HttpError, readJson, reqObject, send } from './serverkit.js';
import type { Store } from './store.js';
import { aorchHomeMessage, getWorkspace, isAorchHome } from './workspace.js';

export interface CodeRouteCtx {
  home: string;
  store: Store;
  engine: Engine;
}

/** The real folder of the workspace named by `id` (a registry id, never a path). */
export function projectRoot(home: string, id: unknown): string {
  if (typeof id !== 'string' || !id) throw new HttpError(400, '"ws" (a workspace id) is required');
  const w = getWorkspace(home, id);
  if (!w) throw new HttpError(404, `unknown workspace "${id}"`);
  if (!w.exists) throw new HttpError(404, `the folder of "${id}" is gone (${w.path})`);
  if (isAorchHome(w.path, home)) throw new HttpError(400, aorchHomeMessage(w.path, home));
  return realpathSync(w.path);
}

/** A saved file can be 2 MB of text, which JSON escaping can more than double. */
const MAX_SAVE_BODY = 6_000_000;
const MAX_QUERY = 200;

export async function codeRoute(c: CodeRouteCtx, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const m = req.method ?? 'GET';
  const q = (k: string) => url.searchParams.get(k) ?? '';
  const root = () => projectRoot(c.home, url.searchParams.get('ws'));

  if (p === '/api/code/tree' && m === 'GET') return send(res, 200, await listDir(root(), q('dir'))), true;
  if (p === '/api/code/file' && m === 'GET') {
    const r = root();
    const lock = writingRun(c.store, c.engine, r);
    return send(res, 200, { ...readCode(r, q('path')), ...(lock ? { lock } : {}) }), true;
  }
  if (p === '/api/code/file' && m === 'PUT') {
    const b = reqObject(await readJson(req, MAX_SAVE_BODY));
    const r = projectRoot(c.home, b.ws);
    if (typeof b.path !== 'string' || typeof b.text !== 'string') throw new HttpError(400, '"path" and "text" are required');
    if (b.baseMtimeMs !== undefined && typeof b.baseMtimeMs !== 'number') throw new HttpError(400, '"baseMtimeMs" must be a number');
    const lock = writingRun(c.store, c.engine, r);
    if (lock) throw new HttpError(423, 'run-writing', { ...lock });
    return send(res, 200, { path: b.path, ...saveCode(r, b.path, b.text, b.baseMtimeMs as number | undefined) }), true;
  }
  if (p === '/api/code/runs-for-file' && m === 'GET') {
    const r = root();
    const rel = resolveInWorkspace(r, q('path')).rel;
    return send(res, 200, (await gitInfo(r)).git ? await runsForFile(c.store, c.engine, r, rel) : []), true;
  }
  if (p === '/api/code/changed' && m === 'GET') {
    const r = root();
    return send(res, 200, { paths: (await gitInfo(r)).git ? await changedByRuns(c.store, r) : [] }), true;
  }
  if (p === '/api/code/search' && m === 'GET') {
    const mode = q('mode') || 'text';
    if (mode !== 'name' && mode !== 'text') throw new HttpError(400, '"mode" must be "name" or "text"');
    const text = q('q').trim();
    if (text.length > MAX_QUERY) throw new HttpError(400, `"q" is too long (max ${MAX_QUERY})`);
    const r = root();
    if (!text) return send(res, 200, mode === 'name' ? { hits: [] } : { hits: [], truncated: false }), true;
    return send(res, 200, mode === 'name' ? await searchNames(r, text) : await searchText(r, text)), true;
  }
  return false;
}
