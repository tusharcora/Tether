import { Maximize2, Minus, Plus, RotateCw } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { VaultGraph } from '../api';
import { cn } from '../ui/cn';
import { ease, fitView, focusView, lerpView, toWorld, zoomAt, type View } from './camera';
import type { Sim } from './forceSim';
import { nodeRadius, shapePath, typeOf, type GraphType } from './graphModel';
import { useForceLayout } from './useForceLayout';
import './graph.css';

export interface BoardHandle {
  /** Glide the camera to a note. */
  focus: (id: string) => void;
  /** Glide the camera to show every visible note. */
  fit: () => void;
}

export interface GraphBoardProps {
  graph: VaultGraph;
  hiddenTypes: ReadonlySet<GraphType>;
  selected?: string;
  /** The note the highlight is about: the hovered one, else the selected one. */
  focus?: string;
  /** The focus note's neighbourhood (empty without a focus). */
  near: ReadonlySet<string>;
  hits: ReadonlySet<string>;
  /** Notes a run just wrote: they ping. */
  fresh: ReadonlySet<string>;
  reduced: boolean;
  /** On the first settle, glide to this note instead of fitting everything (a deep link). */
  initialFocus?: string;
  onHover: (id?: string) => void;
  onSelect: (id?: string) => void;
  /** Double-click, Enter or Space: select the note and glide to it. */
  onOpen: (id: string) => void;
  /** Overlays drawn over the board (the hop control, the ticker). */
  children?: ReactNode;
}

const GLIDE_MS = 280;
/** jsdom and a not-yet-laid-out board report 0×0. */
const FALLBACK = { w: 800, h: 560 };
const at = (p: { x: number; y: number }) => `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`;
const short = (t: string) => (t.length > 28 ? `${t.slice(0, 27)}…` : t);

type Drag = { kind: 'node'; id: string; moved: boolean; sx: number; sy: number } | { kind: 'pan'; moved: boolean; sx: number; sy: number; vx: number; vy: number };

export const GraphBoard = forwardRef<BoardHandle, GraphBoardProps>(function GraphBoard(p, ref) {
  const svg = useRef<SVGSVGElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const edgeEls = useRef<(SVGLineElement | null)[]>([]);
  const [view, setView] = useState<View>({ x: FALLBACK.w / 2, y: FALLBACK.h / 2, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const glide = useRef<number | null>(null);
  const drag = useRef<Drag | undefined>(undefined);
  /** The last pointer gesture on a note moved it: the click that follows is not a selection. */
  const dragged = useRef(false);
  const fitted = useRef(false);
  /** The note under the pointer: its links run flowing dashes until the pointer leaves (interaction feedback, not a resting loop). */
  const [hovered, setHovered] = useState<string>();

  const hiddenIds = useMemo(() => new Set(p.graph.nodes.filter((n) => p.hiddenTypes.has(typeOf(n.type))).map((n) => n.id)), [p.graph, p.hiddenTypes]);

  /** Move SVG nodes and edges straight from the simulation: no React render per frame. */
  const paint = useCallback(
    (s: Sim) => {
      for (const n of s.nodes) nodeEls.current.get(n.id)?.setAttribute('transform', at(n));
      p.graph.edges.forEach((e, i) => {
        const el = edgeEls.current[i];
        const a = s.nodes[s.index.get(e.from) ?? -1];
        const b = s.nodes[s.index.get(e.to) ?? -1];
        if (!el || !a || !b) return;
        el.setAttribute('x1', a.x.toFixed(1));
        el.setAttribute('y1', a.y.toFixed(1));
        el.setAttribute('x2', b.x.toFixed(1));
        el.setAttribute('y2', b.y.toFixed(1));
      });
    },
    [p.graph],
  );

  const size = () => {
    const r = svg.current?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? { w: r.width, h: r.height } : FALLBACK;
  };
  const stopGlide = () => {
    if (glide.current !== null) cancelAnimationFrame(glide.current);
    glide.current = null;
  };
  const glideTo = (target: View) => {
    stopGlide();
    if (p.reduced) return setView(target);
    const from = viewRef.current;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / GLIDE_MS);
      setView(lerpView(from, target, ease(t)));
      glide.current = t < 1 ? requestAnimationFrame(frame) : null;
    };
    glide.current = requestAnimationFrame(frame);
  };
  useEffect(() => stopGlide, []);

  const layout = useForceLayout(p.graph, hiddenIds, {
    reduced: p.reduced,
    paint,
    onSettled: () => {
      if (fitted.current) return;
      fitted.current = true;
      const { w, h } = size();
      const target = p.initialFocus ? layout.position(p.initialFocus) : undefined;
      glideTo(target ? focusView(target, 1.25, w, h) : fitView(layout.points(), w, h));
    },
  });

  const fit = () => {
    const { w, h } = size();
    glideTo(fitView(layout.points(), w, h));
  };
  useImperativeHandle(ref, () => ({
    focus: (id) => {
      const pt = layout.position(id);
      if (!pt) return;
      const { w, h } = size();
      glideTo(focusView(pt, Math.max(viewRef.current.k, 1.25), w, h));
    },
    fit,
  }));
  const zoomBy = (factor: number) => {
    const { w, h } = size();
    glideTo(zoomAt(viewRef.current, factor, w / 2, h / 2));
  };

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopGlide();
      const r = el.getBoundingClientRect();
      setView((v) => zoomAt(v, Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  const onNodeDown = (e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    svg.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: 'node', id, moved: false, ...local(e) };
  };
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    svg.current?.setPointerCapture(e.pointerId);
    stopGlide();
    drag.current = { kind: 'pan', moved: false, ...local(e), vx: viewRef.current.x, vy: viewRef.current.y };
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const { sx, sy } = local(e);
    if (Math.abs(sx - d.sx) + Math.abs(sy - d.sy) > 3) d.moved = true;
    if (!d.moved) return;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + sx - d.sx, y: d.vy + sy - d.sy }));
    else {
      const w = toWorld(viewRef.current, sx, sy);
      layout.drag(d.id, w.x, w.y);
    }
  };
  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = undefined;
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.kind === 'node') {
      dragged.current = d.moved;
      if (d.moved) layout.release(d.id);
    } else if (!d.moved) p.onSelect(undefined);
  };

  const pos = (id: string) => layout.position(id);
  const anyVisible = p.graph.nodes.some((n) => !hiddenIds.has(n.id));
  const dimFor = (id: string) => (p.hits.size ? !p.hits.has(id) : p.near.size ? !p.near.has(id) : false);

  return (
    <div className="gb">
      <svg ref={svg} className="gb-svg" role="group" aria-label="Note graph. The All notes list moves between notes with the keyboard." onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <defs>
          <pattern id="gb-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" className="gb-dot" />
          </pattern>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#gb-dots)" />
          {layout.version ? (
            <>
              {p.graph.edges.map((e, i) => {
                const a = pos(e.from);
                const b = pos(e.to);
                if (!a || !b) return null;
                const hot = !!p.focus && (e.from === p.focus || e.to === p.focus) && !p.hits.size;
                const close = p.near.has(e.from) && p.near.has(e.to);
                const flow = !!hovered && (e.from === hovered || e.to === hovered) && !p.hits.size;
                return (
                  <line
                    key={`${e.from}→${e.to}`}
                    data-ge={`${e.from}→${e.to}`}
                    ref={(el) => {
                      edgeEls.current[i] = el;
                    }}
                    className={cn('gb-edge', { hot, flow, close, dim: p.hits.size > 0 || (p.near.size > 0 && !close), hidden: hiddenIds.has(e.from) || hiddenIds.has(e.to) })}
                    x1={a.x.toFixed(1)}
                    y1={a.y.toFixed(1)}
                    x2={b.x.toFixed(1)}
                    y2={b.y.toFixed(1)}
                  />
                );
              })}
              {p.graph.nodes.map((n) => {
                const pt = pos(n.id);
                if (!pt) return null;
                const t = typeOf(n.type);
                const sel = p.selected === n.id;
                const near = p.near.has(n.id);
                const hit = p.hits.has(n.id);
                const hidden = hiddenIds.has(n.id);
                const r = nodeRadius(n.degree) + (sel ? 3 : 0);
                const label = sel || hit || (near && p.near.size > 0) || n.degree >= 3 || view.k > 1.4;
                return (
                  <g
                    key={n.id}
                    ref={(el) => {
                      if (el) nodeEls.current.set(n.id, el);
                      else nodeEls.current.delete(n.id);
                    }}
                    data-gn={n.id}
                    className={cn('gb-node', `t-${t}`, { sel, near: near && !sel, hit, dim: dimFor(n.id), hidden })}
                    transform={at(pt)}
                    role="button"
                    tabIndex={!hidden && (sel || near) ? 0 : -1}
                    aria-label={`${n.title}, ${t}, ${n.degree} link${n.degree === 1 ? '' : 's'}`}
                    aria-hidden={hidden || undefined}
                    onPointerDown={(e) => onNodeDown(e, n.id)}
                    onPointerEnter={() => {
                      setHovered(n.id);
                      p.onHover(n.id);
                    }}
                    onPointerLeave={() => {
                      setHovered((h) => (h === n.id ? undefined : h));
                      p.onHover(undefined);
                    }}
                    onClick={() => {
                      if (dragged.current) {
                        dragged.current = false;
                        return;
                      }
                      p.onSelect(n.id);
                    }}
                    onDoubleClick={() => p.onOpen(n.id)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      p.onOpen(n.id);
                    }}
                  >
                    {p.fresh.has(n.id) && !hidden ? <circle className="gb-ping" r={r + 4} /> : null}
                    {hit ? <circle className="gb-match" r={r + 8} /> : null}
                    <path className="gb-shape" d={shapePath(t, r)} />
                    {label ? (
                      <text className="gb-label" y={r + 14} textAnchor="middle">
                        {short(n.title)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </>
          ) : null}
        </g>
      </svg>
      <div className="gb-tools">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          <Plus size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
          <Minus size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Fit all notes" onClick={fit}>
          <Maximize2 size={14} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Re-run the layout" onClick={layout.rerun}>
          <RotateCw size={14} aria-hidden="true" />
        </button>
      </div>
      {anyVisible ? null : <p className="gb-empty">All note types are hidden. Turn one back on above.</p>}
      {p.children}
      <p className="gb-hint">drag a note · scroll to zoom · drag the background to pan · double-click to focus</p>
    </div>
  );
});
