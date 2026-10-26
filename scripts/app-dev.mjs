// npm run app:dev: Tether.app's window on the Vite dev server (hot reload), for UI work. Vite and the app's server each take
// a free loopback port and Vite proxies /api to the app's server, so neither a running `tether serve` (4177) nor another
// dev server on 5173 is ever used. Run after `npm run build:server`.
import electron from 'electron';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

const [apiPort, vitePort] = [await freePort(), await freePort()];
const page = `http://127.0.0.1:${vitePort}`;
const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'web', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: root, stdio: 'inherit', env: { ...process.env, TETHER_API: `http://127.0.0.1:${apiPort}` } });
for (let i = 0; i < 100; i++) {
  if (await fetch(page).then(() => true, () => false)) break;
  await new Promise((r) => setTimeout(r, 200));
}
const env = { ...process.env, TETHER_PORT: String(apiPort), TETHER_DEV_URL: page };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(electron, ['dist/app/main.js'], { cwd: root, stdio: 'inherit', env });
const stop = (code) => (vite.kill(), process.exit(code ?? 0));
app.on('exit', stop);
process.on('SIGINT', () => (app.kill(), stop(0)));
