/**
 * `mcp.<server>`: one configured MCP server (stdio or Streamable HTTP) as a connector. It starts on first use (a search,
 * a describe or a call), its tools become methods taking one object (their JSON Schema becomes TypeScript), and it closes
 * with the session. A tool annotated `destructiveHint: true` needs approval.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServer } from '../mcpServers.js';
import type { Connector, JsonSchema, Method } from '../types.js';

const CONNECT_MS = 8000;

/** An MCP tool name as a JS identifier (`create-issue` → `create_issue`). */
export const toolIdent = (name: string): string => {
  const s = name.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[0-9]/.test(s) ? `_${s}` : s || '_';
};

/** A tool's answer as a value: structured content, else its text (parsed when it is JSON). An error result throws. */
function resultOf(r: { content?: unknown; structuredContent?: unknown; isError?: unknown }): unknown {
  const text = (Array.isArray(r.content) ? r.content : [])
    .map((c: { type?: string; text?: string }) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : c?.type ? `[${c.type}]` : ''))
    .filter(Boolean)
    .join('\n');
  if (r.isError) throw new Error(text.slice(0, 2000) || 'the tool reported an error');
  if (r.structuredContent !== undefined) return r.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function mcpConnector(server: McpServer, version = '0.1.0'): Connector {
  let client: Client | undefined;
  let connecting: Promise<Client> | undefined;
  const connect = () =>
    (connecting ??= (async () => {
      const c = new Client({ name: 'tether-codemode', version });
      const transport =
        'url' in server
          ? new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers ?? {} } })
          : new StdioClientTransport({ command: server.command, args: server.args ?? [], env: { ...getDefaultEnvironment(), ...(server.env ?? {}) }, ...(server.cwd ? { cwd: server.cwd } : {}), stderr: 'ignore' });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([c.connect(transport), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`MCP server "${server.name}" did not start within ${CONNECT_MS / 1000} s`)), CONNECT_MS)))]);
      } finally {
        clearTimeout(timer);
      }
      client = c;
      return c;
    })());
  return {
    name: `mcp.${server.name}`,
    summary: `the "${server.name}" MCP server's tools (find them with codemode.search or describe)`,
    async methods(): Promise<Method[]> {
      const c = await connect();
      const { tools } = await c.listTools();
      return tools.map((t) => {
        const destructive = t.annotations?.destructiveHint === true && t.annotations?.readOnlyHint !== true;
        return {
          name: toolIdent(t.name),
          summary: (t.description ?? t.title ?? t.name).split('\n')[0]!.slice(0, 200),
          ...(t.description && t.description.includes('\n') ? { doc: t.description.slice(0, 2000) } : {}),
          params: [{ name: 'input', schema: (t.inputSchema ?? { type: 'object' }) as JsonSchema, optional: !(t.inputSchema as { required?: unknown[] } | undefined)?.required?.length }],
          ...(t.outputSchema ? { returns: 'unknown' } : {}),
          ...(destructive ? { outside: ([input]: unknown[]) => `run the "${t.name}" tool of ${server.name} with ${JSON.stringify(input ?? {}).slice(0, 120)}` } : {}),
          run: async ([input]: unknown[]) => resultOf((await c.callTool({ name: t.name, arguments: (input ?? {}) as Record<string, unknown> })) as { content?: unknown; structuredContent?: unknown; isError?: unknown }),
        } satisfies Method;
      });
    },
    async close() {
      await client?.close().catch(() => undefined);
      client = undefined;
      connecting = undefined;
    },
  };
}
