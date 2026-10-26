/** /api/code/*: the Code screen over the existing loopback server (Host and Origin are checked by server.ts first). */
import { realpathSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { listDir, readCode } from './code.js';
import type { Engine } from './engine.js';
import { HttpError, send } from './serverkit.js';
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

export async function codeRoute(c: CodeRouteCtx, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const m = req.method ?? 'GET';
  const q = (k: string) => url.searchParams.get(k) ?? '';
  const root = () => projectRoot(c.home, url.searchParams.get('ws'));

  if (p === '/api/code/tree' && m === 'GET') return send(res, 200, await listDir(root(), q('dir'))), true;
  if (p === '/api/code/file' && m === 'GET') return send(res, 200, readCode(root(), q('path'))), true;
  return false;
}
