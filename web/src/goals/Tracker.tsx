import { useState } from 'react';
import { TodoList, type TodoItem } from '../components/beui/agents/todo-list';
import { Button } from '../components/beui/kit/Button';
import type { Route } from '../hooks';
import type { GoalView } from './goalsApi';
import './goals.css';

/** A tracker: a checklist of manual items and linked runs, an add-item field and the way to turn it into a loop. */
export function Tracker(p: { goal: GoalView; onToggle: (item: number, done: boolean) => void; onAdd: (text: string) => void; onToLoop: () => void; onGo: (r: Route) => void }) {
  const [text, setText] = useState('');
  const items: TodoItem[] = p.goal.items.map((i) => {
    const run = i.kind === 'run';
    const done = i.done || i.runStatus === 'done';
    return {
      id: String(i.id),
      status: done ? 'completed' : run && i.runStatus === 'running' ? 'in-progress' : 'pending',
      title: run ? (
        <span className="gt-item">
          <span>{i.text.split('\n')[0]}</span>
          <button type="button" className="gt-run" onClick={() => p.onGo({ tab: 'runs', id: i.runId })}>
            {i.runId} · {i.runStatus ?? 'unknown'}
          </button>
        </span>
      ) : (
        <button type="button" className="gt-toggle" role="checkbox" aria-checked={done} onClick={() => p.onToggle(i.id, !done)}>
          {i.text}
        </button>
      ),
    };
  });
  const done = p.goal.items.filter((i) => i.done || i.runStatus === 'done').length;
  return (
    <div className="gt">
      <div className="gt-head">
        <span>
          {done} of {p.goal.items.length} done
        </span>
        <span className="mut">{p.goal.dueDate ? `Due ${p.goal.dueDate}` : 'No due date'}</span>
      </div>
      <div className="gt-bar" role="progressbar" aria-label="Checklist progress" aria-valuenow={Math.round(p.goal.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${p.goal.progress * 100}%` }} />
      </div>
      {items.length ? <TodoList items={items} title="Checklist" collapseOnComplete={false} maxHeight={420} /> : <p className="mut">Nothing on the list yet.</p>}
      <form
        className="gt-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          p.onAdd(text.trim());
          setText('');
        }}
      >
        <input className="gf-input" aria-label="Add an item" placeholder="Add an item" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" size="sm" variant="secondary" disabled={!text.trim()}>
          Add
        </Button>
      </form>
      <Button variant="ghost" size="sm" onClick={p.onToLoop}>
        Add a finish check → turn into a loop
      </Button>
    </div>
  );
}
