import { useState } from 'react';
import { ActionNode, type NodeAction } from '../components/bencho/ActionNode';
import { Button } from '../components/beui/kit/Button';
import { useNotify } from '../ui/notify';
import { cn } from '../ui/cn';
import { Avatars } from './Avatars';
import { goalsApi, statusWord, TYPE_GLYPH, TYPE_LABEL, typeOf, type GoalType, type GoalView } from './goalsApi';
import './goals.css';

/** A visible approval: an amber button, since the run waits for the person. */
export function ApproveButton(p: { goal: GoalView; onDone: (g: GoalView) => void }) {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="goal-approve"
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          p.onDone(await goalsApi.next(p.goal.id, 'start'));
        } catch (err) {
          notify.fail(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      Approve run
    </button>
  );
}

export type GoalSection = 'now' | 'next' | 'done';
/** Now: needs you or working. Up next: paused. Done: met or stopped. */
export const sectionOf = (g: Pick<GoalView, 'status'>): GoalSection => (g.status === 'needs_you' || g.status === 'active' ? 'now' : g.status === 'paused' ? 'next' : 'done');

/** When a goal ended: `endedAt`, or for a goal from before it, its last item's time, then when it was made. */
export const endOf = (g: GoalView): number => g.endedAt ?? g.items.at(-1)?.at ?? g.createdAt;

/** The page's three parts: Now with needs you first, Up next as listed, Done newest first. */
export function sections(goals: GoalView[]): Record<GoalSection, GoalView[]> {
  const of = (s: GoalSection) => goals.filter((g) => sectionOf(g) === s);
  const now = of('now');
  return { now: [...now.filter((g) => g.status === 'needs_you'), ...now.filter((g) => g.status !== 'needs_you')], next: of('next'), done: of('done').sort((a, b) => endOf(b) - endOf(a)) };
}

/** A loop's run that has not been checked after yet: the one going now. */
export const liveRun = (g: GoalView) => g.items.find((i) => i.kind === 'run' && !i.attempt?.after);

export interface NextStrip {
  label: string;
  text: string;
  action: 'approve' | 'watch' | 'open';
  tone: 'needs' | 'live';
}
const firstLine = (t: string) => t.split('\n')[0]!;

/** What happens next for a goal in Now, and its one button. Nothing for a goal that is paused or done. */
export function nextStrip(g: GoalView): NextStrip | undefined {
  if (g.status === 'needs_you') return { label: 'Needs you:', text: firstLine(g.pending?.task ?? 'Open the goal to answer it'), action: g.pending ? 'approve' : 'open', tone: 'needs' };
  if (g.status !== 'active') return undefined;
  if (g.kind === 'tracker') {
    const todo = g.items.find((i) => !i.done && i.runStatus !== 'done');
    return { label: 'Next:', text: todo ? firstLine(todo.text) : 'Nothing left on the list', action: 'open', tone: 'live' };
  }
  const runs = g.items.filter((i) => i.kind === 'run').length;
  const live = liveRun(g);
  return { label: `Step ${Math.min(live ? runs : runs + 1, g.maxRuns)} of ${g.maxRuns}:`, text: live ? firstLine(live.text) : 'Planning the next run…', action: 'watch', tone: 'live' };
}

/** The type's tile: a coloured glyph on a rounded square (the type is also named in words beside it). */
export const TypeTile = ({ type }: { type?: GoalType }) => (
  <span className={cn('gn-tile', `t-${type ?? 'feature'}`)} aria-hidden="true">
    {TYPE_GLYPH[type ?? 'feature']}
  </span>
);

/**
 * A goal as an action node (board F): a fixed 168 px card with its type, title, two lines of description, avatars and status,
 * the arc of `actions` off its top-right corner, and for a goal in Now the 48 px strip of what happens next under it.
 */
export function GoalNode({ goal: g, onOpen, actions, onDone, onWatch }: { goal: GoalView; onOpen: () => void; actions: NodeAction[]; onDone: (g: GoalView) => void; onWatch: (runId: string) => void }) {
  const strip = nextStrip(g);
  const desc = g.description ?? (g.kind === 'loop' ? g.check?.command : undefined);
  const run = liveRun(g)?.runId;
  return (
    <div className="gn-mod">
      <ActionNode size="lg" corner={20} tabbable className={cn('gn-node', g.status === 'needs_you' ? 't-needs' : g.status === 'active' && 't-live')} label={`${g.title} actions`} actions={actions}>
        <div className="gn-top">
          <TypeTile type={g.type} />
          <button type="button" className="gn-open" onClick={onOpen}>
            <span className="gn-title">{g.title}</span>
          </button>
        </div>
        {desc ? <p className={cn('gn-desc', !g.description && 'mono')}>{desc}</p> : null}
        <div className="gn-foot">
          <Avatars who={g.assignees ?? []} />
          <span className="gn-status">
            {TYPE_LABEL[typeOf(g)]} · {statusWord(g)}
          </span>
        </div>
      </ActionNode>
      {strip ? (
        <div className={cn('gn-strip', `t-${strip.tone}`)}>
          <b className="gn-strip-label">{strip.label}</b>
          <span className="gn-strip-text">{strip.text}</span>
          {strip.action === 'approve' ? (
            <ApproveButton goal={g} onDone={onDone} />
          ) : (
            <Button size="sm" variant="secondary" onClick={() => (strip.action === 'watch' && run ? onWatch(run) : onOpen())}>
              {strip.action === 'watch' ? 'Watch' : 'Open'}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
