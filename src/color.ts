/** Small colour maths for the theme editor: hex parsing, HSL nudging. Pure. */
export type RGB = [number, number, number];

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const byte = (n: number) => clamp(Math.round(n), 0, 255);

export function parseHex(s: string): RGB | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return undefined;
  const h = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const toHex = ([r, g, b]: RGB) => '#' + [r, g, b].map((v) => byte(v).toString(16).padStart(2, '0')).join('');

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): RGB {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [byte((r + m) * 255), byte((g + m) * 255), byte((b + m) * 255)];
}

/** Shift hue (degrees), saturation and lightness (both in 0..1 units) of a colour. Lightness stays readable (0.12..0.92). */
export function nudge(c: RGB, d: { h?: number; s?: number; l?: number }): RGB {
  const [h, s, l] = rgbToHsl(c);
  return hslToRgb([h + (d.h ?? 0), clamp(s + (d.s ?? 0), 0, 1), clamp(l + (d.l ?? 0), 0.12, 0.92)]);
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: RGB, b: RGB): number {
  const lum = (c: RGB) => {
    const f = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * f[0]! + 0.7152 * f[1]! + 0.0722 * f[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}
