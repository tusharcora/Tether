import type { ReactNode } from 'react';
import { TodoList, type TodoItem, type TodoItemStatus } from '../../components/beui/agents/todo-list';
import type { StepLike } from './steps';

/** A step's status as a to-do: queued waits, running and awaiting are in progress, done is completed; failed and skipped steps are crossed out with their reason. */
const MAP: Record<string, { status: TodoItemStatus; detail?: string }> = {
  queued: { status: 'pending' },
  running: { status: 'in-progress' },
  awaiting: { status: 'in-progress', detail: 'waits for you' },
  done: { status: 'completed' },
  error: { status: 'cancelled', detail: 'failed' },
  skipped: { status: 'cancelled', detail: 'skipped' },
};

export function stepTodos(steps: StepLike[]): TodoItem[] {
  return steps.map((s) => {
    const m = MAP[s.status] ?? MAP.queued!;
    return { id: s.id, title: s.title ?? s.id, status: m.status, ...(m.detail ? { detail: m.detail } : {}) };
  });
}

/**
 * A run's steps as beui's to-do list: a completion count in the header, a morphing mark per step, the list opening and
 * closing smoothly. It stays open as the run finishes (the run page and Home keep showing what happened).
 */
export function StepTodos(props: { steps: StepLike[]; title?: ReactNode; defaultOpen?: boolean; className?: string }) {
  if (!props.steps.length) return null;
  return <TodoList items={stepTodos(props.steps)} title={props.title ?? 'Steps'} defaultOpen={props.defaultOpen ?? true} collapseOnComplete={false} maxHeight={240} className={props.className} />;
}
