import { ago } from '../api';
import { Avatars } from '../goals/Avatars';
import { goalLine, inProject, isOpen, statusWord, TYPE_GLYPH, type GoalView } from '../goals/goalsApi';
import type { Assignee } from '../goals/goalsApi';
import type { Route } from '../hooks';
import { cn } from '../ui/cn';

const KEY = 'tether.chat.goals';
/** Whether the panel is shown in this window (sessionStorage: each window remembers its own). */
export function goalsPanelOpen(): boolean {
  try {
    return sessionStorage.getItem(KEY) !== 'closed';
  } catch {
    return true;
  }
}
export function rememberGoalsPanel(open: boolean): void {
  try {
    sessionStorage.setItem(KEY, open ? 'open' : 'closed');
  } catch {
    /* private mode: it just isn't remembered */
  }
}

const who = (g: GoalView): Assignee[] => g.assignees ?? (g.team ? [{ kind: 'team', id: g.team }] : g.agent ? [{ kind: 'agent', id: g.agent }] : []);

/**
 * Goals · next beside a chat (asks-goals-runs board 1): the project's open goals, this chat's own first and highlighted
 * with its faces and "from this chat", and All goals. Picking one opens it on Goals.
 */
export function GoalsPanel({ goals, project, chatId, onGo, teamName = (id) => id }: { goals: GoalView[]; project?: string; chatId?: string; onGo: (r: Route) => void; teamName?: (id: string) => string }) {
  const open = inProject(goals, project).filter(isOpen);
  const mine = (g: GoalView) => !!chatId && g.origin?.chat === chatId;
  const shown = [...open.filter(mine), ...open.filter((g) => !mine(g))].slice(0, 8);
  return (
    <aside className="cg" aria-label="Goals next">
      <div className="cg-head">
        <b>Goals · next</b>
        <button type="button" className="cg-all" onClick={() => onGo({ tab: 'goals' })}>
          All goals
        </button>
      </div>
      {shown.length ? null : <p className="cg-none">No open goals in this project. Ask Tether to build, fix or do something and it becomes one.</p>}
      {shown.map((g) => (
        <button key={g.id} type="button" className={cn('cg-goal', mine(g) && 'mine')} aria-current={mine(g) ? 'true' : undefined} onClick={() => onGo({ tab: 'goals', id: g.id })}>
          <span className="cg-title">
            <span className={cn('cg-glyph', g.type ?? 'feature')} aria-hidden="true">
              {TYPE_GLYPH[g.type ?? 'feature']}
            </span>
            <b>{g.title}</b>
          </span>
          <span className="cg-line">
            {mine(g) ? <Avatars who={who(g)} size={22} /> : null}
            <span>{mine(g) ? [g.team ? `# ${teamName(g.team)}` : '', ago(g.createdAt), 'from this chat'].filter(Boolean).join(' · ') : `${statusWord(g)} · ${goalLine(g)}`}</span>
          </span>
        </button>
      ))}
      <p className="cg-note">Plain questions stay plain answers. Only asks to build, fix or do something become goals.</p>
    </aside>
  );
}
