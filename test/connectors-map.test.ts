import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GithubAccount } from '../src/accounts/github.js';
import { connectorsView, testConnector } from '../src/codemode/connectorsView.js';
import { putMcpServer } from '../src/codemode/mcpServers.js';
import { tmp } from './helpers.js';

const gh = (signedIn: boolean) => ({ account: () => (signedIn ? { login: 'sam' } : undefined), cliLogin: async () => undefined }) as unknown as GithubAccount;

describe('the connectors map data', () => {
  it('lists the built-ins and each MCP server with a status, recent calls and approvals, and no secrets', async () => {
    const home = tmp('home-');
    putMcpServer(home, { name: 'files', command: 'node', args: ['srv.js'], env: { API_KEY: 'sk-live-verysecret' } });
    mkdirSync(join(home, 'assistant'));
    writeFileSync(
      join(home, 'assistant', '_.json'),
      JSON.stringify({ messages: [{ id: 'm1', role: 'tether', text: '', at: 5, tools: [{ id: 't1', code: 'return await github.listPulls("a/b") // sk-live-verysecret' }], toolAsks: [{ id: 'a1', what: 'comment on a/b#3: "hi"', status: 'pending' }] }], always: [], once: [] }),
    );
    const list = await connectorsView(home, gh(true), new Map([['key', 'sk-live-verysecret']]));
    expect(list.map((c) => [c.name, c.status])).toEqual([['repo', 'connected'], ['tether', 'connected'], ['github', 'needs'], ['http', 'connected'], ['mcp.files', 'connected']]);
    const github = list.find((c) => c.name === 'github')!;
    expect(github.recent.map((r) => r.kind).sort()).toEqual(['approval', 'call']);
    expect(JSON.stringify(list)).not.toContain('sk-live-verysecret');
    expect((await connectorsView(home, gh(false))).find((c) => c.name === 'github')?.status).toBe('off');
  });

  it('tests a built-in and refuses an unknown name', async () => {
    const home = tmp('home-');
    expect(await testConnector(home, gh(true), 'repo')).toEqual({ ok: true, detail: 'Built in' });
    expect(await testConnector(home, gh(false), 'github')).toMatchObject({ ok: false });
    expect(await testConnector(home, gh(true), 'mcp.nope')).toBeUndefined();
  });
});
