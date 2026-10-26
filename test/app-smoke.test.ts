import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
  }, 90_000);
});
