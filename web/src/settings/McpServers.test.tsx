import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import type { Poll } from '../hooks';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { McpServers, parsePairs, serverBody, type McpServerView } from './McpServers';

const poll = (servers: McpServerView[]): Poll<{ servers: McpServerView[] }> => ({ data: { servers }, error: undefined, fails: 0, refresh: vi.fn(async () => {}) });

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('Settings → MCP servers', () => {
  it('lists servers with their target and key names only, adds one and removes one', async () => {
    let put: unknown;
    routeApi({ 'PUT /api/codemode/mcp/files': (b: unknown) => ((put = b), { server: {} }), 'DELETE /api/codemode/mcp/docs': { ok: true }, 'POST /api/codemode/connectors/mcp.docs/test': { ok: true, detail: '2 tools', tools: ['search', 'fetch'] } });
    const p = poll([{ name: 'docs', kind: 'http', target: 'https://mcp.example.com/mcp', envKeys: [], headerKeys: ['Authorization'] }]);
    renderApp(<McpServers poll={p} />);
    expect(screen.getAllByText('mcp.docs')).toHaveLength(2);
    expect(screen.getByText('Authorization set (values hidden)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'files' } });
    fireEvent.change(screen.getByLabelText('Command or URL'), { target: { value: 'npx -y server-fs .' } });
    fireEvent.change(screen.getByLabelText(/Env \(KEY=value\)/), { target: { value: 'ROOT=/tmp\n\nTOKEN=abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    await waitFor(() => expect(put).toEqual({ command: 'npx', args: ['-y', 'server-fs', '.'], env: { ROOT: '/tmp', TOKEN: 'abc' } }));
    expect(p.refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!);
    await waitFor(() => expect(calls('DELETE', '/api/codemode/mcp/docs')).toHaveLength(1));
  });

  it('shows each server as connecting until a real test answers: connected with its tools, or failed', async () => {
    let answer!: (v: unknown) => void;
    vi.mocked(api).mockImplementation(async (_m: string, path: string) => (path.includes('mcp.docs') ? new Promise((r) => (answer = r)) : Promise.reject(new Error('spawn failed'))) as never);
    renderApp(<McpServers poll={poll([{ name: 'docs', kind: 'http', target: 'https://x.dev/mcp', envKeys: [], headerKeys: [] }, { name: 'files', kind: 'stdio', target: 'npx fs', envKeys: [], headerKeys: [] }])} />);
    const panel = document.querySelector('[data-slot="mcp-server-panel"]')!;
    await waitFor(() => expect(panel.textContent).toContain('failed'));
    expect(panel.textContent).toContain('0 of 2 connected');
    expect(panel.textContent).toContain('connecting');
    answer({ ok: true, detail: '2 tools', tools: ['search', 'fetch'] });
    await waitFor(() => expect(panel.textContent).toContain('1 of 2 connected'));
    fireEvent.click(screen.getByRole('button', { name: /mcp\.docs/ }));
    expect(screen.getByText('fetch')).toBeTruthy();
    expect(panel.textContent).toContain('HTTP');
  });

  it('turns a URL into an HTTP server with headers, and a command line into command, args and env', () => {
    expect(serverBody('https://x.dev/mcp', 'Authorization: Bearer t')).toEqual({ url: 'https://x.dev/mcp', headers: { Authorization: 'Bearer t' } });
    expect(serverBody('node s.js', '')).toEqual({ command: 'node', args: ['s.js'] });
    expect(parsePairs('A=1\nnope\nB = two=2')).toEqual({ A: '1', B: 'two=2' });
  });
});
