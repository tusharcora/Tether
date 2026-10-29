import { useState } from 'react';
import { Diagram } from '../components/assistant-ui/elements/diagram';
import { PermissionGrant, type GrantScope } from '../components/assistant-ui/elements/permission-grant';
import { ApprovalCard } from '../components/beui/agents/approval-card';
import type { ApprovalCardAnswers } from '../components/beui/agents/approval-card/types';
import type { Route } from '../hooks';
import { LivePlan } from '../runs/PlanCard';
import { useNotify } from '../ui/notify';
import type { ChatMessage, Diagram as DiagramData, Proposal, ToolAsk } from './api';
import type { Assistant } from './useAssistant';

/** A run Tether proposes, as an approval card in review mode. Nothing starts until Start run is clicked. */
export function ProposalCard({ proposal: p, chat, onGo }: { proposal: Proposal; chat: Assistant; onGo: (r: Route) => void }) {
  const notify = useNotify();
  const decide = (d: 'start' | 'dismiss') => void chat.decide(p, d).then((n) => n.status === 'started' && n.runId && notify.ok('Run started'), notify.fail);
  const status = p.status === 'proposed' ? 'pending' : p.status === 'started' ? 'approved' : 'rejected';
  return (
    <div className="mt-2">
      <ApprovalCard
        title={p.kind === 'workflow' ? `Run the ${p.workflow} workflow?` : `Start a ${p.mode ?? 'team'} run?`}
        description={p.why}
        status={status}
        approveLabel="Start run"
        onApprove={() => decide('start')}
        onReject={() => decide('dismiss')}
        result={p.status === 'started' ? 'Run started' : p.status === 'failed' ? (p.note ?? 'Could not start') : p.status === 'dismissed' ? 'Dismissed' : undefined}
      >
        <p className="m-0 whitespace-pre-wrap text-sm">{p.task}</p>
      </ApprovalCard>
      {p.status === 'started' && p.runId ? (
        <button type="button" className="mt-1.5 border-0 bg-transparent p-0 text-sm text-foreground underline underline-offset-4" onClick={() => onGo({ tab: 'runs', id: p.runId })}>
          Open run
        </button>
      ) : null}
      {p.status === 'started' && p.runId ? (
        <div className="mt-2">
          <LivePlan runId={p.runId} />
        </div>
      ) : null}
    </div>
  );
}

/** Questions before Tether goes on: one card, a single choice moves on by itself; the answers go back as the next message. */
export function AskCardView({ message: m, chat }: { message: ChatMessage; chat: Assistant }) {
  const ask = m.ask!;
  const submit = (a: ApprovalCardAnswers) => {
    const label = (qid: string, v: string) => ask.questions.find((q) => q.id === qid)?.options.find((o) => o.id === v)?.label ?? v;
    const lines = ask.questions.map((q) => {
      const x = a[q.id];
      const vals = [...(x?.selected ?? []).map((v) => label(q.id, v)), ...(x?.custom ? [x.custom] : [])];
      return `${q.title}: ${vals.join(', ') || 'no answer'}`;
    });
    const result = lines.map((l) => l.split(': ').slice(1).join(': ')).join(' · ');
    chat.answered(m.id, result);
    void chat.send(lines.join('\n'), { answer: { message: m.id, result } });
  };
  return (
    <div className="mt-2">
      <ApprovalCard
        title="A question first"
        status={ask.status === 'answered' ? 'answered' : 'pending'}
        result={ask.result}
        questions={ask.questions.map((q) => ({ id: q.id, title: q.title, description: q.desc, multiple: q.multi, autoAdvance: !q.multi, options: q.options.map((o) => ({ value: o.id, label: o.label, description: o.desc })) }))}
        onSubmit={submit}
      />
    </div>
  );
}

const SCOPE = { pending: 'pending', once: 'session', always: 'always', denied: 'denied' } as const;
const DECISION: Record<GrantScope, 'once' | 'always' | 'deny'> = { session: 'once', always: 'always', denied: 'deny' };

/** A call to the outside world that Code Mode refused for lack of approval: allow it this session, always, or deny. */
export function ToolAskCard({ ask, onDecide }: { ask: ToolAsk; onDecide: (d: 'once' | 'always' | 'deny') => Promise<void> }) {
  const notify = useNotify();
  return (
    <div className="mt-2">
      <PermissionGrant
        capability="An outside-world call"
        requester="Tether"
        // what each answer allows, as the server keeps it: "once" lasts for the next reply, "always" for the project
        reach={[ask.what, "This session: for Tether's next reply", 'Always: for every chat in this project']}
        scope={SCOPE[ask.status]}
        onGrant={(s) => void onDecide(DECISION[s]).catch(notify.fail)}
      />
    </div>
  );
}

const BOX = { w: 132, h: 36, gx: 44, gy: 14 };

/** Each node's column (its longest path from a root, placing nodes root first; an edge back into a cycle is ignored) and its row. */
export function layout(d: DiagramData): Map<string, { col: number; row: number }> {
  const col = new Map(d.nodes.map((n) => [n.id, 0]));
  const indeg = new Map(d.nodes.map((n) => [n.id, 0]));
  for (const e of d.edges) indeg.set(e.to, indeg.get(e.to)! + 1);
  const placed = new Set<string>();
  const queue = d.nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  while (placed.size < d.nodes.length) {
    // a cycle leaves no root: its first unplaced node starts it
    if (!queue.length) queue.push(d.nodes.find((n) => !placed.has(n.id))!.id);
    const id = queue.shift()!;
    if (placed.has(id)) continue;
    placed.add(id);
    for (const e of d.edges)
      if (e.from === id && !placed.has(e.to)) {
        col.set(e.to, Math.max(col.get(e.to)!, col.get(id)! + 1));
        indeg.set(e.to, indeg.get(e.to)! - 1);
        if (!indeg.get(e.to)) queue.push(e.to);
      }
  }
  const rows = new Map<number, number>();
  return new Map(
    d.nodes.map((n) => {
      const c = col.get(n.id)!;
      const r = rows.get(c) ?? 0;
      rows.set(c, r + 1);
      return [n.id, { col: c, row: r }];
    }),
  );
}

/** A diagram card: the reply's nodes left to right by depth, arrows between them, zoom in the element's bar. */
export function DiagramCard({ diagram: d }: { diagram: DiagramData }) {
  const [zoom, setZoom] = useState(1);
  const at = layout(d);
  const xy = (id: string) => ({ x: at.get(id)!.col * (BOX.w + BOX.gx), y: at.get(id)!.row * (BOX.h + BOX.gy) });
  const cols = Math.max(...[...at.values()].map((p) => p.col)) + 1;
  const rows = Math.max(...[...at.values()].map((p) => p.row)) + 1;
  const w = cols * BOX.w + (cols - 1) * BOX.gx;
  const h = rows * BOX.h + (rows - 1) * BOX.gy;
  return (
    <Diagram className="mt-2" title={d.title} zoom={zoom} onZoomIn={() => setZoom((z) => Math.min(2, z + 0.25))} onZoomOut={() => setZoom((z) => Math.max(0.5, z - 0.25))} onReset={() => setZoom(1)}>
      <svg viewBox={`-2 -2 ${w + 4} ${h + 4}`} width={w + 4} className="block h-auto max-w-full" role="img" aria-label={`${d.title}: ${d.edges.map((e) => `${e.from} to ${e.to}`).join(', ') || d.nodes.map((n) => n.label).join(', ')}`}>
        <defs>
          <marker id="dg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 z" className="fill-muted-foreground" />
          </marker>
        </defs>
        {d.edges.map((e, i) => {
          const a = xy(e.from);
          const b = xy(e.to);
          const [x1, y1, x2, y2] = [a.x + BOX.w, a.y + BOX.h / 2, b.x, b.y + BOX.h / 2];
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-muted-foreground" strokeWidth={1.2} markerEnd="url(#dg-arrow)" />
              {e.label ? (
                <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} textAnchor="middle" className="fill-muted-foreground text-[9px]">
                  {e.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {d.nodes.map((n) => {
          const p = xy(n.id);
          return (
            <g key={n.id}>
              <title>{n.label}</title>
              <rect x={p.x} y={p.y} width={BOX.w} height={BOX.h} rx={8} className="fill-background stroke-border" />
              <text x={p.x + BOX.w / 2} y={p.y + BOX.h / 2 + 4} textAnchor="middle" className="fill-foreground text-[11px]">
                {n.label.length > 20 ? `${n.label.slice(0, 19)}…` : n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </Diagram>
  );
}
