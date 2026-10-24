export const W = 1000;
export const H = 640;

/** Fruchterman–Reingold layout. Deterministic (seeded circle start) so the picture is stable between loads. */
export function layout(nodes: { id: string }[], edges: { from: string; to: string }[]): Map<string, { x: number; y: number }> {
  const n = nodes.length;
  const pos = new Map<string, { x: number; y: number }>();
  if (!n) return pos;
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const px = new Float64Array(n), py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 120 + ((i * 53) % 90);
    px[i] = W / 2 + Math.cos(a) * r;
    py[i] = H / 2 + Math.sin(a) * r;
  }
  const es = edges.map((e) => [idx.get(e.from), idx.get(e.to)] as const).filter((e): e is readonly [number, number] => e[0] !== undefined && e[1] !== undefined);
  const k = Math.sqrt((W * H) / n) * 0.65;
  const iters = n > 500 ? 90 : n > 200 ? 160 : 300;
  const dx = new Float64Array(n), dy = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        let ex = px[i]! - px[j]!, ey = py[i]! - py[j]!;
        let d = Math.hypot(ex, ey);
        if (d < 0.01) (ex = 0.1 * ((i % 3) - 1 || 1), ey = 0.1, (d = 0.15));
        const f = (k * k) / d / d;
        dx[i]! += ex * f; dy[i]! += ey * f;
        dx[j]! -= ex * f; dy[j]! -= ey * f;
      }
    for (const [a, b] of es) {
      const ex = px[a]! - px[b]!, ey = py[a]! - py[b]!;
      const d = Math.hypot(ex, ey) || 0.01;
      const f = d / k;
      dx[a]! -= ex * f; dy[a]! -= ey * f;
      dx[b]! += ex * f; dy[b]! += ey * f;
    }
    const t = (W / 8) * (1 - it / iters) + 1;
    for (let i = 0; i < n; i++) {
      dx[i]! += (W / 2 - px[i]!) * 0.012;
      dy[i]! += (H / 2 - py[i]!) * 0.012;
      const m = Math.hypot(dx[i]!, dy[i]!) || 1;
      const s = Math.min(m, t) / m;
      px[i]! += dx[i]! * s;
      py[i]! += dy[i]! * s;
    }
  }
  nodes.forEach((nd, i) => pos.set(nd.id, { x: px[i]!, y: py[i]! }));
  return pos;
}
