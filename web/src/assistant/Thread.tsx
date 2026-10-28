import { FileCode2, NotebookText, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Route } from '../hooks';
import { ComparisonTable } from '../components/aicss/ComparisonTable';
import { AgentCode } from '../components/beui/agents/agent-code';
import { Citations, type CitationItem } from '../components/beui/agents/citations';
import { StreamingResponse } from '../components/beui/agents/streaming-response';
import { ToolResult } from '../components/beui/agents/tool-result';
import type { ChatMessage, Cite, ToolRun } from './api';
import type { Assistant } from './useAssistant';
import { Markdown } from './Markdown';
import { AskCardView, ProposalCard, ToolAskCard } from './cards';

/** Where a citation goes: file:line opens Code, a run opens its page, a note opens the Graph. */
export function routeOf(c: Cite): Route {
  if (c.kind === 'file') return { tab: 'code', id: c.path, ...(c.line ? { line: c.line } : {}) };
  if (c.kind === 'run') return { tab: 'runs', id: c.id };
  return { tab: 'graph', id: c.path };
}

const ICON = { file: FileCode2, run: Play, note: NotebookText } as const;

export function citationItems(cites: Cite[], onGo: (r: Route) => void): CitationItem[] {
  return cites.map((c) => {
    const Icon = ICON[c.kind];
    return {
      id: `c${c.n}`,
      title: c.label,
      domain: c.kind === 'file' ? `${c.path}${c.line ? `:${c.line}` : ''}` : c.kind === 'run' ? `run ${c.id}` : c.path,
      icon: <Icon aria-hidden="true" />,
      onOpen: () => onGo(routeOf(c)),
    };
  });
}

/** The reply's visible text: the trailing ```tether block (sources, proposals, ...) is data, never shown, even half-written. */
export const visibleText = (text: string) => {
  const i = text.indexOf('```tether');
  return (i >= 0 ? text.slice(0, i) : text).trimEnd();
};

function Tools({ tools, running }: { tools: ToolRun[]; running?: boolean }) {
  return (
    <div className="mb-2 flex flex-col gap-2">
      {tools.map((t) => (
        <ToolResult
          key={t.id}
          tool="run_code"
          title={t.code.split('\n')[0]!.slice(0, 80) || 'Code Mode'}
          kind="terminal"
          status={t.output === undefined && running ? 'running' : t.isError ? 'error' : 'success'}
          meta={t.ms !== undefined ? `${t.ms} ms` : undefined}
          copyText={t.output}
          defaultOpen={false}
        >
          <AgentCode code={t.code} language="typescript" />
          {t.output ? <AgentCode code={t.output} language="text" className="mt-2 border-t border-border pt-2" /> : null}
        </ToolResult>
      ))}
    </div>
  );
}

function TetherMessage({ m, chat, onGo }: { m: ChatMessage; chat: Assistant; onGo: (r: Route) => void }) {
  const text = visibleText(m.text);
  return (
    <div className="max-w-[92%]" data-role="tether">
      {m.tools?.length ? <Tools tools={m.tools} /> : null}
      {text || m.error ? (
        <StreamingResponse
          status={m.error && m.error !== 'Stopped.' ? 'error' : 'complete'}
          announce={false}
          copyText={text}
          sources={m.cites?.length ? citationItems(m.cites, onGo) : undefined}
          feedback={m.feedback ?? null}
          onFeedbackChange={(v) => chat.feedback(m.id, v)}
          sourceIdPrefix={`src-${m.id}`}
        >
          <Markdown text={text} cites={new Set((m.cites ?? []).map((c) => c.n))} idPrefix={`src-${m.id}`} onCite={(n) => { const c = m.cites?.find((x) => x.n === n); if (c) onGo(routeOf(c)); }} />
          {m.error ? <p className="m-0 mt-2 text-danger">{m.error}</p> : null}
        </StreamingResponse>
      ) : null}
      {m.compare ? (
        <div className="mt-2">
          <ComparisonTable title={m.compare.title} columns={m.compare.columns} rows={m.compare.rows} />
        </div>
      ) : null}
      {m.ask ? <AskCardView message={m} chat={chat} /> : null}
      {m.toolAsks?.map((a) => <ToolAskCard key={a.id} ask={a} onDecide={(d) => chat.tool(m.id, a.id, d)} />)}
      {m.proposals?.map((p) => <ProposalCard key={p.id} proposal={p} chat={chat} onGo={onGo} />)}
    </div>
  );
}

/** The conversation: your messages, and Tether's with their scripts, sources, comparison and cards. */
export function Thread({ chat, onGo, empty }: { chat: Assistant; onGo: (r: Route) => void; empty: ReactNode }) {
  const live = chat.streaming;
  return (
    <>
      {chat.loading ? <p className="m-0 text-muted-foreground">Loading the chat…</p> : null}
      {chat.error ? <p className="m-0 text-danger">{chat.error}</p> : null}
      {!chat.loading && !chat.messages.length && !live ? <p className="m-0 text-muted-foreground">{empty}</p> : null}
      {chat.messages.map((m) =>
        m.role === 'you' ? (
          <div key={m.id} className="max-w-[80%] self-end rounded-xl bg-muted px-3 py-2 whitespace-pre-wrap" data-role="you">
            {m.text}
            {m.attachments?.length ? <div className="mt-1 text-xs text-muted-foreground">{m.attachments.map((a) => a.name).join(', ')}</div> : null}
          </div>
        ) : (
          <TetherMessage key={m.id} m={m} chat={chat} onGo={onGo} />
        ),
      )}
      {live ? (
        <div className="max-w-[92%]" data-role="tether">
          {live.tools.length ? <Tools tools={live.tools} running /> : null}
          <StreamingResponse status="streaming" announce={false}>
            <Markdown text={visibleText(live.text)} />
          </StreamingResponse>
        </div>
      ) : null}
    </>
  );
}
