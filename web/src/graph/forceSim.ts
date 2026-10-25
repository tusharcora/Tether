/**
 * A small hand-written force layout for the vault graph. Links pull like springs, notes push apart within a cut-off
 * (a spatial grid keeps a tick roughly linear in notes), a weak pull holds everything near the centre. Every force is
 * scaled by `alpha`, which cools a little each tick, so the layout always comes to rest; a drag, a filter change or
 * Re-run heats it again. Deterministic: the same notes start in the same places and the same seed kicks the same way.
 */
export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
  hidden: boolean;
}
export interface Sim {
  nodes: SimNode[];
  index: Map<string, number>;
  links: [number, number][];
  alpha: number;
  /** Average speed of the moving notes after the last tick. */
  energy: number;
}

/** Average speed (world units per tick) below which the layout counts as settled. */
export const REST = 0.02;
const LINK = 120;
const SPRING = 0.012;
const REPEL = 5200;
const CUTOFF = 320;
const FADE_FROM = CUTOFF * 0.75;
const GRAVITY = 0.0025;
const KEEP = 0.82;
const COOL = 0.98;

export function createSim(nodes: { id: string }[], edges: { from: string; to: string }[], prev?: Map<string, { x: number; y: number }>): Sim {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const links: [number, number][] = [];
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) links.push([a, b]);
  }
  // a sunflower spiral: even density from the first tick, the same every time
  const sim: SimNode[] = nodes.map((n, i) => {
    const p = prev?.get(n.id);
    const r = 28 * Math.sqrt(i + 0.5);
    const a = i * 2.399963;
    return { id: n.id, x: p ? p.x : Math.cos(a) * r, y: p ? p.y : Math.sin(a) * r, vx: 0, vy: 0, fixed: false, hidden: false };
  });
  if (prev?.size) {
    // a note that is new to a known graph starts beside a note it links to, so it springs in from there
    nodes.forEach((n, i) => {
      if (prev.has(n.id)) return;
      const link = links.find(([a, b]) => (a === i && prev.has(nodes[b]!.id)) || (b === i && prev.has(nodes[a]!.id)));
      if (!link) return;
      const o = sim[link[0] === i ? link[1] : link[0]]!;
      sim[i]!.x = o.x + Math.cos(i * 2.4) * 30;
      sim[i]!.y = o.y + Math.sin(i * 2.4) * 30;
    });
  }
  return { nodes: sim, index, links, alpha: prev?.size ? 0.3 : 1, energy: 1 };
}

export function tick(s: Sim): number {
  const ns = s.nodes;
  const a = s.alpha;
  const grid = new Map<string, number[]>();
  ns.forEach((n, i) => {
    if (n.hidden) return;
    const k = `${Math.floor(n.x / CUTOFF)},${Math.floor(n.y / CUTOFF)}`;
    let cell = grid.get(k);
    if (!cell) grid.set(k, (cell = []));
    cell.push(i);
  });
  for (let i = 0; i < ns.length; i++) {
    const p = ns[i]!;
    if (p.hidden) continue;
    const cx = Math.floor(p.x / CUTOFF);
    const cy = Math.floor(p.y / CUTOFF);
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gy = cy - 1; gy <= cy + 1; gy++)
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          if (j <= i) continue;
          const q = ns[j]!;
          let dx = q.x - p.x;
          let dy = q.y - p.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > CUTOFF * CUTOFF) continue;
          if (d2 < 0.01) {
            dx = (((i * 7 + j * 3) % 5) - 2) * 0.1 || 0.1;
            dy = 0.1;
            d2 = dx * dx + dy * dy;
          }
          const d = Math.sqrt(d2);
          // full strength up to 3/4 of the cut-off, then a smooth fade to zero (no jump to oscillate on)
          const fade = d <= FADE_FROM ? 1 : (1 - (d - FADE_FROM) / (CUTOFF - FADE_FROM)) ** 2;
          const force = ((REPEL / Math.max(d2, 400)) * fade * a) / d;
          p.vx -= dx * force;
          p.vy -= dy * force;
          q.vx += dx * force;
          q.vy += dy * force;
        }
  }
  for (const [i, j] of s.links) {
    const p = ns[i]!;
    const q = ns[j]!;
    if (p.hidden || q.hidden) continue;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = ((d - LINK) * SPRING * a) / d;
    p.vx += dx * force;
    p.vy += dy * force;
    q.vx -= dx * force;
    q.vy -= dy * force;
  }
  let speed = 0;
  let moving = 0;
  for (const n of ns) {
    if (n.hidden || n.fixed) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx = (n.vx - n.x * GRAVITY * a) * KEEP;
    n.vy = (n.vy - n.y * GRAVITY * a) * KEEP;
    n.x += n.vx;
    n.y += n.vy;
    speed += (Math.abs(n.vx) + Math.abs(n.vy)) / 2;
    moving++;
  }
  s.alpha *= COOL;
  s.energy = moving ? speed / moving : 0;
  return s.energy;
}

/** Tick until the layout is at rest (or `max` ticks); big vaults get fewer ticks so the page never stalls. */
export function settle(s: Sim, max?: number): number {
  if (!s.nodes.length) return 0;
  const cap = max ?? (s.nodes.length > 5000 ? 150 : s.nodes.length > 1500 ? 300 : 1000);
  for (let i = 0; i < cap; i++) if (tick(s) < REST) return i + 1;
  return cap;
}

export function reheat(s: Sim, alpha: number): void {
  s.alpha = Math.max(s.alpha, alpha);
}

export function pin(s: Sim, id: string, x: number, y: number): void {
  const n = s.nodes[s.index.get(id) ?? -1];
  if (!n) return;
  Object.assign(n, { x, y, vx: 0, vy: 0, fixed: true });
  reheat(s, 0.3);
}

export function release(s: Sim, id: string): void {
  const n = s.nodes[s.index.get(id) ?? -1];
  if (!n) return;
  n.fixed = false;
  reheat(s, 0.3);
}

/** Re-run the layout: shake every visible note (the same way for the same seed) and heat fully. */
export function kick(s: Sim, seed: number): void {
  let t = seed >>> 0;
  const rnd = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  for (const n of s.nodes) {
    if (n.hidden || n.fixed) continue;
    n.vx += (rnd() - 0.5) * 30;
    n.vy += (rnd() - 0.5) * 30;
  }
  s.alpha = 1;
}

export function setHidden(s: Sim, ids: ReadonlySet<string>): void {
  for (const n of s.nodes) n.hidden = ids.has(n.id);
}

export function positions(s: Sim): Map<string, { x: number; y: number }> {
  return new Map(s.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}
