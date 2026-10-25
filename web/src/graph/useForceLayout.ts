import { useEffect, useRef, useState } from 'react';
import { createSim, kick, pin, positions, reheat, release as unpin, REST, setHidden, settle, tick, type Sim } from './forceSim';

/** Above this many notes the layout is computed to rest up front, as under reduced motion. */
export const LIVE_MAX = 1500;

export interface ForceLayout {
  /** Bumps when the simulation is rebuilt for a new graph; React renders positions from `position`. */
  version: number;
  running: boolean;
  position: (id: string) => { x: number; y: number } | undefined;
  /** Positions of the visible notes. */
  points: () => { x: number; y: number }[];
  drag: (id: string, x: number, y: number) => void;
  release: (id: string) => void;
  rerun: () => void;
}

type GraphLike = { nodes: { id: string }[]; edges: { from: string; to: string }[] };
type Options = { reduced: boolean; paint?: (s: Sim) => void; onSettled?: () => void; raf?: (cb: FrameRequestCallback) => number; caf?: (h: number) => void; liveMax?: number };
const keyOf = (s: ReadonlySet<string>) => [...s].sort().join('\n');

/**
 * Runs the force layout: one requestAnimationFrame loop while notes move, stopped at rest. `paint` gets every tick so
 * the board can move SVG nodes without a React render per frame.
 */
export function useForceLayout(graph: GraphLike | undefined, hidden: ReadonlySet<string>, o: Options): ForceLayout {
  const sim = useRef<Sim | undefined>(undefined);
  const frame = useRef<number | null>(null);
  const seed = useRef(1);
  const applied = useRef('');
  const opts = useRef(o);
  opts.current = o;
  const instantRef = useRef(false);
  instantRef.current = o.reduced || (graph?.nodes.length ?? 0) > (o.liveMax ?? LIVE_MAX);
  const [version, setVersion] = useState(0);
  const [running, setRunning] = useState(false);

  const raf = (cb: FrameRequestCallback) => (opts.current.raf ?? requestAnimationFrame)(cb);
  const caf = (h: number) => (opts.current.caf ?? cancelAnimationFrame)(h);
  const stop = () => {
    if (frame.current !== null) caf(frame.current);
    frame.current = null;
  };
  const step = () => {
    frame.current = null;
    const s = sim.current;
    if (!s) return;
    tick(s);
    opts.current.paint?.(s);
    if (s.energy < REST && !s.nodes.some((n) => n.fixed)) {
      setRunning(false);
      opts.current.onSettled?.();
      return;
    }
    frame.current = raf(step);
  };
  const wake = () => {
    const s = sim.current;
    if (!s) return;
    if (instantRef.current) {
      if (!s.nodes.some((n) => n.fixed)) settle(s);
      opts.current.paint?.(s);
      return;
    }
    if (frame.current === null) {
      setRunning(true);
      frame.current = raf(step);
    }
  };

  useEffect(() => {
    if (!graph) return;
    stop();
    const s = createSim(graph.nodes, graph.edges, sim.current ? positions(sim.current) : undefined);
    setHidden(s, hidden);
    applied.current = keyOf(hidden);
    sim.current = s;
    setVersion((v) => v + 1);
    if (instantRef.current) {
      settle(s);
      opts.current.paint?.(s);
      setRunning(false);
      opts.current.onSettled?.();
    } else {
      opts.current.paint?.(s);
      wake();
    }
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const s = sim.current;
    const k = keyOf(hidden);
    if (!s || k === applied.current) return;
    applied.current = k;
    setHidden(s, hidden);
    reheat(s, 0.5);
    wake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  return {
    version,
    running,
    position: (id) => {
      const s = sim.current;
      const n = s?.nodes[s.index.get(id) ?? -1];
      return n ? { x: n.x, y: n.y } : undefined;
    },
    points: () => (sim.current?.nodes ?? []).filter((n) => !n.hidden).map((n) => ({ x: n.x, y: n.y })),
    drag: (id, x, y) => {
      const s = sim.current;
      if (!s) return;
      pin(s, id, x, y);
      if (instantRef.current) opts.current.paint?.(s);
      else wake();
    },
    release: (id) => {
      const s = sim.current;
      if (!s) return;
      unpin(s, id);
      wake();
    },
    rerun: () => {
      const s = sim.current;
      if (!s) return;
      kick(s, ++seed.current);
      wake();
    },
  };
}
