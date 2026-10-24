import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Canvas } from './Canvas';
import { makeRun } from './test/fixtures';

const run = makeRun();
const nodes = run.pipeline.nodes;
const edges = run.pipeline.edges;

describe('Canvas', () => {
  it('draws nodes, edges and fix loops', () => {
    const { container } = render(<Canvas nodes={nodes} edges={edges} statuses={run.nodes} />);
    expect(container.querySelectorAll('[data-node]')).toHaveLength(3);
    expect(container.querySelectorAll('path.edge')).toHaveLength(2);
    expect(container.textContent).toContain('fix loop 0/2');
    expect(container.textContent).toContain('$ npm test');
  });

  it('selects a node on click and clears on empty canvas click', () => {
    const onSelect = vi.fn();
    const { container } = render(<Canvas nodes={nodes} edges={edges} onSelect={onSelect} />);
    const code = container.querySelector('[data-id="code"] .node-body')!;
    fireEvent.pointerDown(code, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onSelect).toHaveBeenLastCalledWith('code');
    const canvas = container.querySelector('.canvas')!;
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 5, clientY: 5 });
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });

  it('deletes the selected node with Delete when editable', () => {
    const onDeleteNode = vi.fn();
    const { container } = render(<Canvas editable nodes={nodes} edges={edges} selected="gate" onDeleteNode={onDeleteNode} />);
    fireEvent.keyDown(container.querySelector('.canvas')!, { key: 'Delete' });
    expect(onDeleteNode).toHaveBeenCalledWith('gate');
  });

  it('connects an out port to an in port', () => {
    const onConnect = vi.fn();
    const { container } = render(<Canvas editable nodes={nodes} edges={[]} onConnect={onConnect} />);
    const out = container.querySelector('[data-port-out][data-id="plan"]')!;
    const target = container.querySelector('[data-port-in][data-id="gate"]')!;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
    const canvas = container.querySelector('.canvas')!;
    fireEvent.pointerDown(out, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 300, clientY: 40 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 300, clientY: 40 });
    expect(onConnect).toHaveBeenCalledWith('plan', 'gate');
  });

  it('shows the empty hint without nodes', () => {
    const { container } = render(<Canvas nodes={[]} edges={[]} />);
    expect(container.textContent).toContain('Add a step from the palette');
  });
});
