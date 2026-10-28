import type { RunView } from '../api';
import { useReducedMotionPref } from '../components/Loading';
import { crewFor, useCrew } from '../crewStore';
import { Face, moodFor } from '../Face';
import { badgeFor, stepDesc } from '../ui/studio/status';
import { CARD_H, CARD_W, edgeState, layersOf, placeCards } from './graphModel';
import './graph.css';

/**
 * The run as crew cards in dependency layers, left to right (the demo's graph). Edges take the colour of their ends'
 * state and a live edge carries a moving dot (none under reduced motion). Wide runs scroll sideways. A card selects its step.
 */
export function RunGraph(p: { run: RunView; selected?: string; onSelect: (id: string) => void }) {
  const { crew } = useCrew();
  const reduced = useReducedMotionPref();
  const { nodes, edges } = p.run.pipeline;
  if (!nodes.length) return null;
  const { pos, width, height } = placeCards(layersOf(nodes, edges));
  // right middle of one card to the left middle of the next
  const curve = (from: string, to: string) => {
    const a = pos[from]!, b = pos[to]!;
    const x1 = a.x + CARD_W, y1 = a.y + CARD_H / 2, x2 = b.x, y2 = b.y + CARD_H / 2, mx = (x1 + x2) / 2;
    return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
  };
  return (
    <div className="rg">
      <div className="rg-inner" style={{ width, height }}>
        <svg className="rg-lines" aria-hidden="true">
          {edges
            .filter((e) => pos[e.from] && pos[e.to])
            .map((e) => {
              const st = edgeState(p.run.nodes[e.from]?.status, p.run.nodes[e.to]?.status);
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
        {nodes.map((n) => {
          const s = p.run.nodes[n.id];
          const look = badgeFor(stepDesc(n, s));
          const bot = crewFor(n, crew);
          const name = crew[bot]?.name ?? bot;
          const sub = n.kind === 'gate' ? (n.command ?? 'gate') : n.kind === 'approval' ? 'you approve' : `${n.role ?? 'agent'} · ${n.agent ?? 'claude'}`;
          return (
            <button
              key={n.id}
              type="button"
              className={`rg-card s-${look.state}`}
              data-id={n.id}
              aria-label={`${name}, ${look.label}`}
              aria-pressed={p.selected === n.id}
              style={{ left: pos[n.id]!.x, top: pos[n.id]!.y, width: CARD_W, height: CARD_H }}
              onClick={() => p.onSelect(n.id)}
            >
              <Face id={bot} size={26} mood={moodFor(s?.status)} animate={s?.status === 'running' ? 'always' : undefined} />
              <span className="rg-text">
                <span className="rg-name">{name}</span>
                <span className="rg-sub">{sub}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
