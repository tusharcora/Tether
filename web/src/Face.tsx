import { MARK_STYLES, useCrew, type MarkInfo, type Pixels } from './crewStore';

/** A bot drawn from its pixel grid: one rect per run of same-coloured pixels, crisp at any size. */
export function Sprite(props: { pixels: Pixels; size?: number; label?: string }) {
  const rows = props.pixels.grid;
  const w = 10;
  const size = props.size ?? 40;
  return (
    <svg viewBox={`0 0 ${w} ${rows.length}`} width={size} height={(size * rows.length) / w} shapeRendering="crispEdges" role="img" aria-label={props.label ?? 'bot'}>
      {rows.map((row, y) =>
        [...row].map((c, x) => (c === '.' || !props.pixels.colors[c] ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={props.pixels.colors[c]} />)),
      )}
    </svg>
  );
}

const ink = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const l = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l > 140 ? '#10141c' : '#e6ebf2';
};
/** The same fixed series per symbol every time: a gentle line, not noise. */
const spark = (seed: string): string => {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  let v = 3;
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    v = Math.max(0, Math.min(7, v + (h % 5) - 2));
    pts.push(`${(4 + i * 4.57).toFixed(1)},${(30 - v * 1.5).toFixed(1)}`);
  }
  return pts.join(' ');
};

/** A bot drawn as a mark: a bold glyph (sigil), a glyph tile (tile), a symbol chip with a line (ticker), or initials in a ring (orbit). */
export function Mark(props: { style: string; mark: MarkInfo; hue: string; size?: number; label?: string; progress?: number }) {
  const { shapes, glyphs } = useCrew();
  const size = props.size ?? 40;
  switch (props.style) {
    case 'sigil':
      return (
        <svg viewBox="0 0 10 8" width={size} height={(size * 8) / 10} shapeRendering="crispEdges" role="img" aria-label={props.label ?? props.mark.shape}>
          {(shapes[props.mark.shape] ?? []).map((row, y) =>
            [...row].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={props.hue} /> : null)),
          )}
        </svg>
      );
    case 'tile':
      return (
        <svg viewBox="0 0 40 40" width={size} height={size} role="img" aria-label={props.label ?? props.mark.shape}>
          <rect x="2" y="4" width="32" height="32" rx="8" fill={props.hue} />
          {(glyphs[props.mark.shape] ?? []).map((row, y) =>
            [...row].map((c, x) => (c === '#' ? <rect key={`${x}-${y}`} x={7 + x * 3.6} y={9 + y * 3.6} width="3.7" height="3.7" fill={ink(props.hue)} /> : null)),
          )}
          <circle cx="34" cy="7" r="4.2" fill="#3fb97c" stroke="var(--panel, #10141c)" strokeWidth="1.5" />
        </svg>
      );
    case 'ticker':
      return (
        <svg viewBox="0 0 40 40" width={size} height={size} role="img" aria-label={props.label ?? props.mark.symbol}>
          <rect x="3" y="5" width="34" height="14" rx="3.5" fill={props.hue} />
          <text x="20" y="15.2" textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontWeight="700" fontSize="9.5" fill={ink(props.hue)}>{props.mark.symbol}</text>
          <polyline points={spark(props.mark.symbol)} fill="none" stroke={props.hue} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 40 40" width={size} height={size} role="img" aria-label={props.label ?? props.mark.initials}>
          <circle cx="20" cy="20" r="17" fill="none" stroke={props.hue} strokeOpacity=".28" strokeWidth="3" />
          <circle cx="20" cy="20" r="17" fill="none" stroke={props.hue} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(props.progress ?? 0.7) * 106.8} 107`} transform="rotate(-90 20 20)" />
          <circle cx="20" cy="20" r="12" fill={props.hue} />
          <text x="20" y="24.5" textAnchor="middle" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontWeight="700" fontSize="11" fill={ink(props.hue)}>{props.mark.initials}</text>
        </svg>
      );
  }
}

/** A bot by role in the active style: a mark for sigil, tile, ticker and orbit; otherwise its pixel look, else a plain pebble in its colour. */
export function Face(props: { role: string; size?: number }) {
  const { crew, style } = useCrew();
  const c = crew[props.role] ?? crew.coder ?? { name: 'Bolt', title: 'coder', hue: '#3fb97c' };
  const size = props.size ?? 40;
  if (MARK_STYLES.includes(style) && c.mark) return <Mark style={style} mark={c.mark} hue={c.hue} size={size} label={c.name} />;
  if (c.pixels) return <Sprite pixels={c.pixels} size={size} label={c.name} />;
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} role="img" aria-label={c.name}>
      <path d="M16 3c7 0 12.5 5 12.5 12.5 0 7.6-5 13.5-12.5 13.5S3.5 23.1 3.5 15.5C3.5 8 9 3 16 3z" fill={c.hue} />
      <circle cx="11.5" cy="18.5" r="1.9" fill="#0d1117" />
      <circle cx="20.5" cy="18.5" r="1.9" fill="#0d1117" />
    </svg>
  );
}
