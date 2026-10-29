import { AnimatePresence } from 'motion/react';
import { useEffect, useState } from 'react';
import type { RunView, StoredEvent } from '../api';
import type { RunAct } from '../Runs';
import { dialogueCount, PlanningDialogue, TeamPanel } from '../Team';
import { Disclosure, QuietLine } from '../ui/studio/Section';
import { StepTodos } from '../ui/studio/StepTodos';
import { ApprovalBar } from './ApprovalBar';
import { LimitBar } from './LimitBar';
import { OutputLog } from './OutputLog';
import { PlanCard } from './PlanCard';
import { RunFiles } from './RunFiles';
import { RunGraph } from './RunGraph';
import { RunHeader } from './RunHeader';
import { RunNotices } from './RunNotices';
import { StepInspector } from './StepInspector';

export type InspectorTarget = { mode: 'step'; node: string } | { mode: 'run'; tab: 'changes' | 'timeline' };

/**
 * A run, full width (the demo's run screen): header, one-line notices, the graph, the team's questions and plan inline,
 * output and changed files side by side, planning and the team plan as collapsed rows, and the approval bar. The inspector
 * opens on a step (from a card, an output line or the route's node) or on the run (Run details, Review diff, ?pane=timeline).
 */
export function RunPage(p: { run: RunView; events: StoredEvent[]; streamError?: string; onRetryStream: () => void; onAct: RunAct; node?: string; pane?: 'timeline'; onSelectNode: (node?: string) => void; onBack: () => void; onOpenFile?: (file: string) => void }) {
  const r = p.run;
  const fromRoute = (): InspectorTarget | undefined => (p.node ? { mode: 'step', node: p.node } : p.pane ? { mode: 'run', tab: 'timeline' } : undefined);
  const [target, setTarget] = useState(fromRoute);
  // the route leads: a new node or pane opens it, and a route without them closes it
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setTarget(fromRoute()), [p.node, p.pane]);
  const openStep = (node: string) => {
    setTarget({ mode: 'step', node });
    p.onSelectNode(node);
  };
  const openRun = (tab: 'changes' | 'timeline') => setTarget({ mode: 'run', tab });
  const close = () => {
    setTarget(undefined);
    p.onSelectNode(undefined);
  };

  const hasNodes = r.pipeline.nodes.length > 0;
  const planning = r.kind === 'team' && !hasNodes && r.planning && !r.pending.length && (r.status === 'running' || r.status === 'paused');
  const steps = r.pipeline.nodes.map((n) => ({ id: n.id, title: n.title ?? n.role ?? n.kind, status: r.nodes[n.id]?.status ?? 'queued' }));
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const talk = dialogueCount(r);
  const teamPlan = r.kind === 'team' && hasNodes;

  return (
    <div className="run-view">
      <div className="run-page">
        <RunHeader run={r} onAct={p.onAct} onBack={p.onBack} onDetails={() => openRun('changes')} />
        <RunNotices run={r} streamError={p.streamError} onRetryStream={p.onRetryStream} />
        {/* the page says when Tether is planning; the card comes with the steps */}
        {hasNodes ? <PlanCard run={r} compact /> : null}
        <RunGraph run={r} selected={target?.mode === 'step' ? target.node : undefined} onSelect={openStep} onAct={p.onAct} onViewDiff={() => openRun('changes')} />
        {r.kind === 'team' ? <TeamPanel run={r} send={(path, body) => p.onAct(path, body)} /> : null}
        {planning ? <QuietLine>Tether is planning…</QuietLine> : null}
        {hasNodes ? (
          <div className="run-split">
            <OutputLog run={r} events={p.events} onPick={openStep} />
            <RunFiles run={r} onOpen={() => openRun('changes')} />
          </div>
        ) : null}
        {talk || teamPlan ? (
          <div className="run-disclosures">
            {talk ? (
              <Disclosure label="Planning" meta={`${talk} answer${talk === 1 ? '' : 's'}`} className="run-disclosure">
                <PlanningDialogue run={r} />
              </Disclosure>
            ) : null}
            {teamPlan ? (
              <Disclosure label="Team plan" meta={`${done} of ${steps.length}`} className="run-disclosure">
                <StepTodos steps={steps} title="Steps" className="run-todos" />
              </Disclosure>
            ) : null}
          </div>
        ) : null}
        <ApprovalBar run={r} onAct={p.onAct} onReviewDiff={() => openRun('changes')} />
        <LimitBar run={r} onAct={p.onAct} />
      </div>
      <AnimatePresence>
        {target ? (
          <StepInspector
            key="insp"
            run={r}
            events={p.events}
            target={target}
            onTarget={(t) => (t.mode === 'step' ? openStep(t.node) : setTarget(t))}
            onClose={close}
            onAct={p.onAct}
            onOpenFile={p.onOpenFile}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
