/** Pan and zoom for the Graph: screen = world × k + (x, y), in the board's CSS pixels. */
export interface View {
  x: number;
  y: number;
  k: number;
}
export const K_MIN = 0.3;
export const K_MAX = 3;
export const clampK = (k: number) => Math.min(K_MAX, Math.max(K_MIN, k));

/** Zoom by `factor`, keeping the screen point (cx, cy) over the same world point. */
export function zoomAt(v: View, factor: number, cx: number, cy: number): View {
  const k = clampK(v.k * factor);
  return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
}

/** The view that shows every point with `pad` pixels to spare, never zoomed in past 1.4. */
export function fitView(points: { x: number; y: number }[], w: number, h: number, pad = 60): View {
  if (!points.length) return { x: w / 2, y: h / 2, k: 1 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const k = clampK(Math.min((w - 2 * pad) / Math.max(maxX - minX, 1), (h - 2 * pad) / Math.max(maxY - minY, 1), 1.4));
  return { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k };
}

/** The view that puts world point `p` in the middle of the board at zoom `k`. */
export function focusView(p: { x: number; y: number }, k: number, w: number, h: number): View {
  const kk = clampK(k);
  return { k: kk, x: w / 2 - p.x * kk, y: h / 2 - p.y * kk };
}

export const toWorld = (v: View, sx: number, sy: number) => ({ x: (sx - v.x) / v.k, y: (sy - v.y) / v.k });

/** Ease-out cubic: the glide starts quick and lands softly (pairs with --ease). */
export const ease = (t: number) => 1 - (1 - t) ** 3;

export const lerpView = (a: View, b: View, t: number): View => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, k: a.k + (b.k - a.k) * t });
