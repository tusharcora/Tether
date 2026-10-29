import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeRun } from '../test/fixtures';
import { PlanCard } from './PlanCard';

const run = () => {
  const base = makeRun({ costUsd: 1.4 });
  return makeRun({
    costUsd: 1.4,
    pipeline: { ...base.pipeline, settings: { ...base.pipeline.settings, maxCostUsd: 5 }, nodes: [...base.pipeline.nodes, { id: 'ship', kind: 'approval', title: 'Open a PR', x: 780, y: 0 }] },
    nodes: { ...base.nodes, code: { status: 'running', attempts: 1, costUsd: 0.07, loops: 0, live: '[tool] Read src/limit.ts\n[tool] Bash npm test\n' } },
  });
};

describe('PlanCard', () => {
  it('lists the steps with their state, the live one’s latest activity (newest highlighted), the approval as Asks first, spend of the cap', () => {
    render(<PlanCard run={run()} />);
    const card = screen.getByRole('region', { name: 'Plan' });
    expect(card.querySelector('.plan-cost')!.textContent).toBe('$1.40 of $5.00');
    const steps = within(card).getAllByRole('img').map((i) => i.getAttribute('aria-label'));
    expect(steps).toEqual(['done', 'working', 'queued', 'asks first']);
    expect(within(card).getByText('Asks first').className).toBe('sl-tag t-asks');
    const subs = within(card).getByRole('list', { name: 'coder: latest' });
    expect(subs.getAttribute('aria-live')).toBe('polite');
    expect([...subs.querySelectorAll('li')].map((li) => [li.textContent, li.className])).toEqual([
      ['Read src/limit.ts', ''],
      ['Run npm test', 'newest'],
    ]);
  });

  it('compact: the step track, the current step and its newest activity, spend', () => {
    render(<PlanCard run={run()} compact />);
    const card = screen.getByRole('region', { name: 'Plan' });
    expect(within(card).getByRole('img', { name: '1 of 4 steps done, 1 working, 1 asks first' })).toBeTruthy();
    expect(card.querySelector('.plan-now')!.textContent).toBe('coder · Run npm test');
    expect(card.querySelector('.plan-cost')!.textContent).toBe('$1.40 of $5.00');
  });
});
