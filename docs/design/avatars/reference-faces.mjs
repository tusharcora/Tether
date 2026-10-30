// Throwaway mockup generator, v2 of "our own" faces: flat body + two thick tilted pill eyes, upper right, face turned.
// Drawn from scratch to the proportions of the reference look; no code or artwork from the reference project.
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('out2', { recursive: true });
const r2 = (n) => Math.round(n * 100) / 100;

// Each body: its SVG, plus the face circle (cx, cy, r) the eyes are placed on.
const BODIES = {
  orb: (f) => ({ svg: `<circle cx="50" cy="52" r="38" fill="${f}"/>`, face: [50, 52, 38] }),
  tile: (f) => ({ svg: `<rect x="15" y="17" width="70" height="70" rx="20" fill="${f}" transform="rotate(-7 50 52)"/>`, face: [50, 52, 36] }),
  bean: (f) => ({ svg: `<rect x="24" y="12" width="54" height="80" rx="27" fill="${f}" transform="rotate(-16 51 52)"/>`, face: [52, 46, 30] }),
  drop: (f) => ({ svg: `<path d="M50 10C58 22 86 44 86 62A36 36 0 0 1 14 62C14 44 42 22 50 10Z" fill="${f}" transform="rotate(-26 50 60)"/>`, face: [54, 58, 34] }),
  nub: (f) => ({ svg: `<circle cx="55" cy="48" r="34" fill="${f}"/><ellipse cx="25" cy="73" rx="15" ry="11" fill="${f}" transform="rotate(-20 25 73)"/>`, face: [55, 48, 34] }),
  cloud: (f) => ({ svg: [[32, 60, 20], [52, 44, 25], [72, 58, 19], [50, 68, 20]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}"/>`).join(''), face: [52, 54, 30] }),
  flower: (f) => ({ svg: Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * 2 * Math.PI; return `<circle cx="${r2(50 + 30 * Math.cos(a))}" cy="${r2(52 + 30 * Math.sin(a))}" r="12" fill="${f}"/>`; }).join('') + `<circle cx="50" cy="52" r="27" fill="${f}"/>`, face: [50, 52, 27] }),
  block: (f) => ({ svg: `<circle cx="27" cy="27" r="11" fill="${f}"/><circle cx="73" cy="27" r="11" fill="${f}"/><rect x="16" y="24" width="68" height="62" rx="16" fill="${f}"/>`, face: [50, 56, 32] }),
};
const INK = { '#0B0B0C': '#FFFFFF', '#FBC3E6': '#3D4A63' };

// Eyes on a face circle. Idle: the near eye is the bigger one, the far eye smaller and higher (face turned up-right).
function eyes([cx, cy, r], mood, ink) {
  const pill = (x, y, w, h, rot) => `<rect x="${r2(x - w / 2)}" y="${r2(y - h / 2)}" width="${r2(w)}" height="${r2(h)}" rx="${r2(w / 2)}" fill="${ink}" transform="rotate(${rot} ${r2(x)} ${r2(y)})"/>`;
  const arc = (x, y, w, up, rot) => `<path d="M${r2(x - w)} ${r2(y)}q${r2(w)} ${r2(up ? -w * 1.1 : w * 0.9)} ${r2(2 * w)} 0" fill="none" stroke="${ink}" stroke-width="${r2(r * 0.13)}" stroke-linecap="round" transform="rotate(${rot} ${r2(x)} ${r2(y)})"/>`;
  const e1 = [cx + 0.2 * r, cy - 0.36 * r], e2 = [cx + 0.6 * r, cy - 0.47 * r];
  const W = 0.29 * r, H = 0.52 * r;
  switch (mood) {
    case 'working': // looking further up and right
      return pill(e1[0] + 0.08 * r, e1[1] - 0.1 * r, W, H * 0.92, -24) + pill(e2[0] + 0.06 * r, e2[1] - 0.1 * r, W * 0.78, H * 0.72, -26);
    case 'done':
      return arc(e1[0] - 0.04 * r, e1[1] + 0.1 * r, W * 0.55, true, -14) + arc(e2[0] + 0.02 * r, e2[1] + 0.04 * r, W * 0.45, true, -16);
    case 'failed': // eyes drop and lean the other way
      return pill(e1[0] - 0.04 * r, e1[1] + 0.18 * r, W, H * 0.8, 24) + pill(e2[0] - 0.02 * r, e2[1] + 0.16 * r, W * 0.8, H * 0.64, 28);
    case 'asleep':
      return arc(e1[0] - 0.04 * r, e1[1] + 0.04 * r, W * 0.55, false, -14) + arc(e2[0] + 0.02 * r, e2[1] - 0.02 * r, W * 0.45, false, -16);
    default:
      return pill(e1[0], e1[1], W, H, -20) + pill(e2[0], e2[1], W * 0.8, H * 0.76, -22);
  }
}
const face = (body, fill, mood = 'idle') => {
  const b = BODIES[body](fill);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="120" height="120">${b.svg}${eyes(b.face, mood, INK[fill] ?? '#17181A')}</svg>`;
};

// The six agents, assigned by hand for the mockup (a real build picks from the bot id).
const AGENTS = { scout: ['orb', '#5E7FE6'], brick: ['block', '#E8835F'], bolt: ['orb', '#0B0B0C'], probe: ['bean', '#58B6C4'], lens: ['drop', '#F7D02C'], boss: ['tile', '#E35A5A'] };
for (const [id, [b, f]] of Object.entries(AGENTS)) writeFileSync(`out2/own-${id}.svg`, face(b, f));
for (const m of ['idle', 'working', 'done', 'failed', 'asleep']) writeFileSync(`out2/own-mood-${m}.svg`, face('orb', '#0B0B0C', m));
// The whole range: every body, one colour each.
const RANGE = [['orb', '#5E7FE6'], ['block', '#E8835F'], ['drop', '#F7D02C'], ['bean', '#58B6C4'], ['orb', '#0B0B0C'], ['flower', '#E5935A'], ['nub', '#FBC3E6'], ['cloud', '#C9CACD'], ['tile', '#E35A5A'], ['orb', '#DCE3F5']];
RANGE.forEach(([b, f], i) => writeFileSync(`out2/range-${i}.svg`, face(b, f)));
console.log('ok');
