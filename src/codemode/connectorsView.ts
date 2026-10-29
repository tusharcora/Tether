/**
 * Settings → Connectors: the Code Mode connectors as the map draws them. Public fields only: an MCP server's env and header
 * values, an account's token and a call's script text never leave (a call is shown as its first line, secrets redacted).
 */
import type { GithubAccount } from '../accounts/github.js';
import { allChats } from '../assistant/history.js';
import { redactText } from '../http/redact.js';
import { loadMcpServers, publicMcp, type McpServer } from './mcpServers.js';
import { mcpConnector } from './connectors/mcp.js';
import type { ConnectorView } from './connectorsTypes.js';

const BUILTIN: { name: string; summary: string; permissions: string[] }[] = [
  { name: 'repo', summary: "the project's files", permissions: ['Reads files in the project', 'Writes only on steps that may change files'] },
  { name: 'tether', summary: "Tether's runs, notes and hand-offs", permissions: ['Reads runs and notes', 'Hands work to another bot on steps that may'] },
  { name: 'github', summary: 'pull requests and issues', permissions: ['Reads pull requests and issues', 'Commenting and merging wait for your approval'] },
  { name: 'http', summary: 'your saved API requests', permissions: ['GET requests run freely', 'Anything that changes something waits for your approval'] },
];

const first = (s: string) => s.split('\n')[0]!.replace(/\s+/g, ' ').trim().slice(0, 120);

/** Which connector an approval's description is about. */
const askOwner = (what: string) => (/^(comment on|merge) /.test(what) ? 'github' : /^(GET|POST|PUT|PATCH|DELETE|HEAD) |^https?:/i.test(what) ? 'http' : undefined);

export async function connectorsView(home: string, github: GithubAccount, secrets: Map<string, string> = new Map()): Promise<ConnectorView[]> {
  // the assistant's saved chats are Code Mode's log: the scripts it ran and the outside calls it asked about
  const log = allChats(home);
  const scripts = log.flatMap((c) => c.messages.flatMap((m) => (m.tools ?? []).map((t) => ({ at: m.at, code: t.code, isError: t.isError }))));
  const asks = log.flatMap((c) => c.messages.flatMap((m) => (m.toolAsks ?? []).map((a) => ({ at: m.at, what: a.what, status: a.status }))));
  const recentFor = (name: string): ConnectorView['recent'] => [
    ...scripts.filter((s) => s.code.includes(`${name}.`)).map((s) => ({ at: s.at, what: redactText(first(s.code), secrets), kind: 'call' as const, ...(s.isError ? { state: 'failed' } : {}) })),
    ...asks.filter((a) => askOwner(a.what) === name).map((a) => ({ at: a.at, what: redactText(a.what, secrets).slice(0, 120), kind: 'approval' as const, state: a.status })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);
  const waiting = (name: string) => asks.some((a) => a.status === 'pending' && askOwner(a.what) === name);
  const signedIn = !!github.account() || !!(await github.cliLogin());
  const out: ConnectorView[] = BUILTIN.map((b) => {
    const off = b.name === 'github' && !signedIn;
    const needs = !off && waiting(b.name);
    return { ...b, status: off ? 'off' : needs ? 'needs' : 'connected', ...(off ? { note: 'Not signed in to GitHub. Connect it in Accounts.' } : needs ? { note: 'A call is waiting for your approval.' } : {}), recent: recentFor(b.name) };
  });
  for (const s of loadMcpServers(home)) {
    const pub = publicMcp(s);
    out.push({ name: `mcp.${s.name}`, summary: `${pub.kind === 'http' ? 'HTTP' : 'stdio'} MCP server: ${pub.target.slice(0, 80)}`, status: 'connected', permissions: ['Its tools run from run_code', 'A destructive tool waits for your approval'], recent: recentFor(`mcp.${s.name}`) });
  }
  return out;
}

/** Test: connect to an MCP server and list its tools; the built-ins are in this process, GitHub answers from the account. */
export async function testConnector(home: string, github: GithubAccount, name: string): Promise<{ ok: boolean; detail: string; tools?: string[] } | undefined> {
  if (name === 'github') return github.account() || (await github.cliLogin()) ? { ok: true, detail: 'Signed in to GitHub' } : { ok: false, detail: 'Not signed in to GitHub' };
  if (BUILTIN.some((b) => b.name === name)) return { ok: true, detail: 'Built in' };
  const server: McpServer | undefined = loadMcpServers(home).find((s) => `mcp.${s.name}` === name);
  if (!server) return undefined;
  const c = mcpConnector(server);
  try {
    const tools = (await c.methods()).map((x) => x.name);
    return { ok: true, detail: `${tools.length} tools`, tools };
  } catch (e) {
    return { ok: false, detail: redactText((e as Error).message.split('\n')[0]!, new Map()).slice(0, 160) };
  } finally {
    await c.close?.().catch(() => {});
  }
}
