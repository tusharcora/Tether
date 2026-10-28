import { Copy, ExternalLink, FileDiff, FlaskConical, Pencil, Play, RotateCcw, Settings } from 'lucide-react';
import { useState } from 'react';
import { ago, fmtUsd } from '../api';
import { ToolResult, ToolResultOutput } from '../components/beui/agents/tool-result';
import { Button } from '../components/beui/kit/Button';
import { ActionNode, type NodeTone } from '../components/bencho/ActionNode';
import type { GoalView } from './goalsApi';
import './goals.css';

/** What the person can do from the flow; Goals.tsx wires each to the server. */
export interface LoopActions {
  runCheck: () => void;
  saveCommand: (command: string) => void;
  settings: () => void;
  openRun: (id: string) => void;
  retry: (id: string) => void;
  diff: (id: string) => void;
  start: (plan: string) => void;
  skip: () => void;
  duplicate: () => void;
}

const attemptTone = (finished: boolean, ok: boolean | undefined): NodeTone => (!finished ? 'live' : ok ? 'done' : 'failed');

/**
 * A loop as a vertical chain of action nodes on the dot grid: the finish check, one node per attempt (check before to after,
 * and what it cost), then the next run: dashed, with its Start, Edit plan and Skip in plain view because it is an approval.
 * Fans hold only the secondary actions and never delete.
 */
export function LoopFlow({ goal: g, checking, act }: { goal: GoalView; checking: boolean; act: LoopActions }) {
  const [editCmd, setEditCmd] = useState<string>();
  const [editPlan, setEditPlan] = useState<string>();
  const runs = g.items.filter((i) => i.kind === 'run');
  const last = g.lastCheck;
  const checkTone: NodeTone = checking ? 'live' : last ? (last.ok ? 'done' : 'failed') : 'idle';
  const inflight = runs.some((i) => !i.attempt?.after);
  const planning = g.status === 'active' && !inflight && !g.pending;
  const auto = g.approval === 'auto';

  const link = <span className="gf-link" aria-hidden="true" />;
  return (
    <ol className="goal-flow" aria-label="Loop flow">
      <li>
        <ActionNode
          compact
          tabbable
          label="Finish check actions"
          mark={<FlaskConical aria-hidden="true" />}
          title={<span className="mono">{g.check?.command}</span>}
          line={checking ? 'Re-running the check…' : last ? `${last.summary ?? (last.ok ? 'Passes' : last.value !== undefined ? `Reads ${last.value}, wants ${g.check?.target}` : 'Failing')} · ${ago(last.at)}` : 'Not run yet'}
          tone={checkTone}
          toneLabel={{ live: 'Checking', done: 'Passes', failed: 'Failing', idle: 'Not run', needs: 'Needs you' }[checkTone]}
          actions={[
            { id: 'check', label: 'Run check', icon: <FlaskConical />, onSelect: act.runCheck, disabled: checking },
            { id: 'edit', label: 'Edit command', icon: <Pencil />, onSelect: () => setEditCmd(editCmd === undefined ? (g.check?.command ?? '') : undefined) },
            { id: 'settings', label: 'Settings', icon: <Settings />, onSelect: act.settings },
          ]}
        >
          {editCmd !== undefined ? (
            <form
              className="gf-edit"
              onSubmit={(e) => {
                e.preventDefault();
                act.saveCommand(editCmd.trim());
                setEditCmd(undefined);
              }}
            >
              <input className="gf-input mono" aria-label="Check command" value={editCmd} onChange={(e) => setEditCmd(e.target.value)} autoFocus />
              <Button type="submit" size="sm" variant="secondary" disabled={!editCmd.trim()}>
                Save
              </Button>
            </form>
          ) : null}
          {last?.tail ? (
            <ToolResult tool="Check" title="Output" kind="terminal" status={last.ok ? 'success' : 'error'} defaultOpen={false} collapseOnComplete={false} maxHeight={180}>
              <ToolResultOutput>{last.tail}</ToolResultOutput>
            </ToolResult>
          ) : null}
        </ActionNode>
      </li>
      {runs.map((i, n) => {
        const a = i.attempt;
        const finished = !!a?.after;
        const from = a?.before?.summary ?? (a?.before ? (a.before.ok ? 'passing' : 'failing') : 'unchecked');
        const to = a?.after ? (a.after.summary ?? (a.after.ok ? 'passing' : 'failing')) : undefined;
        const running = !finished || i.runStatus === 'running';
        return (
          <li key={i.id}>
            {link}
            <ActionNode
              compact
              tabbable
              label={`Run ${n + 1} actions`}
              mark={<Play aria-hidden="true" />}
              title={`Run ${n + 1} · ${i.text.split('\n')[0]!.slice(0, 80)}`}
              line={finished ? `check ${from} → ${to} · ${fmtUsd(a?.costUsd ?? 0)}` : `Working · check was ${from}`}
              tone={attemptTone(finished, a?.after?.ok)}
              toneLabel={finished ? (a?.after?.ok ? 'Check passed' : 'Check still failing') : 'Working'}
              actions={[
                { id: 'open', label: 'Open run', icon: <ExternalLink />, onSelect: () => act.openRun(i.runId!) },
                { id: 'retry', label: 'Retry', icon: <RotateCcw />, onSelect: () => act.retry(i.runId!), disabled: running },
                { id: 'diff', label: 'View diff', icon: <FileDiff />, onSelect: () => act.diff(i.runId!) },
              ]}
            />
          </li>
        );
      })}
      {g.pending ? (
        <li>
          {link}
          <ActionNode
            compact
            tabbable
            className="gf-next"
            label="Next run actions"
            mark={<Play aria-hidden="true" />}
            title="Next run"
            line={g.pending.why ?? 'Proposed by Tether'}
            tone={auto ? 'live' : 'needs'}
            toneLabel={auto ? 'Auto' : 'Needs you'}
            actions={[
              { id: 'dup', label: 'Duplicate goal', icon: <Copy />, onSelect: act.duplicate },
              { id: 'settings', label: 'Settings', icon: <Settings />, onSelect: act.settings },
            ]}
          >
            {editPlan !== undefined ? <textarea className="gf-input gf-plan" aria-label="Plan for the next run" rows={4} value={editPlan} onChange={(e) => setEditPlan(e.target.value)} /> : <p className="gf-task">{g.pending.task}</p>}
            <div className="gf-buttons">
              <Button size="sm" variant="primary" onClick={() => act.start(editPlan ?? g.pending!.task)}>
                {auto ? 'Start now' : 'Start run'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditPlan(editPlan === undefined ? g.pending!.task : undefined)}>
                {editPlan === undefined ? 'Edit plan' : 'Done'}
              </Button>
              <Button size="sm" variant="ghost" onClick={act.skip}>
                Skip
              </Button>
            </div>
          </ActionNode>
        </li>
      ) : planning ? (
        <li>
          {link}
          <ActionNode compact className="gf-next" label="Next run" mark={<Play aria-hidden="true" />} title="Next run" line="Planning the next run…" tone="live" toneLabel="Planning" actions={[]} />
        </li>
      ) : null}
    </ol>
  );
}
