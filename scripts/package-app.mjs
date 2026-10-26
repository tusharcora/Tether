// npm run app: package the built server and dashboard as dist-app/Tether-darwin-arm64/Tether.app (Apple Silicon), then sign
// it ad hoc for this Mac (no Developer ID: macOS may ask the first time, right-click → Open). Run after `npm run build`.
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8')).version;
for (const built of ['dist/app/main.js', 'dist/app/preload.cjs', 'web/dist/index.html'])
  if (!existsSync(join(root, built))) throw new Error(`${built} is missing: run npm run build first`);

/** What the app carries: the manifest, the built server, the built dashboard, the example pipelines and the production dependencies. */
const keep = (p) => p === '' || p === '/package.json' || p === '/web' || /^\/(dist|examples|node_modules)(\/|$)/.test(p) || /^\/web\/dist(\/|$)/.test(p);

const [out] = await packager({
  dir: root,
  out: join(root, 'dist-app'),
  overwrite: true,
  platform: 'darwin',
  arch: 'arm64',
  electronVersion,
  name: 'Tether',
  appVersion: pkg.version,
  appBundleId: 'dev.tether.app',
  appCategoryType: 'public.app-category.developer-tools',
  icon: join(root, 'assets/brand/tether.icns'),
  ignore: (p) => !keep(p),
  prune: true,
  asar: false,
  extendInfo: {
    // folders can be dropped on the Dock icon and opened with `open -a Tether <dir>`
    CFBundleDocumentTypes: [{ CFBundleTypeName: 'Folder', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.folder'] }],
  },
});

const app = join(out, 'Tether.app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (args) => {
  try {
    execFileSync('codesign', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
// Finder, LaunchServices and iCloud Drive attach attributes (com.apple.FinderInfo) to a new bundle for a moment after it
// appears; they sit outside the signature but a strict check refuses them, so let the bundle settle, then clear and check.
await sleep(2000);
execFileSync('xattr', ['-cr', app]);
execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
let strict = false;
for (let i = 0; i < 5 && !strict; i++) {
  execFileSync('xattr', ['-cr', app]);
  strict = ok(['--verify', '--deep', '--strict', app]);
  if (!strict) await sleep(1000);
}
if (!strict && !ok(['--verify', '--deep', app])) throw new Error(`the signature of ${app} does not verify`);
console.log(`\nTether.app (Electron ${electronVersion}, arm64, ad-hoc signed${strict ? '' : '; macOS keeps re-adding Finder info in this iCloud folder, so only the non-strict check ran'}):\n  ${app}\n`);
