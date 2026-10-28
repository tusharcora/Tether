/** /api/codemode/*: Settings → Tools' MCP servers (Host and Origin are checked by server.ts first). Values of env and headers never leave. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, reqObject, send } from '../serverkit.js';
import type { GithubAccount } from '../accounts/github.js';
import { loadSecrets } from '../http/secrets.js';
import { connectorsView, testConnector } from './connectorsView.js';

/** The default scope's secret values, so a recorded call that quoted one is redacted. */
const defaultSecrets = (home: string): Map<string, string> => {
  try {
    return new Map(Object.entries(loadSecrets(home, 'default')));
  } catch {
    return new Map();
  }
};
import { loadMcpServers, MCP_NAME_RE, publicMcp, putMcpServer, removeMcpServer } from './mcpServers.js';

export async function codemodeRoute(home: string, req: IncomingMessage, res: ServerResponse, url: URL, github?: GithubAccount): Promise<boolean> {
  const p = url.pathname;
  const m = req.method ?? 'GET';
  if (p === '/api/codemode/mcp' && m === 'GET') return send(res, 200, { servers: loadMcpServers(home).map(publicMcp) }), true;
  if (github && p === '/api/codemode/connectors' && m === 'GET') return send(res, 200, { connectors: await connectorsView(home, github, defaultSecrets(home)) }), true;
  const t = github ? /^\/api\/codemode\/connectors\/([^/]+)\/test$/.exec(p) : null;
  if (t && m === 'POST') {
    const r = await testConnector(home, github!, decodeURIComponent(t[1]!));
    if (!r) throw new HttpError(404, 'no such connector');
    return send(res, 200, r), true;
  }
  const g = /^\/api\/codemode\/mcp\/([^/]+)$/.exec(p);
  if (!g) return false;
  const name = decodeURIComponent(g[1]!);
  if (!MCP_NAME_RE.test(name)) throw new HttpError(400, 'the name must be lowercase letters, digits or _ (starting with a letter, at most 32)');
  if (m === 'PUT') {
    try {
      return send(res, 200, { server: publicMcp(putMcpServer(home, { ...reqObject(await readJson(req)), name })) }), true;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, (e as Error).message);
    }
  }
  if (m === 'DELETE') {
    if (!removeMcpServer(home, name)) throw new HttpError(404, `no MCP server "${name}"`);
    return send(res, 200, { ok: true }), true;
  }
  return false;
}
