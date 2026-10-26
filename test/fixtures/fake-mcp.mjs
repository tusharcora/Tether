// A tiny stdio MCP server for tests: `echo` (read-only), `add-numbers`, and `delete-note` (annotated destructive).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'fake', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'echo', description: 'Echo a message back', inputSchema: { type: 'object', properties: { message: { type: 'string', description: 'What to say' } }, required: ['message'] }, annotations: { readOnlyHint: true } },
    { name: 'add-numbers', description: 'Add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
    { name: 'delete-note', description: 'Delete a note forever', inputSchema: { type: 'object', properties: { id: { type: 'string' } } }, annotations: { destructiveHint: true } },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a = req.params.arguments ?? {};
  if (req.params.name === 'echo') return { content: [{ type: 'text', text: `echo: ${a.message}` }] };
  if (req.params.name === 'add-numbers') return { content: [{ type: 'text', text: JSON.stringify({ sum: a.a + a.b }) }] };
  if (req.params.name === 'delete-note') return { content: [{ type: 'text', text: `deleted ${a.id}` }] };
  return { content: [{ type: 'text', text: 'no such tool' }], isError: true };
});
await server.connect(new StdioServerTransport());
