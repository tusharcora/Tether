import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NOT_TRUSTED, TRUST_BODY } from '../../../src/runLabels';
import { api, ApiError, type RunView } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import { usePoll, type Route } from '../hooks';
import { planRows } from '../runs/planModel';
import { NOT_IN_FOLDER, nothingToLand } from '../runs/storyModel';
import { cn } from '../ui/cn';
import { useNotify } from '../ui/notify';
import { viewDesc } from '../ui/studio/status';
import type { RouteCard, RouteKind } from './api';
import { taskState } from './taskCards';
import type { Assistant } from './useAssistant';

const ROW: Record<RouteKind, string> = { solo: 'Do it myself', ticket: 'Make a ticket', workflow: 'Workflow', team: 'Team' };
const BUTTON: Record<RouteKind, string> = { ...ROW, workflow: 'Use a workflow', team: 'Use a team' };
const WORKING: Record<RouteKind, string> = { solo: 'Doing it myself · saved a checkpoint first', ticket: 'Making the ticket', workflow: 'Running the workflow', team: 'The team is on it' };
const FAILED = "This didn't finish, so your folder wasn't changed.";
const STOPPED = "This was stopped, so your folder wasn't changed.";
const NO_RUN = "This run couldn't be read.";
const NO_UNDO = "That couldn't be undone, so nothing was changed.";
const UNCHECKED = "It ran without commands, so this wasn't checked.";
/** Agents' own lines and undo's raw errors can say these: a plain folder's card must not. */
const GIT_WORDS = /\b(git|branch(es)?|merg\w*|commit\w*|PRs?|pull request|repo(sitory)?|worktree|rebase)\b/i;

const Card = ({ title, children }: { title?: string; children?: ReactNode }) => (
  <article className="mt-2 rounded-xl border border-border bg-card px-4 py-3" aria-label={title} role={title ? 'region' : undefined}>
    {title ? <h4 className="m-0 text-xs font-medium text-muted-foreground">{title}</h4> : null}
    {children}
  </article>
);
const Acts = ({ children }: { children: ReactNode }) => <div className="mt-2.5 flex flex-wrap items-center gap-2">{children}</div>;
const Say = ({ children, bad }: { children: ReactNode; bad?: boolean }) => (
  <p className={cn('m-0 text-sm', bad && 'text-destructive')} role="status">
    {children}
  </p>
);

/** How the work landed: its one file with what changed, or how many. */
function landedLine(r: RunView): string {
  const { files } = r.ship!.landed!;
  if (files.length !== 1) return `${files.length} files`;
  const stats = Object.values(r.nodes).flatMap((n) => n.stat ?? []);
  const count = (k: 'added' | 'deleted') => stats.reduce((a, s) => a + s[k], 0);
  return stats.length ? `${files[0]} · +${count('added')} −${count('deleted')}` : files[0]!;
}

/** How long after finishing a solo run in a plain folder may still land by itself. */
const LANDING_MS = 60_000;

/** More is coming without the person: it's working, auto-fix is on it (the server counts that as live), or a solo run is about to land. */
function watching(r: RunView): boolean {
  const state = taskState(viewDesc(r));
  if (state === 'failed') return !!r.live && !r.autofix?.needsWrites;
  // shortcut: a landing still queued after LANDING_MS reads as not landed until the card is next opened, fine for one folder's queue
  if (state === 'done') return !!r.solo && !!r.history && !r.ship && !r.undone && Date.now() - (r.finishedAt ?? 0) < LANDING_MS;
  return state === 'working';
}

/** A started run as the card tells it, read every 2.5 s while more is coming. */
function RunState({ card, runId, onGo }: { card: RouteCard; runId: string; onGo: (r: Route) => void }) {
  const notify = useNotify();
  const [over, setOver] = useState(false);
  const [afterUndo, setAfterUndo] = useState<RunView>();
  const [undoing, setUndoing] = useState(false);
  const poll = usePoll<RunView>(over ? null : `/api/runs/${encodeURIComponent(runId)}`, 2500);
  const run = afterUndo ?? poll.data;
  useEffect(() => {
    if (poll.status === 404 || (run && !watching(run))) setOver(true);
  }, [run, poll.status]);
  const openRun = (label = 'Open the run') => (
    <Button size="sm" variant="secondary" onClick={() => onGo({ tab: 'runs', id: runId })}>
      {label}
    </Button>
  );
  const unchecked = card.noCommands ? <p className="m-0 mt-1 text-xs text-muted-foreground">{UNCHECKED}</p> : null;
  const ending = (say: ReactNode, bad?: boolean) => (
    <Card>
      <Say bad={bad}>{say}</Say>
      {say === NOT_TRUSTED || say === NO_RUN ? null : unchecked}
      <Acts>{openRun()}</Acts>
    </Card>
  );
  const chose = card.chose ?? 'solo';
  if (!run) return poll.error ? ending(NO_RUN) : <Card title={WORKING[chose]} />;
  const state = taskState(viewDesc(run));
  if (state === 'done') {
    if (run.ship?.landed) {
      const undo = () => {
        setUndoing(true);
        api<RunView>('POST', `/api/runs/${encodeURIComponent(runId)}/undo-land`)
          .then(setAfterUndo, (e: Error) => notify.fail(GIT_WORDS.test(e.message) ? new Error(NO_UNDO) : e))
          .finally(() => setUndoing(false));
      };
      return (
        <Card>
          <Say>{landedLine(run)}</Say>
          {unchecked}
          <Acts>
            {openRun('See changes')}
            <Button size="sm" variant="ghost" loading={undoing} onClick={undo}>
              Undo
            </Button>
          </Acts>
        </Card>
      );
    }
    if (run.undone) return <Card><Say>Undone. Your folder is back to how it was.</Say></Card>;
    if (nothingToLand(run)) return ending('Nothing changed in your folder.');
    if (run.ship?.error) return ending(run.ship.error, true);
    return ending(run.history ? NOT_IN_FOLDER : 'Ready');
  }
  if (state === 'failed') return ending(FAILED, true);
  if (state === 'cancelled') return ending(run.error === NOT_TRUSTED ? NOT_TRUSTED : STOPPED);
  if (state === 'waiting') return ending('Waiting for you');
  const step = planRows(run).find((r) => r.state === 'live');
  const line = [step?.subs.at(-1)?.text, step?.title].find((t) => t && !(run.history && GIT_WORDS.test(t)));
  return (
    <Card title={WORKING[chose]}>
      {line ? <p className="m-0 mt-1 truncate text-sm">{line}</p> : null}
      {card.noCommands ? <p className="m-0 mt-1 text-xs text-muted-foreground">It can't run commands here, because this folder isn't trusted.</p> : null}
    </Card>
  );
}

/** "How I'd do this": the ways on offer, the recommended one first among the buttons. A folder never asked about asks first. */
function Proposed({ card, chat }: { card: RouteCard; chat: Assistant }) {
  const notify = useNotify();
  const [busy, setBusy] = useState<RouteKind>();
  const [ask, setAsk] = useState<{ choice: RouteKind; folder?: string }>();
  const prefs = usePoll<{ soloWithoutAsking?: boolean }>('/api/health', 60_000);
  // a ref: the closing dialog keeps its buttons, with their old props, until it has animated out
  const going = useRef(false);
  const start = async (choice: RouteKind, trust?: boolean) => {
    if (going.current) return;
    going.current = true;
    setAsk(undefined);
    setBusy(choice);
    try {
      await chat.route(card, choice, trust);
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { needsTrust?: boolean; folder?: string } | undefined) : undefined;
      if (b?.needsTrust) setAsk({ choice, folder: b.folder });
      else notify.fail(e as Error);
    } finally {
      going.current = false;
      setBusy(undefined);
    }
  };
  const setSolo = (on: boolean) => void api('PUT', '/api/prefs', { soloWithoutAsking: on }).then(prefs.refresh, notify.fail);
  const first = [...card.rows].sort((a, b) => Number(b.kind === card.recommend) - Number(a.kind === card.recommend));
  return (
    <Card title="How I'd do this">
      <p className="m-0 mt-1 text-sm">{card.task}</p>
      <ul className="m-0 mt-2 flex list-none flex-col p-0">
        {card.rows.map((r) => {
          const rec = r.kind === card.recommend;
          return (
            <li key={r.kind} data-recommended={rec ? '' : undefined} className={cn('flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-lg px-2.5 py-1.5 text-[13px]', rec && 'bg-[var(--accBg)]')}>
              <b className="w-28 flex-none font-medium">{ROW[r.kind]}</b>
              <span className="min-w-[min(12rem,100%)] flex-1 text-muted-foreground">{`${rec && !/^recommended/i.test(r.why) ? 'Recommended. ' : ''}${r.why}`}</span>
              {r.cost ? <em className="whitespace-nowrap font-mono text-[11px] not-italic text-muted-foreground">{r.cost}</em> : null}
            </li>
          );
        })}
      </ul>
      <Acts>
        {first.map((r) => (
          <Button key={r.kind} size="sm" variant={r.kind === card.recommend ? 'primary' : 'secondary'} loading={busy === r.kind} disabled={!!busy} onClick={() => void start(r.kind)}>
            {BUTTON[r.kind]}
          </Button>
        ))}
      </Acts>
      <label className="mt-2 flex w-fit cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" className="m-0 accent-[var(--acc)]" checked={prefs.data?.soloWithoutAsking === true} disabled={!prefs.data} onChange={(e) => setSolo(e.target.checked)} />
        Don't ask for small jobs
      </label>
      <p className="m-0 mt-0.5 text-xs text-muted-foreground">Small jobs then start without asking in folders you trust.</p>
      <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(undefined)}>
        <DialogContent title="Trust this folder?">
          <p className="m-0">{TRUST_BODY}</p>
          {ask?.folder ? <code className="mt-2 block truncate text-xs text-muted-foreground">{ask.folder}</code> : null}
          <div className="row end mt-4">
            <Button variant="secondary" onClick={() => ask && void start(ask.choice, false)}>
              Not now
            </Button>
            <Button variant="primary" onClick={() => ask && void start(ask.choice, true)}>
              Trust
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** A reply's route card: how to do what was asked, then how that's going. Nothing starts until the person clicks. */
export function RouteCardView({ card, chat, onGo }: { card: RouteCard; chat: Assistant; onGo: (r: Route) => void }) {
  if (card.status === 'proposed') return <Proposed card={card} chat={chat} />;
  if (card.status === 'dismissed') return null;
  if (card.status === 'failed') return <Card><Say bad>{card.note ?? "That couldn't start."}</Say></Card>;
  if (card.runId) return <RunState card={card} runId={card.runId} onGo={onGo} />;
  if (!card.goalId) return <Card title={WORKING[card.chose ?? 'solo']} />;
  return (
    <Card>
      <Say>Ticket made.</Say>
      <Acts>
        <Button size="sm" variant="secondary" onClick={() => onGo({ tab: 'tickets', id: card.goalId })}>
          Open the ticket
        </Button>
      </Acts>
    </Card>
  );
}
