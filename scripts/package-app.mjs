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
// Finder and iCloud Drive attach attributes (com.apple.FinderInfo) that a signature may not cover
execFileSync('xattr', ['-cr', app]);
execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
console.log(`\nTether.app (Electron ${electronVersion}, arm64, ad-hoc signed):\n  ${app}\n`);
