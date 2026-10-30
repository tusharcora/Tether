import { FileDiff, FileText, Pause, Play, RotateCcw } from 'lucide-react';
import type { RunView } from '../api';
import { NodeActions } from '../components/bencho/ActionNode';
import { useReducedMotionPref } from '../components/Loading';
import { crewFor, useCrew } from '../crewStore';
import { Face, moodFor } from '../Face';
import type { RunAct } from '../Runs';
import { badgeFor, stepDesc } from '../ui/studio/status';
import { CARD_H, CARD_W, edgeState, layersOf, placeCards } from './graphModel';
import './graph.css';

const YOU = '__you';

/**
 * The run as crew cards in dependency layers, left to right (the demo's graph). Edges take the colour of their ends'
 * state and a live edge carries a moving dot (none under reduced motion). Wide runs scroll sideways. A card selects its step.
 */
export function RunGraph(p: {
  run: RunView;
  selected?: string;
  onSelect: (id: string) => void;
  /** Gives each card its fan: Open logs, Retry from here, View diff, Pause or Resume. */ onAct?: RunAct;
  onViewDiff?: () => void;
  /** The person who asked, drawn as a first card ("You" and this line, e.g. "asked 14:02") leading into the first steps. */
  you?: string;
  /** Scale (the team room's − / + / Fit). */
  zoom?: number;
}) {
  const runLive = p.run.live && p.run.status === 'running';
  const { crew } = useCrew();
  const reduced = useReducedMotionPref();
  const { nodes } = p.run.pipeline;
  if (!nodes.length) return null;
  const roots = nodes.filter((n) => !p.run.pipeline.edges.some((e) => e.to === n.id)).map((n) => n.id);
  const edges = p.you ? [...roots.map((to) => ({ from: YOU, to })), ...p.run.pipeline.edges] : p.run.pipeline.edges;
  const { pos, width, height } = placeCards(layersOf(p.you ? [{ id: YOU }, ...nodes] : nodes, edges));
  const z = p.zoom ?? 1;
  // right middle of one card to the left middle of the next
  const curve = (from: string, to: string) => {
    const a = pos[from]!, b = pos[to]!;
    const x1 = a.x + CARD_W, y1 = a.y + CARD_H / 2, x2 = b.x, y2 = b.y + CARD_H / 2, mx = (x1 + x2) / 2;
    return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
  };
  return (
    <div className="rg">
      <div className="rg-inner" style={{ width: width * z, height: height * z }}>
       <div className="rg-scale" style={{ width, height, ...(z !== 1 ? { transform: `scale(${z})` } : {}) }}>
        <svg className="rg-lines" aria-hidden="true">
          {edges
            .filter((e) => pos[e.from] && pos[e.to])
            .map((e) => {
              const st = edgeState(e.from === YOU ? 'done' : p.run.nodes[e.from]?.status, p.run.nodes[e.to]?.status);
              const d = curve(e.from, e.to);
              return (
                <g key={`${e.from}→${e.to}`}>
                  <path className={`rg-edge e-${st}`} d={d} />
                  {st === 'live' && !reduced ? (
                    <circle className="rg-dot" r="3">
                      <animateMotion dur="1.6s" repeatCount="indefinite" path={d} />
                    </circle>
                  ) : null}
                </g>
              );
            })}
        </svg>
        {p.you ? (
          <div className="rg-node" style={{ left: pos[YOU]!.x, top: pos[YOU]!.y, width: CARD_W, height: CARD_H }}>
            <div className="rg-card rg-you">
              <span className="rg-you-mark" aria-hidden="true">✓</span>
              <span className="rg-text">
                <span className="rg-name">You</span>
                <span className="rg-sub">{p.you}</span>
              </span>
            </div>
          </div>
        ) : null}
        {nodes.map((n) => {
          const s = p.run.nodes[n.id];
          const look = badgeFor(stepDesc(n, s));
          const bot = crewFor(n, crew);
          const name = crew[bot]?.name ?? bot;
          const sub = n.kind === 'gate' ? (n.command ?? 'gate') : n.kind === 'approval' ? 'you approve' : `${n.role ?? 'agent'} · ${n.agent ?? 'claude'}`;
          return (
            <div key={n.id} className="rg-node nod-host" style={{ left: pos[n.id]!.x, top: pos[n.id]!.y, width: CARD_W, height: CARD_H }}>
              <button type="button" className={`rg-card s-${look.state}`} data-id={n.id} aria-label={`${name}, ${look.label}`} aria-pressed={p.selected === n.id} onClick={() => p.onSelect(n.id)}>
                <Face id={bot} size={26} mood={moodFor(s?.status)} animate={s?.status === 'running' ? 'always' : undefined} />
                <span className="rg-text">
                  <span className="rg-name">{name}</span>
                  <span className="rg-sub">{sub}</span>
                </span>
              </button>
              {p.onAct ? (
                <NodeActions
                  corner={10}
                  tabbable={p.selected === n.id}
                  label={`${name} actions`}
                  actions={[
                    { id: 'logs', label: 'Open logs', icon: <FileText />, onSelect: () => p.onSelect(n.id) },
                    { id: 'retry', label: 'Retry from here', icon: <RotateCcw />, onSelect: () => void p.onAct!('resume', { retryFailed: true }), disabled: s?.status !== 'error' || runLive },
                    { id: 'diff', label: 'View diff', icon: <FileDiff />, onSelect: () => p.onViewDiff?.() },
                    runLive ? { id: 'pause', label: 'Pause run', icon: <Pause />, onSelect: () => void p.onAct!('stop') } : { id: 'resume', label: 'Resume run', icon: <Play />, onSelect: () => void p.onAct!('resume'), disabled: p.run.status === 'done' },
                  ]}
                />
              ) : null}
            </div>
          );
        })}
       </div>
      </div>
    </div>
  );
}
