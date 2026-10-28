import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Pipeline } from '../../../src/types';
import { makeRun } from '../test/fixtures';
import { chainOrder, rechain, StepOrder } from './StepOrder';

const pcr = (): Pipeline => structuredClone(makeRun().pipeline);

describe('step order', () => {
  it('finds the run order of a straight chain, and nothing for a graph', () => {
    expect(chainOrder(pcr())).toEqual(['plan', 'code', 'gate']);
    const fork = pcr();
    fork.edges.push({ from: 'plan', to: 'gate' });
    expect(chainOrder(fork)).toBeUndefined();
    const loose = pcr();
    loose.edges = [{ from: 'plan', to: 'code' }];
    expect(chainOrder(loose)).toBeUndefined();
    const one = pcr();
    one.nodes = one.nodes.slice(0, 1);
    one.edges = [];
    expect(chainOrder(one)).toBeUndefined();
    const swarm = pcr();
    swarm.mode = 'swarm';
    expect(chainOrder(swarm)).toBeUndefined();
  });

  it('rechains the steps in a new order: new edges, and each step moved to its place along the row', () => {
    const pl = pcr();
    pl.nodes[0]!.y = 40;
    rechain(pl, ['gate', 'plan', 'code']);
    expect(pl.edges).toEqual([{ from: 'gate', to: 'plan' }, { from: 'plan', to: 'code' }]);
    expect(pl.nodes.map((n) => n.id)).toEqual(['gate', 'plan', 'code']);
    expect(pl.nodes.map((n) => n.x)).toEqual([0, 260, 520]);
    expect(pl.nodes.find((n) => n.id === 'plan')!.y).toBe(40);
    expect(chainOrder(pl)).toEqual(['gate', 'plan', 'code']);
  });

  it('lists the steps in order, moves one with its handle’s arrow keys, and says where it went', () => {
    const mut = vi.fn();
    render(<StepOrder pl={pcr()} mut={mut} />);
    const names = () => screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(names()[0]).toContain('planner');
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Reorder planner', 'Reorder coder', 'Reorder gate']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder gate' }), { key: 'ArrowUp' });
    expect(mut).toHaveBeenCalledTimes(1);
    const draft = pcr();
    (mut.mock.calls[0]![0] as (p: Pipeline) => void)(draft);
    expect(chainOrder(draft)).toEqual(['plan', 'gate', 'code']);
    expect(screen.getByRole('status').textContent).toContain('gate moved to position 2 of 3.');
  });

  it('says a branching workflow has no single order, and shows nothing for fewer than two steps', () => {
    const fork = pcr();
    fork.edges.push({ from: 'plan', to: 'gate' });
    const { container, rerender } = render(<StepOrder pl={fork} mut={vi.fn()} />);
    expect(screen.getByText(/connected as a graph/)).toBeTruthy();
    const one = pcr();
    one.nodes = one.nodes.slice(0, 1);
    one.edges = [];
    rerender(<StepOrder pl={one} mut={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});
