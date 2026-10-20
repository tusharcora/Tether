import { For, Index, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { CREW, crewFor } from './bots';
import type { Edge, NodeState, PipelineNode } from '../../src/types';
import { fmtUsd } from './api';

export const NODE_W = 212;
export const NODE_H = 92;

export interface CanvasProps {
  nodes: PipelineNode[];
  edges: Edge[];
  selected?: string;
  statuses?: Record<string, NodeState>;
  issueNodes?: Set<string>;
  editable?: boolean;
  onSelect?: (id?: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onConnect?: (from: string, to: string) => void;
  onDeleteEdge?: (from: string, to: string) => void;
  onDeleteNode?: (id: string) => void;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'node'; id: string; ox: number; oy: number }
  | { kind: 'link'; from: string };

const GLYPH: Record<string, string> = { agent: '◆', gate: '⛨', approval: '⏸' };
const ROLE_GLYPH: Record<string, string> = { planner: '✎', architect: '▦', coder: '⌘', reviewer: '⚖', tester: '✓' };

const edgePath = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = Math.max(48, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
};

export function Canvas(props: CanvasProps) {
  let el!: HTMLDivElement;
  const [view, setView] = createSignal({ x: 40, y: 40, k: 1 });
  const [preview, setPreview] = createSignal<{ x1: number; y1: number; x2: number; y2: number } | undefined>();
  const [selEdge, setSelEdge] = createSignal<string | undefined>();
  let drag: Drag | undefined;

  const byId = (id: string) => props.nodes.find((n) => n.id === id);
  const toWorld = (cx: number, cy: number) => {
    const r = el.getBoundingClientRect();
    const v = view();
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  };

  function fit() {
    if (!props.nodes.length || !el) return;
    const xs = props.nodes.map((n) => n.x);
    const ys = props.nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs) + NODE_W, minY = Math.min(...ys), maxY = Math.max(...ys) + NODE_H;
    const r = el.getBoundingClientRect();
    const k = Math.min(1.2, Math.max(0.3, Math.min((r.width - 80) / (maxX - minX), (r.height - 80) / (maxY - minY + 60))));
    setView({ k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: (r.height - (maxY - minY) * k) / 2 - minY * k });
  }
  onMount(() => requestAnimationFrame(fit));

  function onPointerDown(e: PointerEvent) {
    const t = e.target as HTMLElement;
    el.focus({ preventScroll: true });
    const out = t.closest('[data-port-out]') as HTMLElement | null;
    const head = t.closest('[data-node-head]') as HTMLElement | null;
    const edge = t.closest('[data-edge]') as SVGElement | null;
    if (edge) {
      setSelEdge(edge.getAttribute('data-edge') ?? undefined);
      props.onSelect?.(undefined);
      return;
    }
    el.setPointerCapture(e.pointerId);
    if (out && props.editable) {
      drag = { kind: 'link', from: out.dataset.id! };
      const n = byId(out.dataset.id!);
      if (n) setPreview({ x1: n.x + NODE_W, y1: n.y + NODE_H / 2, x2: n.x + NODE_W, y2: n.y + NODE_H / 2 });
      return;
    }
    if (head) {
      const id = (head.closest('[data-node]') as HTMLElement).dataset.id!;
      const n = byId(id);
      const w = toWorld(e.clientX, e.clientY);
      if (n) drag = { kind: 'node', id, ox: w.x - n.x, oy: w.y - n.y };
      setSelEdge(undefined);
      props.onSelect?.(id);
      return;
    }
    if (t.closest('[data-node]')) {
      setSelEdge(undefined);
      props.onSelect?.((t.closest('[data-node]') as HTMLElement).dataset.id);
      return;
    }
    const v = view();
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false };
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      setView({ ...view(), x: drag.vx + dx, y: drag.vy + dy });
    } else if (drag.kind === 'node' && props.editable) {
      const w = toWorld(e.clientX, e.clientY);
      props.onMove?.(drag.id, Math.round((w.x - drag.ox) / 4) * 4, Math.round((w.y - drag.oy) / 4) * 4);
    } else if (drag.kind === 'link') {
      const w = toWorld(e.clientX, e.clientY);
      const p = preview();
      if (p) setPreview({ ...p, x2: w.x, y2: w.y });
    }
  }

  function onPointerUp(e: PointerEvent) {
    const d = drag;
    drag = undefined;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (d?.kind === 'link') {
      setPreview(undefined);
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-port-in]') as HTMLElement | null;
      if (target?.dataset.id && target.dataset.id !== d.from) props.onConnect?.(d.from, target.dataset.id);
    } else if (d?.kind === 'pan' && !d.moved) {
      setSelEdge(undefined);
      props.onSelect?.(undefined);
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const v = view();
    const r = el.getBoundingClientRect();
    const k = Math.min(2, Math.max(0.25, v.k * Math.exp(-e.deltaY * 0.0015)));
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    setView({ k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!props.editable || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
    const se = selEdge();
    if (se) {
      const [from, to] = se.split('→');
      props.onDeleteEdge?.(from!, to!);
      setSelEdge(undefined);
    } else if (props.selected) props.onDeleteNode?.(props.selected);
  }

  onMount(() => el.addEventListener('wheel', onWheel, { passive: false }));
  onCleanup(() => el.removeEventListener('wheel', onWheel));

  const zoom = (f: number) => {
    const v = view();
    const r = el.getBoundingClientRect();
    const k = Math.min(2, Math.max(0.25, v.k * f));
    const cx = r.width / 2, cy = r.height / 2;
    setView({ k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k });
  };

  return (
    <div
      class="canvas"
      ref={el}
      tabindex="0"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      style={{
        'background-position': `${view().x}px ${view().y}px`,
        'background-size': `${24 * view().k}px ${24 * view().k}px`,
      }}
    >
      <div class="world" style={{ transform: `translate(${view().x}px, ${view().y}px) scale(${view().k})` }}>
        <svg class="edges" width="1" height="1" style={{ overflow: 'visible' }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" class="arrowhead" />
            </marker>
          </defs>
          <Index each={props.edges}>
            {(e) => {
              const a = () => byId(e().from);
              const b = () => byId(e().to);
              const id = () => `${e().from}→${e().to}`;
              const d = () => (a() && b() ? edgePath(a()!.x + NODE_W, a()!.y + NODE_H / 2, b()!.x, b()!.y + NODE_H / 2) : '');
              const st = () => props.statuses?.[e().from]?.status;
              return (
                <Show when={a() && b()}>
                  <g>
                    <path d={d()} class="edge-hit" data-edge={id()} />
                    <path
                      d={d()}
                      class="edge"
                      classList={{ sel: selEdge() === id(), flow: st() === 'done' && props.statuses?.[e().to]?.status === 'running' }}
                      marker-end="url(#arrow)"
                    />
                  </g>
                </Show>
              );
            }}
          </Index>
          {/* fix loops: a dashed arc from a check back to the agent it sends failures to */}
          <For each={props.nodes.filter((n) => n.fixNode && byId(n.fixNode))}>
            {(n, i) => {
              const f = () => byId(n.fixNode!)!;
              // each arc dips a little deeper than the last so several loops never overlap
              const depth = () => 56 + i() * 34;
              const x1 = () => n.x + NODE_W / 2, y1 = () => n.y + NODE_H, x2 = () => f().x + NODE_W / 2, y2 = () => f().y + NODE_H;
              const loops = () => props.statuses?.[n.id]?.loops ?? 0;
              return (
                <g class="loop">
                  <path d={`M ${x1()} ${y1()} C ${x1()} ${y1() + depth()}, ${x2()} ${y2() + depth()}, ${x2()} ${y2()}`} marker-end="url(#arrow)" />
                  <text x={(x1() + x2()) / 2} y={Math.max(y1(), y2()) + depth() * 0.75 + 4} text-anchor="middle">
                    {props.statuses ? `fix loop ${loops()}/${n.maxLoops ?? 2}` : `fix loop ≤${n.maxLoops ?? 2}`}
                  </text>
                </g>
              );
            }}
          </For>
          <Show when={preview()}>
            {(p) => <path d={edgePath(p().x1, p().y1, p().x2, p().y2)} class="edge preview" />}
          </Show>
        </svg>

        <Index each={props.nodes}>
          {(n) => {
            const st = () => props.statuses?.[n().id];
            return (
              <div
                class="node"
                classList={{
                  selected: props.selected === n().id,
                  issue: !!props.issueNodes?.has(n().id),
                  [`s-${st()?.status ?? 'idle'}`]: true,
                  [`k-${n().kind}`]: true,
                }}
                data-node
                data-id={n().id}
                style={{ left: `${n().x}px`, top: `${n().y}px`, width: `${NODE_W}px`, height: `${NODE_H}px` }}
              >
                <div class="port in" data-port-in data-id={n().id} />
                <div class="node-head" data-node-head>
                  <span class="glyph">{n().kind === 'agent' ? (ROLE_GLYPH[n().role ?? ''] ?? GLYPH.agent) : GLYPH[n().kind]}</span>
                  <span class="node-title">{n().title ?? n().role ?? n().kind}</span>
                  <span class="chip id">{n().id}</span>
                </div>
                <div class="node-body">
                  <Show when={n().kind === 'agent'}>
                    <div class="meta">
                      <span class="chip agent" title={n().agent ? undefined : 'follows its bot; set in Crew'}>{n().agent ?? `↳ ${CREW[crewFor(n())]?.name ?? 'bot'}`}</span>
                      <Show when={n().model}>
                        <span class="chip">{n().model}</span>
                      </Show>
                    </div>
                    <div class="flags">
                      <Show when={n().readOnly}><span title="read-only: cannot modify files">ro</span></Show>
                      <Show when={n().includeDiff}><span title="sees the diff">diff</span></Show>
                      <Show when={n().verdict}><span title="must end with VERDICT: PASS|FAIL">verdict</span></Show>
                      <Show when={n().vault === false}><span title="vault context off">no-kg</span></Show>
                    </div>
                  </Show>
                  <Show when={n().kind === 'gate'}>
                    <div class="cmd" title={n().command}>$ {n().command ?? '…'}</div>
                  </Show>
                  <Show when={n().kind === 'approval'}>
                    <div class="cmd muted">human sign-off</div>
                  </Show>
                  <Show when={st()}>
                    <div class="run-line">
                      <span class="status-pill">{st()!.status}</span>
                      <Show when={st()!.attempts > 1}><span>×{st()!.attempts}</span></Show>
                      <Show when={st()!.costUsd > 0}><span>{fmtUsd(st()!.costUsd)}</span></Show>
                    </div>
                  </Show>
                </div>
                <div class="port out" data-port-out data-id={n().id} />
              </div>
            );
          }}
        </Index>
      </div>

      <div class="zoom">
        <button onClick={() => zoom(1.2)} title="zoom in">+</button>
        <button onClick={() => zoom(1 / 1.2)} title="zoom out">−</button>
        <button onClick={fit} title="fit to view">⤢</button>
      </div>
      <Show when={props.nodes.length === 0}>
        <div class="empty-hint">Add a step from the palette to start building a pipeline.</div>
      </Show>
    </div>
  );
}
