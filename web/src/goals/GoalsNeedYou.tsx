import type { Route } from '../hooks';
import { ListRow } from '../ui/studio/ListRow';
import { RunGlyph } from '../ui/studio/RunGlyph';
import { RowList, Section } from '../ui/studio/Section';
import { ApproveButton } from './GoalNode';
import { goalMeta, type GoalView } from './goalsApi';

/** The tickets whose proposed next run waits on the person. */
export const waitingGoals = (goals?: GoalView[]) => (goals ?? []).filter((g) => g.status === 'needs_you' && g.pending);

/** Home's Needs you rows for tickets: the proposed run, with the amber Approve run in the row. Nothing when none wait. */
export function GoalsNeedYou(p: { goals?: GoalView[]; onGo: (r: Route) => void; onDone: (g: GoalView) => void }) {
  const waiting = waitingGoals(p.goals);
  if (!waiting.length) return null;
  return (
    <Section title="Tickets waiting for you" count={waiting.length}>
      <RowList label="Tickets waiting for you">
        {waiting.map((g) => (
          <ListRow key={g.id} lead={<RunGlyph state="needs" />} title={`${g.key} ${g.title}`} onOpen={() => p.onGo({ tab: 'tickets', id: g.id })} meta={`${g.pending!.task.split('\n')[0]!.slice(0, 100)} · ${goalMeta(g)}`} actions={<ApproveButton goal={g} onDone={p.onDone} />} />
        ))}
      </RowList>
    </Section>
  );
}
