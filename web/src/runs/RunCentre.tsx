import type { RunView } from '../api';
import { Canvas } from '../Canvas';
import type { RunAct } from '../Runs';
import { TeamPanel } from '../Team';
import { StepTrack } from '../ui/studio/StepTrack';

/** Team runs before approval: the Team panel in place of the graph. Otherwise the step track above the plan graph. */
export function RunCentre({ run: r, selected, onSelect, onAct }: { run: RunView; selected?: string; onSelect: (id?: string) => void; onAct: RunAct }) {
  const beforeApproval = r.kind === 'team' && r.pipeline.nodes.length === 0;
  const planning = beforeApproval && r.planning && !r.pending.length && (r.status === 'running' || r.status === 'paused');
  const steps = r.pipeline.nodes.map((n) => ({ id: n.id, title: n.title ?? n.role ?? n.kind, status: r.nodes[n.id]?.status ?? 'queued' }));
  return (
    <div className="run-centre">
      {r.kind === 'team' ? (
        <div className="run-team">
          <TeamPanel run={r} send={(path, body) => onAct(path, body)} />
        </div>
      ) : null}
      {planning ? (
        <div className="run-planning">
          <StepTrack steps={[]} planning />
          <p className="sl-meta">Tether is planning…</p>
        </div>
      ) : null}
      {beforeApproval ? null : (
        <>
          <StepTrack steps={steps} className="run-steptrack" />
          <div className="run-graph">
            <Canvas nodes={r.pipeline.nodes} edges={r.pipeline.edges} statuses={r.nodes} selected={selected} onSelect={onSelect} />
          </div>
        </>
      )}
    </div>
  );
}
