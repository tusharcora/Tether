import { execFile, execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { tmp } from './helpers.js';

const root = fileURLToPath(new URL('..', import.meta.url));
// the binary itself: the npm wrapper would leave Electron running if the test had to kill it
const electron = join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

/** Boot Tether.app's main process in smoke mode with a temp home; resolves its TETHER_SMOKE report. */
function boot(home: string): Promise<Record<string, unknown>> {
  const env: NodeJS.ProcessEnv = { ...process.env, TETHER_HOME: home, TETHER_SMOKE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    execFile(electron, ['dist/app/main.js'], { cwd: root, env, timeout: 60_000, killSignal: 'SIGKILL' }, (err, stdout) => {
      const line = String(stdout).split('\n').find((l) => l.startsWith('TETHER_SMOKE '));
      if (line) resolve(JSON.parse(line.slice('TETHER_SMOKE '.length)));
      else reject(err ?? new Error(`no smoke report:\n${stdout}`));
    });
  });
}

describe.skipIf(process.platform !== 'darwin' || !existsSync(electron))('Tether.app boot (Electron)', () => {
  beforeAll(() => void execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'ignore' }), 120_000);

  it('starts the server in-process on a free loopback port, loads the window with the bridge, and /api/runs answers', async () => {
    const home = tmp('home-');
    const r = await boot(home);
    expect(r).toMatchObject({ loaded: true, runs: 200, bridge: 'darwin', rendered: true, title: 'Tether' });
    expect(r.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(r.url).not.toBe('http://127.0.0.1:4177');
    // the store opened inside Electron's own Node (node:sqlite) in the given home, never ~/.aorch
    expect(existsSync(join(home, 'runs.db'))).toBe(true);

    // Code Mode's MCP server starts from the app itself (tether is not on PATH there): the app binary as Node on its cli.js
    const mcp = r.mcp as { command: string; args: string[]; env?: Record<string, string> };
    expect(mcp.command).toBe(electron);
    expect(mcp.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(mcp.args).toEqual([join(root, 'dist/cli.js'), 'codemode-mcp', '--session', '<session>']);
    const session = join(home, 'session.json');
    writeFileSync(session, JSON.stringify({ url: 'http://127.0.0.1:9', token: 't', description: 'run code', readOnly: true }), { mode: 0o600 });
    const client = new Client({ name: 'boot-test', version: '1.0.0' });
    const env = { ...(process.env as Record<string, string>), ...mcp.env };
    await client.connect(new StdioClientTransport({ command: mcp.command, args: mcp.args.map((a) => (a === '<session>' ? session : a)), env, cwd: root, stderr: 'ignore' }));
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['run_code']);
    } finally {
      await client.close();
    }
  }, 90_000);
});
