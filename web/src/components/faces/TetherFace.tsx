/**
 * From bencho.dev "Eye tracker" (`Watcher`), MIT License, Copyright (c) 2026 Lorenzo Cabra; the full notice is in
 * ./LICENSE. Adapted for Tether (spec §4, "Tether's face"): renamed TetherFace; colours are Studio tokens through
 * `--tf-slab` / `--tf-eye` (no literals); the poke chat bubble (its own blue/pink tints) and the shape morph are dropped;
 * it follows the pointer anywhere in its `within` box (the page by default) and its loop parks once the eyes settle,
 * waking for the pointer or the next blink; `idle` (small or static uses) is a still mark facing front, without the
 * original's glances (Tether loops only for live state); reduced motion is still too; the accessible name is the caller's.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import './TetherFace.css';

/* ══ Eye tracker ═══════════════════════════════════════════
   A ball with two eyes that watches your cursor, wherever it is
   on the page.

   ── THE EYES ARE ON THE BALL, NOT IN FRONT OF IT ───────────
   The easy version slides two shapes toward the pointer, and it
   reads as stickers on a disc. Here each eye is a point on the
   sphere's surface: looking left turns the ball, so an eye
   travels along the curve, and the one heading for the rim
   moves less and narrows as it turns away from you while the
   other swings wide. That foreshortening is the whole trick —
   it is what makes a flat circle read as something round.

   One turn (yaw and pitch) is the state, sprung toward where
   the pointer is; both eyes are read off it, so they can never
   disagree. It relaxes back to facing you when the pointer
   leaves the window, and it blinks on its own now and then.

   Written straight to the DOM every frame, never through state:
   a pointer move is not a render. */

/* Read once: a preference, not a live input. */
const stillness = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const R = 50; /* the ball's radius, in the 100-unit viewBox */

/* ── the eyes: a style, and where they rest ─────────────────
   Every style is two rounded rectangles, the same size as each
   other, so they all ride the same sphere and blink the same
   way. Any difference in SIZE between the two is depth, worked
   out from the turn, never drawn in. */
type Eye = { w: number; h: number; r: number };

const STYLES: Record<string, Eye> = {
  Slant: { w: 9, h: 15, r: 4.5 },
  Dots: { w: 11, h: 11, r: 5.5 },
  Squares: { w: 12, h: 12, r: 3.5 },
};
/* half the gap between the eyes, as a fraction of the radius */
const GAP = 0.19;
/* how far a look to a corner tilts the pair, in degrees at the rim */
const TILT = 64;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* the outline the eyes are clipped to; the eyes are worked out on a sphere whatever the body is */
const SHAPES: Record<string, string> = {
  Ball: 'M50 0 A50 50 0 1 1 49.99 0 Z',
  Cube: 'M30 6 H70 A24 24 0 0 1 94 30 V70 A24 24 0 0 1 70 94 H30 A24 24 0 0 1 6 70 V30 A24 24 0 0 1 30 6 Z',
  Pill: 'M34 17 H66 A33 33 0 0 1 66 83 H34 A33 33 0 0 1 34 17 Z',
};

export interface TetherFaceProps {
  size?: number;
  /** A mark rather than a face: still, facing front, ignoring the pointer (small and static uses). */
  idle?: boolean;
  /** How far it turns toward the pointer, 0..100. */
  follow?: number;
  /** How much the turn overshoots and settles, 0..100. */
  bounce?: number;
  shape?: keyof typeof SHAPES;
  eyes?: keyof typeof STYLES;
  /** The eyes' size against the body (a small mark wants them bigger). */
  eyeScale?: number;
  /** The box it watches the pointer inside, as a selector; the whole page when unset. */
  within?: string;
  /** Its accessible name; decorative (hidden) when unset. */
  label?: string;
  className?: string;
}

export function TetherFace({ size = 32, idle = false, follow = 60, bounce = 30, shape = 'Cube', eyes: look = 'Slant', eyeScale = 1, within, label, className }: TetherFaceProps) {
  const box = useRef<HTMLSpanElement>(null);
  const eyes = useRef<(SVGGElement | null)[]>([]);
  const knobs = useRef({ follow, bounce, eyeScale });
  knobs.current = { follow, bounce, eyeScale };
  const base = STYLES[look] ?? STYLES.Slant!;
  const eye = { w: base.w * eyeScale, h: base.h * eyeScale, r: base.r * eyeScale };
  const eyeNow = useRef(eye);
  eyeNow.current = eye;
  const clip = `tf-clip-${useRef(Math.random().toString(36).slice(2, 9)).current}`;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const still = stillness();
    /* where the face is on the ball (fractions of the radius), its speed, and where it is heading */
    const t = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
    let raf = 0;
    let prev = 0;
    let blink = 0;
    let nextBlink = performance.now() + 2200;

    const quiet = still || idle;
    const draw = (now: number) => {
      /* a blink is 160ms down and up, as a squash on each eye */
      let lid = 1;
      if (!quiet && now > nextBlink) {
        blink = now;
        nextBlink = now + 2600 + Math.random() * 3200;
      }
      const since = now - blink;
      if (!quiet && since < 160) lid = 1 - 0.9 * Math.sin((since / 160) * Math.PI);
      /* the turn that brings the front of the ball to the face's spot: yaw about the vertical, pitch about the horizontal */
      const as = (v: number) => Math.asin(clamp(v, -0.92, 0.92));
      const yaw = as(t.x);
      const pitch = -as(t.y);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      /* the pair leans with a diagonal look and stands level on the axes */
      const tilt = TILT * t.x * t.y;
      /* bigger eyes stand a little further apart */
      const g0 = GAP * Math.max(1, knobs.current.eyeScale * 0.8);
      [-g0, g0].forEach((x0, i) => {
        const g = eyes.current[i];
        if (!g) return;
        /* the eye as a point on the unit sphere, either side of the front, turned with the ball */
        const z0 = Math.sqrt(1 - x0 * x0);
        const x1 = x0 * cy + z0 * sy;
        const z1 = -x0 * sy + z0 * cy;
        const y2 = -z1 * sp;
        const z2 = z1 * cp;
        /* depth: the eye nearer the rim is further from you, so it is smaller all over and narrower across the turn */
        const near = clamp(z2, 0, 1);
        const k = 0.45 + 0.55 * near;
        const sx = k * (0.7 + 0.3 * near);
        /* the size is written as a size, never as a scale, so every corner keeps the same radius */
        const e0 = eyeNow.current;
        const w = e0.w * sx;
        const h = Math.max(0.6, e0.h * k * lid);
        const rect = g.firstElementChild as SVGRectElement | null;
        if (rect) {
          rect.setAttribute('x', (-w / 2).toFixed(2));
          rect.setAttribute('y', (-h / 2).toFixed(2));
          rect.setAttribute('width', w.toFixed(2));
          rect.setAttribute('height', h.toFixed(2));
          rect.setAttribute('rx', Math.min(e0.r, w / 2, h / 2).toFixed(2));
        }
        g.setAttribute('transform', `translate(${(50 + x1 * R).toFixed(2)} ${(50 + y2 * R).toFixed(2)}) rotate(${tilt.toFixed(2)})`);
        g.style.opacity = z2 < 0.05 ? '0' : '1';
      });
    };

    // idle or reduced motion: one still drawing, facing front; no loop, no blinks, no listeners
    if (quiet) {
      draw(0);
      return;
    }

    /* ── it only runs while it can be seen, and parks once settled ── */
    let seen = true;
    let wake = 0;
    const tick = (now: number) => {
      if (!seen || document.hidden) {
        raf = 0;
        prev = 0;
        return;
      }
      const dt = prev ? Math.min(2.5, (now - prev) / 16.67) : 1;
      prev = now;
      /* one spring for both axes; bounce loosens the damping */
      const k = 0.06;
      const d = 0.34 - (clamp(knobs.current.bounce, 0, 100) / 100) * 0.22;
      t.vx += ((t.tx - t.x) * k - t.vx * d) * dt;
      t.vy += ((t.ty - t.y) * k - t.vy * d) * dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      draw(now);
      const settled = Math.abs(t.tx - t.x) < 0.002 && Math.abs(t.ty - t.y) < 0.002 && Math.abs(t.vx) < 0.002 && Math.abs(t.vy) < 0.002;
      if (settled && now - blink > 160) {
        // park until the pointer moves or the next blink is due
        raf = 0;
        prev = 0;
        window.clearTimeout(wake);
        wake = window.setTimeout(resume, Math.max(16, nextBlink - performance.now()));
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    function resume() {
      if (!raf && seen && !document.hidden) raf = requestAnimationFrame(tick);
    }
    const io = new IntersectionObserver(([e]) => {
      seen = !!e?.isIntersecting;
      resume();
    });
    io.observe(el);
    document.addEventListener('visibilitychange', resume);
    const unwatch = () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', resume);
      window.clearTimeout(wake);
    };
    const rest = () => {
      t.tx = 0;
      t.ty = 0;
      resume();
    };

    /* ── the face goes where you are, while you are in its box ── */
    const frame = (within ? el.closest<HTMLElement>(within) : null) ?? document.documentElement;
    const aim = (e: PointerEvent) => {
      const f = frame.getBoundingClientRect();
      if (within && (e.clientX < f.left || e.clientX > f.right || e.clientY < f.top || e.clientY > f.bottom)) {
        rest();
        return;
      }
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.max(60, Math.min(f.width || window.innerWidth, f.height || window.innerHeight) * 0.28);
      const far = Math.min(0.85, Math.tanh(dist / reach) * (clamp(knobs.current.follow, 0, 100) / 100) * 1.5);
      t.tx = (dx / dist) * far;
      t.ty = (dy / dist) * far;
      resume();
    };
    window.addEventListener('pointermove', aim, { passive: true });
    document.documentElement.addEventListener('pointerleave', rest);
    return () => {
      cancelAnimationFrame(raf);
      unwatch();
      window.removeEventListener('pointermove', aim);
      document.documentElement.removeEventListener('pointerleave', rest);
    };
  }, [idle, within]);

  const s = clamp(size, 12, 180);
  const body = SHAPES[shape] ?? SHAPES.Cube!;
  return (
    <span
      className={className ? `tf ${className}` : 'tf'}
      ref={box}
      style={{ '--tf-size': `${s}px` } as CSSProperties}
      data-idle={idle || undefined}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <svg className="tf-ball" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <path d={body} />
          </clipPath>
        </defs>
        <path className="tf-body" d={body} />
        <g clipPath={`url(#${clip})`}>
          {[0, 1].map((i) => (
            <g
              key={i}
              ref={(n) => {
                eyes.current[i] = n;
              }}
              transform={`translate(${(50 + (i ? GAP : -GAP) * R).toFixed(2)} 50)`}
            >
              <rect className="tf-eye" x={-eye.w / 2} y={-eye.h / 2} width={eye.w} height={eye.h} rx={eye.r} />
            </g>
          ))}
        </g>
      </svg>
    </span>
  );
}
