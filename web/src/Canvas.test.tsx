import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Canvas } from './Canvas';
import { cssRule, cssText } from './test/css';
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

  it('hovering a step tints its border without moving it off its ports', () => {
    expect(cssRule('canvas.css', '.node:hover')).toContain('border-color: var(--edge)');
    expect(cssRule('canvas.css', '.node:hover')).not.toContain('transform');
  });

  it('fits again when fitKey changes (another workflow opened)', async () => {
    const world = (c: HTMLElement) => (c.querySelector('.world') as HTMLElement).style.transform;
    const { container, rerender } = render(<Canvas nodes={[]} edges={[]} fitKey={0} />);
    await new Promise((r) => requestAnimationFrame(r));
    const before = world(container);
    rerender(<Canvas nodes={nodes} edges={edges} fitKey={1} />);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(world(container)).not.toBe(before);
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

  it('shows each step’s bot face with its mood, animated while it works', () => {
    const { container } = render(<Canvas nodes={nodes} edges={edges} statuses={run.nodes} />);
    expect(container.querySelectorAll('[data-node] [data-mood]')).toHaveLength(3);
    const code = container.querySelector('[data-id="code"] [data-mood]')!;
    expect(code.getAttribute('data-mood')).toBe('working');
    expect(code.tagName).toBe('SPAN');
    expect(container.querySelector('[data-id="gate"] [data-mood]')!.tagName).toBe('IMG');
  });

  it('marks run edges: done solid, working animated, next dashed', () => {
    const st = (s: string) => ({ status: s, attempts: 1, costUsd: 0, loops: 0 }) as (typeof run.nodes)[string];
    const { container, rerender } = render(<Canvas nodes={nodes} edges={edges} statuses={{ plan: st('done'), code: st('done'), gate: st('running') }} />);
    const edge = (from: string, to: string) => container.querySelector(`[data-edge="${from}→${to}"] + path.edge`)!;
    expect(edge('plan', 'code').classList.contains('done')).toBe(true);
    expect(edge('code', 'gate').classList.contains('flow')).toBe(true);
    rerender(<Canvas nodes={nodes} edges={edges} statuses={{ plan: st('done'), code: st('queued'), gate: st('queued') }} />);
    expect(edge('plan', 'code').classList.contains('next')).toBe(true);
    expect(edge('code', 'gate').getAttribute('class')).toBe('edge');
  });

  it('shows a step status chip on run cards only', () => {
    const { container, rerender } = render(<Canvas nodes={nodes} edges={edges} statuses={run.nodes} />);
    expect(container.querySelector('[data-id="code"] [data-status="loading"]')!.textContent).toBe('running');
    rerender(<Canvas nodes={nodes} edges={edges} />);
    expect(container.querySelector('.sl-badge')).toBeNull();
  });

  it('names the zoom buttons', () => {
    const { getByRole } = render(<Canvas nodes={nodes} edges={edges} />);
    for (const name of ['Zoom in', 'Zoom out', 'Fit to view']) expect(getByRole('button', { name })).toBeTruthy();
  });

  it('moves a fix loop only while its fix step re-runs', () => {
    const st = (status: string, loops = 0) => ({ status, attempts: 1, costUsd: 0, loops }) as never;
    const { container, rerender } = render(<Canvas nodes={nodes} edges={edges} />);
    const loop = () => container.querySelector('.loop')!;
    expect(loop().classList.contains('live')).toBe(false);
    rerender(<Canvas nodes={nodes} edges={edges} statuses={{ plan: st('done'), code: st('running'), gate: st('error', 1) }} />);
    expect(loop().classList.contains('live')).toBe(true);
    rerender(<Canvas nodes={nodes} edges={edges} statuses={{ plan: st('done'), code: st('done'), gate: st('done', 1) }} />);
    expect(loop().classList.contains('live')).toBe(false);
  });

  it('shows a hint over a canvas with steps and none over an empty one', () => {
    const { container, rerender } = render(<Canvas editable nodes={nodes} edges={edges} hint="Delete removes" />);
    expect(container.querySelector('.canvas-hint')!.textContent).toBe('Delete removes');
    rerender(<Canvas editable nodes={[]} edges={[]} hint="Delete removes" />);
    expect(container.querySelector('.canvas-hint')).toBeNull();
  });

  it('is styled from tokens in its own stylesheet, and only live parts loop', () => {
    const css = cssText('canvas.css');
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(cssRule('canvas.css', '.edge')).toContain('stroke: var(--edge)');
    expect(cssRule('canvas.css', '.loop path')).toContain('stroke: var(--warn)');
    expect(cssRule('canvas.css', '.loop path')).not.toContain('animation');
    expect(cssRule('canvas.css', '.loop.live path')).toContain('animation');
    expect(cssRule('canvas.css', '.node.selected')).toContain('box-shadow: 0 0 0 3px var(--accBg)');
    expect(cssText('styles.css')).not.toMatch(/\.canvas|\.node-head|\.port\b|\.zoom\b|\.empty-hint/);
  });
});
