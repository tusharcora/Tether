import { FileDiff, FileText, Pause, Play, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { fmtUsd, type RunView } from '../api';
import { ActionNode, type NodeTone } from '../components/bencho/ActionNode';
import { Button } from '../components/beui/kit/Button';
import { crewFor, useCrew } from '../crewStore';
import { Face, moodFor } from '../Face';
import { DiffDialog } from '../goals/Goals';
import type { RunAct } from '../Runs';
import './runflow.css';

const W = 300;
const H = 76;
const GAP_X = 72;
const GAP_Y = 36;

/** Columns by the longest path from a start (left to right), rows by order within a column. */
export function layout(nodes: { id: string }[], edges: { from: string; to: string }[]): Record<string, { x: number; y: number }> {
  const col: Record<string, number> = {};
  const depth = (id: string, seen: string[] = []): number => {
    if (col[id] !== undefined) return col[id]!;
    if (seen.includes(id)) return 0;
    const up = edges.filter((e) => e.to === id).map((e) => depth(e.from, [...seen, id]));
    return (col[id] = up.length ? Math.max(...up) + 1 : 0);
  };
  const rows: Record<number, number> = {};
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const c = depth(n.id);
    const r = (rows[c] = (rows[c] ?? -1) + 1);
    out[n.id] = { x: c * (W + GAP_X), y: r * (H + 64 + GAP_Y) };
  }
  return out;
}

const toneOf = (s?: string): NodeTone => (s === 'running' ? 'live' : s === 'awaiting' ? 'needs' : s === 'done' ? 'done' : s === 'error' ? 'failed' : 'idle');

/**
 * An expanded run: its steps as a left-to-right flow of compact action nodes on the dot grid. A node shows the bot's face with a
 * status dot and the live line; the fan holds Open logs, Retry from here, View diff and Pause or Resume (the run's own actions);
 * a human gate shows Approve and Reject in plain view; fix loops are amber dashed curves; a node opens its step log in the
 * Inspector. Collapsed runs never draw this: they stay rows.
 */
export function RunFlow({ run: r, selected, onSelect, onAct }: { run: RunView; selected?: string; onSelect: (id?: string) => void; onAct: RunAct }) {
  const { crew } = useCrew();
  const [diff, setDiff] = useState(false);
  const pos = layout(r.pipeline.nodes, r.pipeline.edges);
  const width = Math.max(0, ...Object.values(pos).map((p) => p.x)) + W;
  const height = Math.max(0, ...Object.values(pos).map((p) => p.y)) + H + 64 + 70;
  const runLive = r.live && r.status === 'running';
  return (
    <div className="rf" role="group" aria-label="Run flow">
      <div className="rf-world" style={{ width, height }}>
        <svg className="rf-edges" width={width} height={height} aria-hidden="true">
          {r.pipeline.edges.map((e) => {
            const a = pos[e.from];
            const b = pos[e.to];
            if (!a || !b) return null;
            const x1 = a.x + W, y1 = a.y + 40, x2 = b.x, y2 = b.y + 40, dx = (x2 - x1) / 2;
            return <path key={`${e.from}-${e.to}`} className={r.nodes[e.from]?.status === 'done' ? 'rf-edge done' : 'rf-edge'} d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`} />;
          })}
          {r.pipeline.nodes.filter((n) => n.kind === 'gate' && n.fixNode && pos[n.fixNode]).map((n, i) => {
            const a = pos[n.id]!, f = pos[n.fixNode!]!, depth = 56 + i * 30;
            const x1 = a.x + W / 2, y1 = a.y + 80, x2 = f.x + W / 2, y2 = f.y + 80;
            return <path key={`fix-${n.id}`} className={r.nodes[n.id]?.loops ? 'rf-loop live' : 'rf-loop'} d={`M ${x1} ${y1} C ${x1} ${y1 + depth}, ${x2} ${y2 + depth}, ${x2} ${y2}`} />;
          })}
        </svg>
        {r.pipeline.nodes.map((n) => {
          const st = r.nodes[n.id];
          const mood = moodFor(st?.status);
          const title = n.title ?? n.role ?? n.kind;
          const waiting = n.kind === 'approval' && st?.status === 'awaiting';
          return (
            <div key={n.id} className="rf-node" data-id={n.id} style={{ left: pos[n.id]!.x, top: pos[n.id]!.y, width: W }} data-selected={selected === n.id || undefined}>
              <ActionNode
                compact
                tabbable={selected === n.id}
                label={`${title} actions`}
                className={selected === n.id ? 'rf-sel' : undefined}
                mark={<Face id={crewFor(n, crew)} mood={mood} size={30} animate={mood === 'working' || mood === 'waiting' ? 'always' : undefined} />}
                title={
                  <button type="button" className="rf-open" onClick={() => onSelect(n.id)} aria-label={`${title}, ${st?.status ?? 'queued'}. Open its log`}>
                    {title}
                  </button>
                }
                line={st?.live?.trim().split('\n').at(-1) || `${st?.status ?? 'queued'}${st && st.costUsd > 0 ? ` · ${fmtUsd(st.costUsd)}` : ''}${st && st.attempts > 1 ? ` · ×${st.attempts}` : ''}`}
                tone={toneOf(st?.status)}
                toneLabel={st?.status ?? 'queued'}
                actions={[
                  { id: 'logs', label: 'Open logs', icon: <FileText />, onSelect: () => onSelect(n.id) },
                  { id: 'retry', label: 'Retry from here', icon: <RotateCcw />, onSelect: () => void onAct('resume', { retryFailed: true }), disabled: st?.status !== 'error' || runLive },
                  { id: 'diff', label: 'View diff', icon: <FileDiff />, onSelect: () => setDiff(true) },
                  runLive ? { id: 'pause', label: 'Pause run', icon: <Pause />, onSelect: () => void onAct('stop') } : { id: 'resume', label: 'Resume run', icon: <Play />, onSelect: () => void onAct('resume'), disabled: r.status === 'done' },
                ]}
              >
                {waiting ? (
                  <div className="gf-buttons">
                    <Button size="sm" variant="primary" onClick={() => void onAct('approve', { node: n.id, approved: true })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void onAct('approve', { node: n.id, approved: false })}>
                      Reject
                    </Button>
                  </div>
                ) : null}
              </ActionNode>
            </div>
          );
        })}
      </div>
      <DiffDialog run={diff ? r.id : undefined} onClose={() => setDiff(false)} />
    </div>
  );
}
