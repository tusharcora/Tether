import type { Route } from '../hooks';
import { ListRow } from '../ui/studio/ListRow';
import { RunGlyph } from '../ui/studio/RunGlyph';
import { RowList, Section } from '../ui/studio/Section';
import { ApproveButton } from './Goals';
import { goalMeta, type GoalView } from './goalsApi';

/** The goals with a proposed run waiting on the person. */
export const waitingGoals = (goals?: GoalView[]) => (goals ?? []).filter((g) => g.status === 'needs_you' && g.pending);

/** Home's Needs you rows for goals: the proposed run, with the amber Approve run in the row. Nothing when none wait. */
export function GoalsNeedYou(p: { goals?: GoalView[]; onGo: (r: Route) => void; onDone: (g: GoalView) => void }) {
  const waiting = waitingGoals(p.goals);
  if (!waiting.length) return null;
  return (
    <Section title="Goals waiting for you" count={waiting.length}>
      <RowList label="Goals waiting for you">
        {waiting.map((g) => (
          <ListRow key={g.id} lead={<RunGlyph state="needs" />} title={g.title} onOpen={() => p.onGo({ tab: 'goals', id: g.id })} meta={`${g.pending!.task.split('\n')[0]!.slice(0, 100)} · ${goalMeta(g)}`} actions={<ApproveButton goal={g} onDone={p.onDone} />} />
        ))}
      </RowList>
    </Section>
  );
}
