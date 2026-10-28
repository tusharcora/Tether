import { useState } from 'react';
import { fmtDur, fmtUsd, metricsLine, type RunView, type StoredEvent } from '../api';
import { ToolResult, ToolResultOutput } from '../components/beui/agents/tool-result';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/beui/kit/controls';
import { crewFor, useCrew } from '../crewStore';
import { Face, moodFor } from '../Face';
import { useNow } from '../home/Elapsed';
import { fmtClock } from '../home/runText';
import type { RunAct } from '../Runs';
import { QuietLine } from '../ui/studio/Section';
import { stepDesc } from '../ui/studio/status';
import { StatusBadge } from '../ui/studio/StatusBadge';
import { eventsForStep, gateRuns } from './inspectorModel';
import { Rating } from './Rating';
import { DiffView, TimelineOf } from './RunDetails';
import { useDiff } from './useDiff';

type Tab = 'output' | 'changes' | 'checks' | 'timeline';

/** Step mode: who and how it stands, three figures (attempts, cost, time; live while it runs), Output / Changes / Checks / Timeline, the rating. */
export function StepView({ run: r, events, node: id, onAct, onOpenFile }: { run: RunView; events: StoredEvent[]; node: string; onAct: RunAct; onOpenFile?: (file: string) => void }) {
  const { crew } = useCrew();
  const [tab, setTab] = useState<Tab>('output');
  const pnode = r.pipeline.nodes.find((n) => n.id === id);
  const node = r.nodes[id];
  const running = node?.status === 'running';
  const now = useNow(running);
  const diff = useDiff(node?.commit ? `/api/runs/${r.id}/diff?node=${encodeURIComponent(id)}` : undefined, node?.commit ?? '');
  if (!pnode || !node)
    return (
      <p className="sl-note" role="note">
        This step is not in this run. Click a step in the graph to see its output, changes and checks.
      </p>
    );
  const bot = crewFor(pnode, crew);
  const name = crew[bot]?.name ?? bot;
  // "why Tether picked it" is the plan assignment's reason, team runs only
  const why = r.kind === 'team' ? r.plan?.assignments.find((a) => a.bot === pnode.role)?.why : undefined;
  const mine = eventsForStep(events, id);
  const metrics = mine.findLast((e) => e.event.type === 'node.metrics')?.event;
  const checks = pnode.kind === 'gate' || !!pnode.verdict || !!node.verdict;
  const time = node.startedAt ? (node.finishedAt ? fmtDur(node.finishedAt - node.startedAt) : fmtClock(now - node.startedAt)) : '—';
  const output = running ? node.live : pnode.kind === 'gate' ? node.gate?.output : node.output;

  return (
    <div className="insp-step">
      <div className="insp-who">
        <Face id={bot} size={44} mood={moodFor(node.status)} animate={running ? 'always' : undefined} />
        <div className="insp-who-main">
          <div className="insp-who-row">
            <h2>{name}</h2>
            <StatusBadge desc={stepDesc(pnode, node)} />
          </div>
          <p className="insp-sub">{pnode.kind === 'gate' ? (pnode.command ?? 'gate') : `${pnode.role ?? pnode.kind} · ${pnode.agent ?? 'claude'} · ${pnode.model ?? 'default'}`}</p>
        </div>
      </div>
      {why ? (
        <p className="step-why">
          <span className="sl-meta">Why Tether picked it</span> <span>{why}</span>
        </p>
      ) : null}
      {node.error ? (
        <p className="sl-alert" role="alert">
          {node.error}
        </p>
      ) : null}
      <dl className="insp-stats">
        <div>
          <dt>Attempts</dt>
          <dd>
            {node.attempts}
            {node.loops > 0 ? ` · ${node.loops} fix loop${node.loops === 1 ? '' : 's'}` : ''}
          </dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{fmtUsd(node.costUsd)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{time}</dd>
        </div>
      </dl>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList aria-label="Step">
          <TabsTrigger value="output">Output</TabsTrigger>
          <TabsTrigger value="changes">Changes</TabsTrigger>
          {checks ? <TabsTrigger value="checks">Checks</TabsTrigger> : null}
          <TabsTrigger value="timeline">{`Timeline (${mine.length})`}</TabsTrigger>
        </TabsList>
        <TabsContent value="output" className="insp-body">
          {output ? (
            <pre className="insp-out">
              {output}
              {running ? <span className="caret" aria-hidden="true" /> : null}
            </pre>
          ) : (
            <QuietLine>{running ? 'Working…' : 'No output yet.'}</QuietLine>
          )}
          {metrics?.type === 'node.metrics' ? <p className="sl-meta">{metricsLine(metrics)}</p> : null}
        </TabsContent>
        <TabsContent value="changes" className="insp-body">
          {node.commit ? (
            <DiffView diff={diff} empty="This commit changed no files." onOpenFile={onOpenFile} />
          ) : (
            <QuietLine>{pnode.kind === 'agent' && !pnode.readOnly && node.status === 'done' ? 'This step finished without changing any files.' : 'No changes yet.'}</QuietLine>
          )}
        </TabsContent>
        {checks ? (
          <TabsContent value="checks" className="insp-body">
            {pnode.kind === 'gate' ? (
              <>
                {gateRuns(events, id, node.gate).map((g) => (
                  <div key={g.attempt} className="chk">
                    <div className="chk-head">
                      <b>{`Run ${g.attempt}`}</b>
                      <StatusBadge tone={g.ok ? 'done' : 'failed'} label={g.ok ? 'passed' : 'failed'} />
                      <span className="sl-meta">{`exit ${g.exitCode ?? '?'} · ${fmtDur(g.durationMs)}`}</span>
                    </div>
                    <ToolResult tool={pnode.command ?? 'gate'} kind="terminal" title="Output" status={g.ok ? 'success' : 'error'} defaultOpen={false} collapseOnComplete={false} maxHeight={240} copyText={g.output}>
                      <ToolResultOutput language="text">{g.output || '(no output)'}</ToolResultOutput>
                    </ToolResult>
                  </div>
                ))}
                <p className="sl-meta">{`Fix loops: ${node.loops} of ${pnode.fixNode ? (pnode.maxLoops ?? 2) : 0}`}</p>
              </>
            ) : null}
            {node.verdict ? <StatusBadge tone={node.verdict === 'PASS' ? 'done' : 'failed'} label={`VERDICT ${node.verdict}`} /> : null}
          </TabsContent>
        ) : null}
        <TabsContent value="timeline" className="insp-body">
          <TimelineOf run={r} events={mine} label="Step events" />
        </TabsContent>
      </Tabs>
      {pnode.kind === 'agent' && (node.status === 'done' || node.status === 'error') && !r.probe ? (
        <Rating key={id} botName={name} current={node.feedback} onRate={(rating, note) => onAct('feedback', { node: id, rating, ...(note ? { note } : {}) })} />
      ) : null}
    </div>
  );
}
