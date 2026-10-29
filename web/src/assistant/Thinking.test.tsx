import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cssText } from '../test/css';
import type { ToolRun } from './api';
import { Thinking } from './Thinking';

const tools: ToolRun[] = [
  { id: 't1', code: 'return repo.search("history")', output: '[]', ms: 20 },
  { id: 't2', code: 'await repo.read("src/a.ts"); await repo.read("src/b.ts"); await repo.read("c.ts"); await repo.read("d.ts"); return repo.read("e.ts")', output: 'x', ms: 30 },
  { id: 't3', code: 'return repo.read("nope.ts")', output: 'Error: no such file', isError: true },
  { id: 't4', code: 'return tether.runs.get("R-7D92")' },
];

describe('Thinking', () => {
  it('while streaming: a live clock, the steps as they come, the current one live and announced politely', () => {
    render(<Thinking tools={tools} startedAt={Date.now() - 4200} />);
    const head = screen.getByRole('button', { expanded: true });
    expect(head.textContent).toBe('Thinking4s');
    const list = screen.getByRole('list', { name: 'Thinking steps' });
    expect(list.getAttribute('aria-live')).toBe('polite');
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-step'))).toEqual(['done', 'done', 'dead', 'live']);
    expect(items[3]!.querySelector('.th-shimmer')!.textContent).toBe('Opened run R-7D92');
    expect(items[2]!.textContent).toBe('Dead end: no such file');
    // five files: four chips and "+1 more"
    expect(items[1]!.querySelectorAll('.sl-chip')).toHaveLength(4);
    expect(items[1]!.textContent).toContain('+1 more');
    expect(screen.queryByText('Finished thinking')).toBeNull();
  });

  it('once finished: "Thought for Ns", collapsed until clicked, with a Finished thinking row', () => {
    render(<Thinking tools={tools.slice(0, 2)} ms={14_300} />);
    const head = screen.getByRole('button', { name: 'Thought for 14s' });
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(head);
    expect(screen.getByRole('list').getAttribute('aria-live')).toBeNull();
    expect(screen.getByText('Finished thinking').parentElement!.textContent).toBe('Finished thinking · 2 calls · 5 files');
  });

  it('stops shimmer, spin and fade for reduced motion', () => {
    const css = cssText('assistant/assistant.css');
    expect(css).toContain('@media (prefers-reduced-motion: reduce) { .th-shimmer { -webkit-mask-image: none; mask-image: none; } }');
  });
});
