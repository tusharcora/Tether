import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoalView } from '../goals/goalsApi';
import { GoalsPanel, goalsPanelOpen, rememberGoalsPanel } from './GoalsPanel';

const goal = (o: Partial<GoalView>): GoalView => ({ id: 'g', workspace: 'shop', title: 'Goal', kind: 'tracker', status: 'active', approval: 'ask', workflow: 'team', createdAt: Date.now(), spentUsd: 0, items: [], progress: 0, ...o });

describe('Goals · next beside a chat', () => {
  beforeEach(() => sessionStorage.clear());

  it('lists the project’s open goals, this chat’s own first with its faces and "from this chat"', () => {
    const onGo = vi.fn();
    const goals = [
      goal({ id: 'g1', title: 'Dark mode for settings', kind: 'loop', maxRuns: 4, items: [{ id: 1, goalId: 'g1', kind: 'run', text: 'x', done: false, at: 1 }] }),
      goal({ id: 'g2', title: 'Sign-in returns people to where they were', type: 'bugfix', team: 't1', origin: { kind: 'chat', chat: 'c1', message: 'm1' } }),
      goal({ id: 'g3', title: 'Shipped already', status: 'met' }),
      goal({ id: 'g4', title: 'Another project', workspace: 'other' }),
    ];
    render(<GoalsPanel goals={goals} project="shop" chatId="c1" onGo={onGo} teamName={(id) => (id === 't1' ? 'web' : id)} />);
    const panel = screen.getByRole('complementary', { name: 'Goals next' });
    const rows = within(panel).getAllByRole('button').filter((b) => b.className.includes('cg-goal'));
    expect(rows.map((b) => b.querySelector('b')!.textContent)).toEqual(['Sign-in returns people to where they were', 'Dark mode for settings']);
    expect(rows[0]!.getAttribute('aria-current')).toBe('true');
    expect(within(rows[0]!).getByText('# web · just now · from this chat')).toBeTruthy();
    expect(within(rows[0]!).getByRole('img', { name: 'Assigned to t1' })).toBeTruthy();
    expect(within(rows[1]!).getByText('Live · loop · 1 of 4 runs')).toBeTruthy();
    fireEvent.click(rows[1]!);
    expect(onGo).toHaveBeenLastCalledWith({ tab: 'goals', id: 'g1' });
    fireEvent.click(within(panel).getByRole('button', { name: 'All goals' }));
    expect(onGo).toHaveBeenLastCalledWith({ tab: 'goals' });
  });

  it('remembers whether it is shown, per window', () => {
    expect(goalsPanelOpen()).toBe(true);
    rememberGoalsPanel(false);
    expect(goalsPanelOpen()).toBe(false);
    rememberGoalsPanel(true);
    expect(goalsPanelOpen()).toBe(true);
  });
});
