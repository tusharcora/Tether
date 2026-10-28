/**
 * Tether's Code Mode MCP server (stdio), started per step by the agent CLI from its per-run MCP config as
 * `tether codemode-mcp --session <file>` (the command comes from launch.ts). It offers exactly one tool, run_code, and
 * forwards each script to the step's session in the Tether process.
 */
import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { SessionFile } from './host.js';
import { RUN_CODE_SCHEMA } from './prompt.js';

export const RUN_CODE = 'run_code';

/**
 * The one tool, as tools/list shows it. On a read-only step it is read-only too (repo.write is refused there and calls
 * that change the outside world need approval), which lets Claude Code's plan mode run it.
 */
export const runCodeTool = (description: string, readOnly = false) => ({ name: RUN_CODE, description, inputSchema: RUN_CODE_SCHEMA, annotations: { title: 'Run code in Tether (Code Mode)', readOnlyHint: readOnly, openWorldHint: false } });

export async function serveCodeModeMcp(sessionFile: string): Promise<void> {
  const s = JSON.parse(readFileSync(sessionFile, 'utf8')) as SessionFile;
  const server = new Server({ name: 'tether', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [runCodeTool(s.description, s.readOnly === true)] }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== RUN_CODE) return { content: [{ type: 'text', text: `unknown tool "${req.params.name}": the only tool is ${RUN_CODE}` }], isError: true };
    const code = (req.params.arguments as { code?: unknown } | undefined)?.code;
    try {
      const res = await fetch(`${s.url}/run`, { method: 'POST', headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
      const out = (await res.json()) as { text?: string; isError?: boolean; error?: string };
      if (!res.ok) return { content: [{ type: 'text', text: `Tether refused the script: ${out.error ?? `HTTP ${res.status}`}` }], isError: true };
      return { content: [{ type: 'text', text: out.text ?? '' }], isError: !!out.isError };
    } catch (e) {
      return { content: [{ type: 'text', text: `Tether is not reachable: ${(e as Error).message}` }], isError: true };
    }
  });
  await server.connect(new StdioServerTransport());
}
