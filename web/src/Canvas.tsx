import { Maximize2, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { Edge, NodeState, PipelineNode } from '../../src/types.js';
import { fmtUsd } from './api';
import { crewFor, useCrew } from './crewStore';
import { NodeActions, type NodeAction } from './components/bencho/ActionNode';
import { Face, moodFor } from './Face';
import { stepDesc } from './ui/studio/status';
import { StatusBadge } from './ui/studio/StatusBadge';
import { cn } from './ui/cn';
import './canvas.css';

export const NODE_W = 212;
export const NODE_H = 92;

export interface CanvasProps {
  nodes: PipelineNode[];
  edges: Edge[];
  selected?: string;
  statuses?: Record<string, NodeState>;
  issueNodes?: Set<string>;
  editable?: boolean;
  /** A short how-to line in the bottom-left corner while the canvas has steps. */
  hint?: string;
  /** Change it to fit the steps to the view again (e.g. when another workflow opens); the canvas also fits once on mount. */
  fitKey?: unknown;
  onSelect?: (id?: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onConnect?: (from: string, to: string) => void;
  onDeleteEdge?: (from: string, to: string) => void;
  onDeleteNode?: (id: string) => void;
  /** What a step's card offers in its corner on hover or focus (bencho's action node): run from here, edit, duplicate, delete. */
  nodeActions?: (id: string) => NodeAction[];
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'node'; id: string; ox: number; oy: number }
  | { kind: 'link'; from: string };


const edgePath = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = Math.max(48, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
};

export function Canvas(props: CanvasProps) {
  const el = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 40, y: 40, k: 1 });
  const [preview, setPreview] = useState<{ x1: number; y1: number; x2: number; y2: number } | undefined>();
  const [selEdge, setSelEdge] = useState<string | undefined>();
  const drag = useRef<Drag | undefined>(undefined);
  const { crew } = useCrew();

  const byId = (id: string) => props.nodes.find((n) => n.id === id);
  const toWorld = (cx: number, cy: number) => {
    const r = el.current!.getBoundingClientRect();
    const v = view;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  };

  function fit() {
    const node = el.current;
    if (!props.nodes.length || !node) return;
    const xs = props.nodes.map((n) => n.x);
    const ys = props.nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs) + NODE_W, minY = Math.min(...ys), maxY = Math.max(...ys) + NODE_H;
    const r = node.getBoundingClientRect();
    const k = Math.min(1.2, Math.max(0.3, Math.min((r.width - 80) / (maxX - minX), (r.height - 80) / (maxY - minY + 60))));
    setView({ k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: (r.height - (maxY - minY) * k) / 2 - minY * k });
  }
  useEffect(() => {
    const raf = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitKey]);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    const t = e.target as HTMLElement;
    // a press on a card's corner action is a plain click: no selection, no capture
    if (t.closest('[data-node-action]')) return;
    const root = el.current!;
    root.focus({ preventScroll: true });
    const out = t.closest('[data-port-out]') as HTMLElement | null;
    const head = t.closest('[data-node-head]') as HTMLElement | null;
    const edge = t.closest('[data-edge]') as SVGElement | null;
    if (edge) {
      setSelEdge(edge.getAttribute('data-edge') ?? undefined);
      props.onSelect?.(undefined);
      return;
    }
    root.setPointerCapture(e.pointerId);
    if (out && props.editable) {
      drag.current = { kind: 'link', from: out.dataset.id! };
      const n = byId(out.dataset.id!);
      if (n) setPreview({ x1: n.x + NODE_W, y1: n.y + NODE_H / 2, x2: n.x + NODE_W, y2: n.y + NODE_H / 2 });
      return;
    }
    if (head) {
      const id = (head.closest('[data-node]') as HTMLElement).dataset.id!;
      const n = byId(id);
      const w = toWorld(e.clientX, e.clientY);
      if (n) drag.current = { kind: 'node', id, ox: w.x - n.x, oy: w.y - n.y };
      setSelEdge(undefined);
      props.onSelect?.(id);
      return;
    }
    if (t.closest('[data-node]')) {
      setSelEdge(undefined);
      props.onSelect?.((t.closest('[data-node]') as HTMLElement).dataset.id);
      return;
    }
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    } else if (d.kind === 'node' && props.editable) {
      const w = toWorld(e.clientX, e.clientY);
      props.onMove?.(d.id, Math.round((w.x - d.ox) / 4) * 4, Math.round((w.y - d.oy) / 4) * 4);
    } else if (d.kind === 'link') {
      const w = toWorld(e.clientX, e.clientY);
      setPreview((p) => (p ? { ...p, x2: w.x, y2: w.y } : p));
    }
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = undefined;
    const root = el.current!;
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
    if (d?.kind === 'link') {
      setPreview(undefined);
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-port-in]') as HTMLElement | null;
      if (target?.dataset.id && target.dataset.id !== d.from) props.onConnect?.(d.from, target.dataset.id);
    } else if (d?.kind === 'pan' && !d.moved) {
      setSelEdge(undefined);
      props.onSelect?.(undefined);
    }
  }

  useEffect(() => {
    const node = el.current!;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = node.getBoundingClientRect();
      setView((v) => {
        const k = Math.min(2, Math.max(0.25, v.k * Math.exp(-e.deltaY * 0.0015)));
        const cx = e.clientX - r.left, cy = e.clientY - r.top;
        return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
      });
    }
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!props.editable || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
    const se = selEdge;
    if (se) {
      const [from, to] = se.split('→');
      props.onDeleteEdge?.(from!, to!);
      setSelEdge(undefined);
    } else if (props.selected) props.onDeleteNode?.(props.selected);
  }

  const zoom = (f: number) => {
    const r = el.current!.getBoundingClientRect();
    setView((v) => {
      const k = Math.min(2, Math.max(0.25, v.k * f));
      const cx = r.width / 2, cy = r.height / 2;
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });
  };

  return (
    <div
      className="canvas"
      ref={el}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      style={{ '--grid-x': `${view.x}px`, '--grid-y': `${view.y}px`, '--grid-size': `${24 * view.k}px` } as CSSProperties}
    >
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="edges" width="1" height="1" style={{ overflow: 'visible' }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="arrowhead" />
            </marker>
          </defs>
          {props.edges.map((e) => {
            const a = byId(e.from);
            const b = byId(e.to);
            const id = `${e.from}→${e.to}`;
            if (!a || !b) return null;
            const d = edgePath(a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2);
            const st = props.statuses?.[e.from]?.status;
            const to = props.statuses?.[e.to]?.status;
            // done solid, working animated, next dashed
            const edgeClass = cn('edge', {
              sel: selEdge === id,
              done: st === 'done' && !!to && to !== 'queued' && to !== 'running',
              flow: st === 'done' && to === 'running',
              next: st === 'done' && to === 'queued',
            });
            return (
              <g key={id}>
                <path d={d} className="edge-hit" data-edge={id} />
                <path d={d} className={edgeClass} markerEnd="url(#arrow)" />
              </g>
            );
          })}
          {/* fix loops: a dashed arc from a check back to the agent it sends failures to */}
          {props.nodes
            .filter((n) => n.fixNode && byId(n.fixNode))
            .map((n, i) => {
              const f = byId(n.fixNode!)!;
              // each arc dips a little deeper than the last so several loops never overlap
              const depth = 56 + i * 34;
              const x1 = n.x + NODE_W / 2, y1 = n.y + NODE_H, x2 = f.x + NODE_W / 2, y2 = f.y + NODE_H;
              const loops = props.statuses?.[n.id]?.loops ?? 0;
              return (
                <g className={cn('loop', { live: loops > 0 && props.statuses?.[n.fixNode!]?.status === 'running' })} key={n.id}>
                  <path d={`M ${x1} ${y1} C ${x1} ${y1 + depth}, ${x2} ${y2 + depth}, ${x2} ${y2}`} markerEnd="url(#arrow)" />
                  <text x={(x1 + x2) / 2} y={Math.max(y1, y2) + depth * 0.75 + 4} textAnchor="middle">
                    {props.statuses ? `fix loop ${loops}/${n.maxLoops ?? 2}` : `fix loop ≤${n.maxLoops ?? 2}`}
                  </text>
                </g>
              );
            })}
          {preview ? <path d={edgePath(preview.x1, preview.y1, preview.x2, preview.y2)} className="edge preview" /> : null}
        </svg>

        {props.nodes.map((n) => {
          const st = props.statuses?.[n.id];
          const mood = moodFor(st?.status);
          return (
            <div
              key={n.id}
              className={cn('node', props.nodeActions && 'nod-host', `s-${st?.status ?? 'idle'}`, `k-${n.kind}`, { selected: props.selected === n.id, issue: !!props.issueNodes?.has(n.id) })}
              data-node
              data-id={n.id}
              style={{ left: `${n.x}px`, top: `${n.y}px`, width: `${NODE_W}px`, height: `${NODE_H}px` }}
            >
              <div className="port in" data-port-in data-id={n.id} />
              <div className="node-head" data-node-head>
                <Face id={crewFor(n, crew)} mood={mood} size={22} animate={mood === 'working' || mood === 'waiting' ? 'always' : undefined} />
                <span className="node-title">{n.title ?? n.role ?? n.kind}</span>
                <span className="chip id">{n.id}</span>
              </div>
              <div className="node-body">
                {n.kind === 'agent' ? (
                  <>
                    <div className="meta">
                      <span className="chip agent" title={n.agent ? undefined : 'follows its bot; set in Crew'}>
                        {n.agent ?? `↳ ${crew[crewFor(n, crew)]?.name ?? 'bot'}`}
                      </span>
                      {n.model ? <span className="chip">{n.model}</span> : null}
                    </div>
                    <div className="flags">
                      {n.readOnly ? <span title="read-only: cannot modify files">ro</span> : null}
                      {n.includeDiff ? <span title="sees the diff">diff</span> : null}
                      {n.verdict ? <span title="must end with VERDICT: PASS|FAIL">verdict</span> : null}
                      {n.vault === false ? <span title="vault context off">no-kg</span> : null}
                    </div>
                  </>
                ) : null}
                {n.kind === 'gate' ? (
                  <div className="cmd" title={n.command}>
                    $ {n.command ?? '…'}
                  </div>
                ) : null}
                {n.kind === 'approval' ? <div className="cmd muted">human sign-off</div> : null}
                {st ? (
                  <div className="run-line">
                    <StatusBadge desc={stepDesc(n, st)} />
                    {st.attempts > 1 ? <span>×{st.attempts}</span> : null}
                    {st.costUsd > 0 ? <span>{fmtUsd(st.costUsd)}</span> : null}
                  </div>
                ) : null}
              </div>
              <div className="port out" data-port-out data-id={n.id} />
              {props.nodeActions ? <NodeActions actions={props.nodeActions(n.id)} tabbable={props.selected === n.id} label={`${n.title ?? n.role ?? n.kind} actions`} /> : null}
            </div>
          );
        })}
      </div>

      <div className="zoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1.2)}>
          <Plus size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}>
          <Minus size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Fit to view" onClick={fit}>
          <Maximize2 size={14} aria-hidden="true" />
        </button>
      </div>
      {props.hint && props.nodes.length ? <div className="canvas-hint">{props.hint}</div> : null}
      {props.nodes.length === 0 ? <div className="empty-hint">Add a step from the palette to start building a pipeline.</div> : null}
    </div>
  );
}
