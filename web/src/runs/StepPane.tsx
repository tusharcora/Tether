import type { ReactNode } from 'react';
import { fmtDur, fmtUsd, type RunView } from '../api';
import { Button } from '../components/beui/kit/Button';
import { ToolResult, ToolResultOutput } from '../components/beui/agents/tool-result';
import { Input } from '../components/beui/kit/fields';
import { crewFor, useCrew } from '../crewStore';
import { Face, moodFor } from '../Face';
import type { RunAct } from '../Runs';
import { StatusChip, toneFor } from '../ui/studio/StatusChip';

/**
 * The selected step: its bot's face and name, status, why Tether picked it (team runs), live output with a caret while
 * it runs, gate results, output, the diff it committed (`diff`: the Inspector's loaded diff, error or skeleton) and feedback.
 */
export function StepPane(p: { run: RunView; nodeId: string; diff?: ReactNode; note: string; onNote: (t: string) => void; onAct: RunAct }) {
  const { crew } = useCrew();
  const r = p.run;
  const node = r.nodes[p.nodeId];
  const pnode = r.pipeline.nodes.find((n) => n.id === p.nodeId);
  if (!node || !pnode)
    return (
      <p className="sl-note" role="note">
        This step is not in this run. Click a step in the graph to see its output, diff and gate results.
      </p>
    );
  const bot = crewFor(pnode, crew);
  const running = node.status === 'running';
  // "why Tether picked it" is the plan assignment's reason, team runs only
  const why = r.kind === 'team' ? r.plan?.assignments.find((a) => a.bot === pnode.role)?.why : undefined;
  async function feedback(rating: 'up' | 'down') {
    const note = p.note.trim();
    if (await p.onAct('feedback', { node: p.nodeId, rating, ...(note ? { note } : {}) })) p.onNote('');
  }

  return (
    <div className="node-detail">
      <div className="step-head">
        <Face id={bot} size={32} mood={moodFor(node.status)} animate={running ? 'always' : undefined} />
        <div className="step-head-main">
          <h4>
            {crew[bot]?.name ?? bot} · {pnode.title ?? pnode.role ?? pnode.kind} <span className="sl-meta">{p.nodeId}</span>
          </h4>
          <StatusChip tone={toneFor(node.status)} label={node.status} pulse={running} />
        </div>
      </div>
      <p className="sl-meta">
        {node.attempts} attempt{node.attempts === 1 ? '' : 's'}
        {node.loops ? ` · ${node.loops} fix loop${node.loops === 1 ? '' : 's'}` : ''}
        {node.costUsd ? ` · ${fmtUsd(node.costUsd)}` : ''}
        {node.startedAt && node.finishedAt ? ` · ${fmtDur(node.finishedAt - node.startedAt)}` : ''}
        {node.verdict ? ` · VERDICT ${node.verdict}` : ''}
        {node.commit ? ` · commit ${node.commit.slice(0, 7)}` : ''}
      </p>
      {why ? (
        <p className="step-why">
          <span className="sl-meta">Why Tether picked it</span> <span>{why}</span>
        </p>
      ) : null}
      {node.error ? <div className="alert error">{node.error}</div> : null}
      {node.live ? (
        <ToolResult tool="agent output" kind="terminal" title="Live output" status={running ? 'running' : 'success'} collapseOnComplete={false} maxHeight={320} contentClassName="live-out" copyText={node.live}>
          <ToolResultOutput language="text">{node.live}</ToolResultOutput>
          {running ? <span className="caret" aria-hidden="true" /> : null}
        </ToolResult>
      ) : null}
      {pnode.kind === 'gate' && node.gate ? (
        <ToolResult tool={pnode.command ?? 'gate'} kind="terminal" title="Gate" meta={node.gate.ok ? 'passed' : `failed (exit ${node.gate.exitCode})`} status={node.gate.ok ? 'success' : 'error'} collapseOnComplete={false} maxHeight={320} copyText={node.gate.output}>
          <ToolResultOutput language="text">{node.gate.output || '(no output)'}</ToolResultOutput>
        </ToolResult>
      ) : null}
      {node.output && pnode.kind === 'agent' ? (
        <ToolResult tool="agent output" kind="terminal" title="Output" status={node.status === 'error' ? 'error' : 'success'} collapseOnComplete={false} maxHeight={320} copyText={node.output}>
          <ToolResultOutput language="text">{node.output}</ToolResultOutput>
        </ToolResult>
      ) : null}
      {node.commit && p.diff ? (
        <>
          <h5>Changes this step committed</h5>
          {p.diff}
        </>
      ) : null}
      {pnode.kind === 'agent' && !pnode.readOnly && node.status === 'done' && !node.commit ? <p className="sl-meta">This step finished without changing any files.</p> : null}
      {pnode.kind === 'agent' && (node.status === 'done' || node.status === 'error') && !r.probe ? (
        <div className="row feedback" title="Evolve learns from this: a note says why">
          <span className="sl-meta">Was this step good?{node.feedback ? ` You said ${node.feedback.rating === 'up' ? 'good' : 'bad'}.` : ''}</span>
          <Input label="Why (optional)" maxLength={500} value={p.note} onChange={(e) => p.onNote(e.target.value)} />
          <Button variant="secondary" size="sm" onClick={() => void feedback('up')}>
            Good
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void feedback('down')}>
            Bad
          </Button>
        </div>
      ) : null}
    </div>
  );
}
