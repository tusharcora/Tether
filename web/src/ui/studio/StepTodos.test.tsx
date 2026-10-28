import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepTodos, stepTodos } from './StepTodos';

describe('StepTodos', () => {
  it('maps step statuses to to-do statuses with a reason for crossed-out steps', () => {
    const items = stepTodos([
      { id: 'a', status: 'queued', title: 'Plan' },
      { id: 'b', status: 'running' },
      { id: 'c', status: 'awaiting' },
      { id: 'd', status: 'done' },
      { id: 'e', status: 'error' },
      { id: 'f', status: 'skipped' },
    ]);
    expect(items.map((i) => i.status)).toEqual(['pending', 'in-progress', 'in-progress', 'completed', 'cancelled', 'cancelled']);
    expect(items.map((i) => i.detail)).toEqual([undefined, undefined, 'waits for you', undefined, 'failed', 'skipped']);
    expect(items[0]!.title).toBe('Plan');
    expect(items[1]!.title).toBe('b');
  });

  it('lists the steps under a title with a completion count, and renders nothing for no steps', () => {
    const { container, rerender } = render(<StepTodos title="Team plan" steps={[{ id: 'a', status: 'done', title: 'Write it' }, { id: 'b', status: 'running', title: 'Review it' }]} />);
    expect(screen.getByText('Team plan')).toBeTruthy();
    expect(screen.getByText('Write it')).toBeTruthy();
    expect(screen.getByText('Review it')).toBeTruthy();
    rerender(<StepTodos steps={[]} />);
    expect(container.textContent).toBe('');
  });
});
