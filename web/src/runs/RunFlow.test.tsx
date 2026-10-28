import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeRun } from '../test/fixtures';
import { renderApp } from '../test/render';
import { layout, RunFlow } from './RunFlow';

describe('layout', () => {
  it('puts each step one column right of its latest input', () => {
    const p = layout([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }]);
    expect(p.a!.x).toBe(0);
    expect(p.b!.x).toBe(p.c!.x);
    expect(p.d!.x).toBeGreaterThan(p.b!.x);
    expect(p.b!.y).not.toBe(p.c!.y);
  });
});

describe('the expanded run flow', () => {
  it('draws a node per step with a fan of the run actions, opens its log, and shows gate buttons in plain view', () => {
    const run = makeRun({ nodes: { ...makeRun().nodes, gate: { status: 'error', attempts: 2, costUsd: 0, loops: 1 } } });
    run.pipeline.nodes.push({ id: 'ship', kind: 'approval', x: 0, y: 0 } as never);
    run.pipeline.edges.push({ from: 'gate', to: 'ship' });
    run.nodes.ship = { status: 'awaiting', attempts: 0, costUsd: 0, loops: 0 };
    const onSelect = vi.fn();
    const onAct = vi.fn(async () => true);
    const { container } = renderApp(<RunFlow run={run} onSelect={onSelect} onAct={onAct} />);
    expect(container.querySelectorAll('.rf-node')).toHaveLength(4);
    expect(container.querySelector('.rf-loop')).toBeTruthy(); // the gate's fix loop, amber and dashed
    const fan = within(screen.getByRole('toolbar', { name: 'coder actions' }));
    expect(fan.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Open logs', 'Retry from here', 'View diff', 'Pause run']);
    expect((fan.getByRole('button', { name: 'Retry from here' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('editing…')).toBeTruthy(); // the live line
    fireEvent.click(screen.getByRole('button', { name: /^coder, running/ }));
    expect(onSelect).toHaveBeenCalledWith('code');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onAct).toHaveBeenCalledWith('approve', { node: 'ship', approved: false });
  });
});
