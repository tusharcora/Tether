import { Fragment, useEffect, useMemo, useState } from 'react';
import { parseLine, type Verb } from '../../../src/activity';
import { api, fmtDur, type RunView, type StoredEvent } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/beui/kit/controls';
import { Loading } from '../components/Loading';
import { crewFor, useCrew } from '../crewStore';
import { Face, moodFor } from '../Face';
import type { RunAct } from '../Runs';
import { cn } from '../ui/cn';
import { parseDiff } from '../ui/RunDiff';
import { InlineError } from '../ui/studio/InlineError';
import { QuietLine } from '../ui/studio/Section';
import { gateSummary } from './ApprovalBar';
import type { useComments } from './comments';
import { FileBars } from './FileBars';
import { gateRuns } from './inspectorModel';
import { Rating } from './Rating';
import { commitsKey } from './RunFiles';
import type { StoryRow } from './storyModel';
import { useDiff } from './useDiff';
import { Preview } from './Preview';
import { Terminal, type ProcSubscribe } from './Terminal';

export type StepTab = 'transcript' | 'changes' | 'terminal' | 'preview';

type Comments = ReturnType<typeof useComments>;
const VERB: Partial<Record<Verb, string>> = { read: 'Read', edit: 'Edited', run: 'Ran', search: 'Searched', fetch: 'Fetched', think: 'Planned', tool: 'Used' };

/** A step's tool calls from its streamed chunks (Read / Edited / Ran and their target), read once per attempt. */
function useToolRows(runId: string, node: string | undefined, key: string): { rows: { verb: string; text: string }[]; error?: string } {
  const [state, setState] = useState<{ rows: { verb: string; text: string }[]; error?: string }>({ rows: [] });
  useEffect(() => {
    if (!node) return;
    let live = true;
    api<StoredEvent[]>('GET', `/api/runs/${encodeURIComponent(runId)}/events?chunks=1`).then(
      (evs) => {
        const text = evs.flatMap(({ event: e }) => (e.type === 'node.chunk' && e.node === node ? [e.text] : [])).join('');
        const rows = text.split('\n').flatMap((l) => {
          const a = parseLine(l);
          return a && VERB[a.verb] ? [{ verb: VERB[a.verb]!, text: a.text }] : [];
        });
        if (live) setState({ rows: rows.slice(-200) });
      },
      (e: unknown) => live && setState({ rows: [], error: (e as Error).message }),
    );
    return () => void (live = false);
  }, [runId, node, key]);
  return state;
}

/** A diff whose lines take comments (board 4): click a line, write, Comment; comments show under their line, sent ones marked. */
export function CommentDiff({ text, node, comments }: { text: string; node: string; comments: Comments }) {
  const { files, truncated } = useMemo(() => parseDiff(text), [text]);
  const [open, setOpen] = useState<string>();
  const [draft, setDraft] = useState('');
  if (!files.length) return <QuietLine>No changes.</QuietLine>;
  return (
    <div className="cd">
      {files.map((f) => {
        const add = f.lines.filter((l) => l.type === 'added').length;
        const del = f.lines.filter((l) => l.type === 'removed').length;
        return (
          <div key={f.file} className="cd-file">
            <div className="cd-head">
              <span className="mono">{f.file}</span>
              <span className="mono ok">{`+${add}`}</span>
              <span className="mono bad">{`−${del}`}</span>
              <span className="cd-hint">click a line to comment</span>
            </div>
            {f.lines.map((l) => {
              const key = `${f.file}|${l.id}`;
              const mine = comments.list.filter((c) => c.node === node && c.file === f.file && c.line === l.id);
              const mark = l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' ';
              return (
                <Fragment key={l.id}>
                  <button type="button" className={cn('cd-ln', l.type)} aria-label={`Comment on ${f.file} line ${l.newLine ?? l.oldLine ?? ''}: ${l.content.trim().slice(0, 60)}`} aria-expanded={open === key} onClick={() => (setOpen(open === key ? undefined : key), setDraft(''))}>
                    {`${mark} ${l.content}`}
                  </button>
                  {mine.map((c) => (
                    <div key={c.id} className="cd-note">
                      <b>You</b>
                      <span>{c.text}</span>
                      {c.sent ? (
                        <span className="cd-sent">sent</span>
                      ) : (
                        <button type="button" className="cd-x" aria-label={`Remove your comment “${c.text.slice(0, 40)}”`} onClick={() => comments.remove(c.id)}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                  {open === key ? (
                    <form
                      className="cd-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!draft.trim()) return;
                        comments.add({ node, file: f.file, line: l.id, quote: `${mark} ${l.content}`, text: draft.trim() });
                        setOpen(undefined);
                      }}
                    >
                      <textarea aria-label={`Your comment on ${f.file}`} rows={2} maxLength={400} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
                      <span className="cd-form-row">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(undefined)}>
                          Cancel
                        </Button>
                        <Button type="submit" size="sm" variant="secondary" disabled={!draft.trim()}>
                          Comment
                        </Button>
                      </span>
                    </form>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        );
      })}
      {truncated ? <p className="sl-meta">The diff is cut short here; git has all of it.</p> : null}
    </div>
  );
}

/**
 * The step in the middle of a run's page (board 4): who and what it ran on, then Transcript (its tool calls as compact
 * rows, then what it said) and Changes (its diff, commentable line by line). An approval shows the run's whole diff.
 * Terminal and Preview (board 6) are the run's, not the step's: commands and the dev server in its worktree. On a wide
 * screen Preview opens as a pane beside this one (`onPreview` toggles it) instead of a tab.
 */
export function StepPane({ run: r, row, comments, onAct, onOpenFile, tab: shown, onTab, onProc, previewPane, onPreview }: { run: RunView; row?: StoryRow; comments: Comments; onAct: RunAct; onOpenFile?: (file: string) => void; tab?: StepTab; onTab?: (t: StepTab) => void; onProc?: ProcSubscribe; /** Preview is open in the side pane. */ previewPane?: boolean; /** Wide screens: toggle the Preview pane (no Preview tab). */ onPreview?: () => void }) {
  const { crew } = useCrew();
  const [own, setOwn] = useState<StepTab>('transcript');
  const tab = shown ?? own;
  const setTab = onTab ?? setOwn;
  const pnode = row?.node ? r.pipeline.nodes.find((n) => n.id === row.node) : undefined;
  const node = pnode ? r.nodes[pnode.id] : undefined;
  const agentStep = pnode?.kind === 'agent';
  const diff = useDiff(agentStep ? (node?.commit ? `/api/runs/${r.id}/diff?node=${encodeURIComponent(pnode!.id)}` : undefined) : `/api/runs/${r.id}/diff`, agentStep ? (node?.commit ?? '') : commitsKey(r));
  const tools = useToolRows(r.id, agentStep && tab === 'transcript' ? pnode!.id : undefined, `${node?.status}:${node?.attempts}`);
  const files = node?.stat?.files ?? (diff.text ? parseDiff(diff.text).files.length : undefined);
  if (!row || (row.node && !pnode))
    return (
      <section className="rp-step" aria-label="Step">
        <p className="sl-note" role="note">
          This step is not in this run. Pick a step on the left to see what it did and what it changed.
        </p>
      </section>
    );
  const bot = pnode ? crewFor(pnode, crew) : 'orchestrator';
  const name = crew[bot]?.name ?? bot;
  const sub = !pnode ? r.branch : pnode.kind === 'agent' ? [pnode.model ?? pnode.agent ?? 'claude', pnode.readOnly ? 'read-only' : 'read-write', `worktree ${r.branch}`].join(' · ') : pnode.kind === 'gate' ? (pnode.command ?? 'gate') : 'your approval';
  return (
    <section className="rp-step" aria-label="Step">
      <header className="rp-step-head">
        {pnode?.kind === 'approval' ? <span className="rp-you" aria-hidden="true">✓</span> : <Face id={bot} size={24} mood={moodFor(node?.status)} animate={node?.status === 'running' ? 'always' : undefined} />}
        <b>{row.sentence}</b>
        <span className="rp-sub">{sub}</span>
      </header>
      {node?.error ? (
        <p className="sl-alert" role="alert">
          {node.error}
        </p>
      ) : null}
      <Tabs value={tab === 'preview' && onPreview ? 'transcript' : tab} onValueChange={(v) => setTab(v as StepTab)} className="rp-tabs">
        <div className="rp-tabrow">
          <TabsList aria-label="Step view">
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="changes">{files !== undefined ? `Changes ${files}` : 'Changes'}</TabsTrigger>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            {onPreview ? null : <TabsTrigger value="preview">Preview</TabsTrigger>}
          </TabsList>
          {onPreview ? (
            <Button size="sm" variant={previewPane ? 'secondary' : 'ghost'} aria-pressed={!!previewPane} onClick={onPreview}>
              Preview
            </Button>
          ) : null}
          {tab === 'terminal' ? <span className="rp-where mono" title={r.workdir}>{`${r.workdir.replace(/^\/Users\/[^/]+/, '~')} · ${r.branch}`}</span> : null}
        </div>
        <TabsContent value="transcript" className="rp-body">
          {agentStep ? (
            <>
              {tools.error ? <p className="sl-meta">{`Could not read its tool calls: ${tools.error}`}</p> : null}
              {tools.rows.length ? (
                <ol className="rp-tools" aria-label="Tool calls">
                  {tools.rows.map((t, i) => (
                    <li key={i} className="rp-tool">
                      <span>{t.verb}</span>
                      <span className="mono">{t.text}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
              {node?.status === 'running' ? node.live ? <pre className="rp-out">{node.live}</pre> : <QuietLine>Working…</QuietLine> : node?.output ? <pre className="rp-out">{node.output}</pre> : <QuietLine>{node?.status === 'queued' ? 'Not started yet.' : 'It said nothing.'}</QuietLine>}
            </>
          ) : pnode?.kind === 'gate' ? (
            gateRuns([], pnode.id, node?.gate).map((g) => (
              <div key={g.attempt} className="rp-gate">
                <span className={cn('mono', g.ok ? 'ok' : 'bad')}>{`${g.ok ? 'passed' : 'failed'} · exit ${g.exitCode ?? '?'}${g.durationMs ? ` · ${fmtDur(g.durationMs)}` : ''}`}</span>
                <pre className="rp-out">{g.output || '(no output)'}</pre>
              </div>
            ))
          ) : (
            <QuietLine>{pnode?.kind === 'approval' ? `${gateSummary(r)}. The changes are in Changes; comment on any line, then ship or send it back.` : row.line || 'Tether plans the run before anyone works on it.'}</QuietLine>
          )}
          {pnode?.kind === 'gate' && !node?.gate ? <QuietLine>Not run yet.</QuietLine> : null}
        </TabsContent>
        <TabsContent value="terminal" className="rp-body">
          {tab === 'terminal' ? <Terminal run={r} onProc={onProc} /> : null}
        </TabsContent>
        {onPreview ? null : (
          <TabsContent value="preview" className="rp-body">
            {tab === 'preview' ? <Preview run={r} /> : null}
          </TabsContent>
        )}
        <TabsContent value="changes" className="rp-body">
          {diff.error ? (
            <InlineError message={diff.error} onRetry={diff.retry} />
          ) : agentStep && !node?.commit ? (
            <QuietLine>{node?.status === 'done' && !pnode!.readOnly ? 'This step finished without changing any files.' : 'No changes yet.'}</QuietLine>
          ) : (
            <Loading loading={diff.loading} lines={6} label="Loading the diff">
              {diff.text ? (
                <>
                  <FileBars diff={diff.text} onOpen={onOpenFile} />
                  <CommentDiff text={diff.text} node={pnode?.id ?? 'run'} comments={comments} />
                </>
              ) : (
                <QuietLine>No changes.</QuietLine>
              )}
            </Loading>
          )}
        </TabsContent>
      </Tabs>
      {agentStep && (node?.status === 'done' || node?.status === 'error') && !r.probe ? <Rating key={pnode!.id} botName={name} current={node.feedback} onRate={(rating, note) => onAct('feedback', { node: pnode!.id, rating, ...(note ? { note } : {}) })} /> : null}
    </section>
  );
}
