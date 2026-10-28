import { useCallback } from 'react';
import type { AttentionItem } from '../api';
import { usePoll, type Route } from '../hooks';
import { ScreenHeader } from '../ui/studio/ScreenHeader';
import { GoalsNeedYou } from '../goals/GoalsNeedYou';
import type { GoalView } from '../goals/goalsApi';
import { NeedsYou } from './NeedsYou';
import './home.css';

/** How often the Inbox refreshes while it is open. */
export const INBOX_MS = 3000;

/**
 * Inbox (`#/inbox`): what needs you — questions, plans, approvals, paused and failed runs — with the same inline actions
 * as Home's "Needs you" section, on its own screen.
 */
export function Inbox(props: { onGo: (r: Route) => void; goals?: GoalView[]; onGoal?: (g: GoalView) => void }) {
  const attention = usePoll<{ items: AttentionItem[] }>('/api/attention', INBOX_MS);
  const { refresh } = attention;
  const refetch = useCallback(() => refresh(), [refresh]);
  const n = attention.data?.items.length ?? 0;
  return (
    <div className="home inbox">
      <ScreenHeader meta={attention.data ? `${n} item${n === 1 ? '' : 's'}` : undefined} title="Inbox" summary="Questions, plans and approvals from your runs, and runs that stopped." />
      <div className="home-grid">
        <GoalsNeedYou goals={props.goals} onGo={props.onGo} onDone={(g) => props.onGoal?.(g)} />
        <NeedsYou poll={attention} refreshing={false} onGo={props.onGo} onChanged={refetch} />
      </div>
    </div>
  );
}
