import type { Route } from '../hooks';
import { ListRow } from '../ui/studio/ListRow';
import { Panel } from '../ui/studio/Panel';
import { StatusChip } from '../ui/studio/StatusChip';
import { ApproveButton } from './Goals';
import { goalMeta, type GoalView } from './goalsApi';

/** Goals with a proposed run waiting on you, for Home and the Inbox. Nothing when none wait. */
export function GoalsNeedYou(p: { goals?: GoalView[]; onGo: (r: Route) => void; onDone: (g: GoalView) => void }) {
  const waiting = (p.goals ?? []).filter((g) => g.status === 'needs_you' && g.pending);
  if (!waiting.length) return null;
  return (
    <Panel title="Goals waiting for you" count={waiting.length}>
      <ul className="sl-list">
        {waiting.map((g) => (
          <ListRow key={g.id} lead={<StatusChip tone="needs" label="next run" />} title={g.title} onOpen={() => p.onGo({ tab: 'goals', id: g.id })} meta={`${g.pending!.task.split('\n')[0]!.slice(0, 100)} · ${goalMeta(g)}`} actions={<ApproveButton goal={g} onDone={p.onDone} />} />
        ))}
      </ul>
    </Panel>
  );
}
