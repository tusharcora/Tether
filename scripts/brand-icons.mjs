#!/usr/bin/env node
// Builds Tether's brand assets from one definition of the mark: the Gapped Triad, Graphite, plain tile.
//   node scripts/brand-icons.mjs        → writes the SVG sources into assets/brand/
//   node scripts/brand-icons.mjs --png  → also renders the PNG ladder + tether.icns (needs rsvg-convert, iconutil)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'brand');
const TILE = '#0e0e10';
const RIM = '#26262b';
const FACES = ['#fafafa', '#a1a1aa', '#52525b']; // light, mid, shade — each blade turns the light one step
const GAP = 2.8;

// the mark is placed by the centre of its bounding box, not by the blades' pivot at (50, 52)
const MARK_CENTRE = '-49.4 -47.8';

// one blade: a slab rising from the centre plus the fold that turns it, around a centre at (50, 52)
const BAND = [[50, 52], [50, 17], [65.2, 25.8], [65.2, 43.2]];
const FOLD = [[50, 52], [65.2, 43.2], [80.4, 52], [65.2, 60.8]];

function rot([x, y], deg) {
  const r = (deg * Math.PI) / 180;
  const dx = x - 50;
  const dy = y - 52;
  return [50 + dx * Math.cos(r) - dy * Math.sin(r), 52 + dx * Math.sin(r) + dy * Math.cos(r)];
}

/** The three blades; `faces` overrides the colours (the menu-bar template uses one colour at three opacities). */
export function triad(faces = FACES) {
  const tone = [[faces[0], faces[1]], [faces[1], faces[2]], [faces[2], faces[0]]];
  return [0, 120, 240]
    .map((deg, i) => {
      // each blade moves out along the line between its slab and its fold, opening the gaps
      const a = ((deg - 90) * Math.PI) / 180 + Math.PI / 6;
      const push = ([x, y]) => [x + Math.cos(a) * GAP, y + Math.sin(a) * GAP];
      const pts = (shape) => shape.map((p) => push(rot(p, deg)).map((n) => n.toFixed(2)).join(',')).join(' ');
      return `<polygon points="${pts(BAND)}" fill="${tone[i][0]}"/><polygon points="${pts(FOLD)}" fill="${tone[i][1]}"/>`;
    })
    .join('');
}

const svg = (body, size = 1024) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${body}</svg>\n`;

// macOS icon grid: the tile sits inside 824/1024 of the canvas, leaving room for the system shadow
const appIcon = svg(
  `<defs><filter id="contact" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="2.2"/><feOffset dy="2" result="b"/><feComponentTransfer><feFuncA type="linear" slope=".32"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` +
    `<g transform="translate(50 50) scale(.805) translate(-50 -50)"><rect x="4" y="4" width="92" height="92" rx="22" fill="${TILE}"/><rect x="4.5" y="4.5" width="91" height="91" rx="21.5" fill="none" stroke="${RIM}"/>` +
    `<g filter="url(#contact)" transform="translate(50 50) scale(.84) translate(${MARK_CENTRE})">${triad()}</g></g>`,
);
const glyph = (faces) => svg(`<g transform="translate(50 50) scale(1.12) translate(${MARK_CENTRE})">${triad(faces)}</g>`, 256);

const files = {
  'tether-icon.svg': appIcon,
  'tether-glyph-dark.svg': glyph(FACES), // for dark backgrounds
  'tether-glyph-light.svg': glyph(['#18181b', '#71717a', '#d4d4d8']), // for light backgrounds
  // macOS template image: black + alpha only; the system tints it for light and dark menu bars
  'tether-menubarTemplate.svg': glyph(['#000000', '#000000b3', '#00000066']),
};

mkdirSync(OUT, { recursive: true });
for (const [name, text] of Object.entries(files)) writeFileSync(join(OUT, name), text);
console.log(`wrote ${Object.keys(files).length} SVGs to ${OUT}`);

if (process.argv.includes('--png')) {
  const set = join(OUT, 'tether.iconset');
  rmSync(set, { recursive: true, force: true });
  mkdirSync(set);
  const render = (src, px, dest) => execFileSync('rsvg-convert', ['-w', String(px), '-h', String(px), '-o', dest, join(OUT, src)]);
  for (const base of [16, 32, 128, 256, 512]) {
    render('tether-icon.svg', base, join(set, `icon_${base}x${base}.png`));
    render('tether-icon.svg', base * 2, join(set, `icon_${base}x${base}@2x.png`));
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', join(OUT, 'tether.icns')]);
  render('tether-icon.svg', 1024, join(OUT, 'tether-icon-1024.png'));
  render('tether-menubarTemplate.svg', 16, join(OUT, 'tether-menubarTemplate.png'));
  render('tether-menubarTemplate.svg', 32, join(OUT, 'tether-menubarTemplate@2x.png'));
  rmSync(set, { recursive: true, force: true });
  console.log('rendered tether.icns, tether-icon-1024.png and the menu-bar template PNGs');
}
