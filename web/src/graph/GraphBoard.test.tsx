import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { VaultGraph } from '../api';
import { cssRule, cssText } from '../test/css';
import { GraphBoard, type GraphBoardProps } from './GraphBoard';
import { TYPES, type GraphType } from './graphModel';

const graph: VaultGraph = {
  nodes: [
    { id: 'runs/r1.md', title: 'Run r1', type: 'run', tags: [], degree: 2 },
    { id: 'roles/coder.md', title: 'Coder', type: 'role', tags: [], degree: 2 },
    { id: 'files/a.md', title: 'a.ts', type: 'file', tags: [], degree: 1 },
    { id: 'notes/x.md', title: 'Loose note', tags: [], degree: 1 },
  ],
  edges: [
    { from: 'runs/r1.md', to: 'roles/coder.md' },
    { from: 'roles/coder.md', to: 'files/a.md' },
    { from: 'runs/r1.md', to: 'notes/x.md' },
  ],
  unresolved: 0,
};
const none: ReadonlySet<string> = new Set();
const props = (o: Partial<GraphBoardProps> = {}) => ({
  graph,
  hiddenTypes: new Set<GraphType>(),
  near: none,
  hits: none,
  fresh: none,
  reduced: true,
  onHover: vi.fn(),
  onSelect: vi.fn(),
  onOpen: vi.fn(),
  ...o,
});
const node = (c: HTMLElement, id: string) => c.querySelector(`[data-gn="${id}"]`)!;

describe('GraphBoard', () => {
  it('draws each type as its own shape and names notes for screen readers', async () => {
    const { container } = render(<GraphBoard {...props()} />);
    expect(await screen.findByRole('button', { name: 'Run r1, run, 2 links' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'a.ts, file, 1 link' })).toBeTruthy();
    expect(['runs/r1.md', 'roles/coder.md', 'files/a.md', 'notes/x.md'].map((id) => node(container, id).getAttribute('class'))).toEqual([
      expect.stringContaining('t-run'), expect.stringContaining('t-role'), expect.stringContaining('t-file'), expect.stringContaining('t-note'),
    ]);
    expect(node(container, 'runs/r1.md').querySelector('.gb-shape')!.getAttribute('d')).toMatch(/^M-[\d.]+,-[\d.]+h/);
  });

  it('selects on click, opens on double-click and Enter, and clears on the background', async () => {
    const p = props();
    const { container } = render(<GraphBoard {...p} />);
    const r1 = await screen.findByRole('button', { name: /^Run r1,/ });
    fireEvent.click(r1);
    expect(p.onSelect).toHaveBeenLastCalledWith('runs/r1.md');
    fireEvent.doubleClick(r1);
    fireEvent.keyDown(r1, { key: 'Enter' });
    expect(p.onOpen).toHaveBeenCalledTimes(2);
    const svg = container.querySelector('.gb-svg')!;
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 5, clientY: 5 });
    expect(p.onSelect).toHaveBeenLastCalledWith(undefined);
    fireEvent.pointerEnter(r1);
    expect(p.onHover).toHaveBeenLastCalledWith('runs/r1.md');
  });

  it('dims what is outside the focus, and outside the search hits while searching', async () => {
    const { container, rerender } = render(<GraphBoard {...props({ selected: 'runs/r1.md', focus: 'runs/r1.md', near: new Set(['runs/r1.md', 'roles/coder.md', 'notes/x.md']) })} />);
    await screen.findByRole('button', { name: /^Run r1,/ });
    const dim = () => [...container.querySelectorAll('.gb-node.dim')].map((e) => e.getAttribute('data-gn'));
    expect(dim()).toEqual(['files/a.md']);
    expect(container.querySelectorAll('.gb-edge.hot')).toHaveLength(2);
    rerender(<GraphBoard {...props({ hits: new Set(['files/a.md']) })} />);
    expect(dim()).toEqual(['runs/r1.md', 'roles/coder.md', 'notes/x.md']);
  });

  it('puts only the focused neighbourhood in the tab order', async () => {
    const { container } = render(<GraphBoard {...props({ selected: 'runs/r1.md', near: new Set(['runs/r1.md', 'roles/coder.md']) })} />);
    await screen.findByRole('button', { name: /^Run r1,/ });
    expect(['runs/r1.md', 'roles/coder.md', 'files/a.md'].map((id) => node(container, id).getAttribute('tabindex'))).toEqual(['0', '0', '-1']);
  });

  it('pings notes a run just wrote and pulses search matches', async () => {
    const { container } = render(<GraphBoard {...props({ fresh: new Set(['roles/coder.md']), hits: new Set(['files/a.md']) })} />);
    await screen.findByRole('button', { name: /^Coder,/ });
    expect(node(container, 'roles/coder.md').querySelector('.gb-ping')).toBeTruthy();
    expect(node(container, 'files/a.md').querySelector('.gb-match')).toBeTruthy();
    expect(node(container, 'runs/r1.md').querySelector('.gb-ping, .gb-match')).toBeNull();
  });

  it('zooms, fits and re-runs the layout from its tools', async () => {
    const { container } = render(<GraphBoard {...props()} />);
    const r1 = await screen.findByRole('button', { name: /^Run r1,/ });
    const world = () => container.querySelector('.gb-svg > g')!.getAttribute('transform');
    const fitted = world();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(world()).not.toBe(fitted);
    fireEvent.click(screen.getByRole('button', { name: 'Fit all notes' }));
    expect(world()).toBe(fitted);
    const at = r1.getAttribute('transform');
    fireEvent.click(screen.getByRole('button', { name: 'Re-run the layout' }));
    expect(r1.getAttribute('transform')).not.toBe(at);
  });

  it('drags a note without selecting it', async () => {
    const p = props();
    const { container } = render(<GraphBoard {...p} />);
    const coder = await screen.findByRole('button', { name: /^Coder,/ });
    const before = coder.getAttribute('transform');
    const svg = container.querySelector('.gb-svg')!;
    fireEvent.pointerDown(coder, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 80, clientY: 60 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 80, clientY: 60 });
    fireEvent.click(coder);
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(coder.getAttribute('transform')).not.toBe(before);
  });

  it('selects on a press and release under the drag threshold, with real pointer events and no click', async () => {
    const p = props();
    const { container } = render(<GraphBoard {...p} />);
    const coder = await screen.findByRole('button', { name: /^Coder,/ });
    const svg = container.querySelector('.gb-svg')!;
    fireEvent.pointerDown(coder, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 12, clientY: 12 });
    fireEvent.pointerUp(coder, { pointerId: 1, clientX: 12, clientY: 12 });
    expect(p.onSelect).toHaveBeenCalledTimes(1);
    expect(p.onSelect).toHaveBeenLastCalledWith('roles/coder.md');
    // the click a browser may still send afterwards does not select twice
    fireEvent.click(coder);
    expect(p.onSelect).toHaveBeenCalledTimes(1);
  });

  it('releases a dragged note when the pointer is cancelled, so the layout loop stops', async () => {
    const q: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => q.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const flush = (max = 3000) => {
      let n = 0;
      while (q.length && n++ < max) q.shift()!(performance.now() + 10_000);
      return q.length;
    };
    try {
      const p = props({ reduced: false });
      const { container } = render(<GraphBoard {...p} />);
      act(() => void flush());
      const coder = screen.getByRole('button', { name: /^Coder,/ });
      const svg = container.querySelector('.gb-svg')!;
      fireEvent.pointerDown(coder, { pointerId: 1, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(svg, { pointerId: 1, clientX: 80, clientY: 60 });
      // a second finger does not take the drag over
      fireEvent.pointerDown(svg, { pointerId: 2, clientX: 200, clientY: 200 });
      fireEvent.pointerUp(svg, { pointerId: 2, clientX: 200, clientY: 200 });
      act(() => void flush(50));
      expect(q.length).toBe(1);
      fireEvent.pointerCancel(svg, { pointerId: 1 });
      let left = -1;
      act(() => void (left = flush()));
      expect(left).toBe(0);
      expect(p.onSelect).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ends a drag when pointer capture is lost', async () => {
    const p = props();
    const { container } = render(<GraphBoard {...p} />);
    const coder = await screen.findByRole('button', { name: /^Coder,/ });
    const svg = container.querySelector('.gb-svg')!;
    fireEvent.pointerDown(coder, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 80, clientY: 60 });
    fireEvent.lostPointerCapture(svg, { pointerId: 1 });
    const at = coder.getAttribute('transform');
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 200, clientY: 160 });
    expect(coder.getAttribute('transform')).toBe(at);
  });

  it('says so when every type is hidden', async () => {
    render(<GraphBoard {...props({ hiddenTypes: new Set(TYPES) })} />);
    expect(await screen.findByText('All note types are hidden. Turn one back on above.')).toBeTruthy();
  });

  it('runs flowing dashes along the hovered note\'s links only while the pointer is over it', async () => {
    const p = props({ selected: 'roles/coder.md', focus: 'roles/coder.md', near: new Set(['runs/r1.md', 'roles/coder.md', 'files/a.md']) });
    const { container } = render(<GraphBoard {...p} />);
    const r1 = await screen.findByRole('button', { name: /^Run r1,/ });
    const flowing = () => [...container.querySelectorAll('.gb-edge.flow')].map((e) => e.getAttribute('data-ge'));
    // at rest the selected note's links are a still accent line
    expect(flowing()).toEqual([]);
    expect(container.querySelectorAll('.gb-edge.hot')).toHaveLength(2);
    fireEvent.pointerEnter(r1);
    expect(flowing()).toEqual(['runs/r1.md→roles/coder.md', 'runs/r1.md→notes/x.md']);
    fireEvent.pointerLeave(r1);
    expect(flowing()).toEqual([]);
  });

  it('does not flow while searching', async () => {
    const { container } = render(<GraphBoard {...props({ hits: new Set(['files/a.md']) })} />);
    fireEvent.pointerEnter(await screen.findByRole('button', { name: /^Run r1,/ }));
    expect(container.querySelectorAll('.gb-edge.flow')).toHaveLength(0);
  });

  it('is styled from tokens, and loops only for the run ping and the hover flow', () => {
    const css = cssText('graph/graph.css');
    expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(cssRule('graph/graph.css', '.gb-match')).toContain('animation: gb-match 1.1s ease-in-out 3');
    expect(cssRule('graph/graph.css', '.gb-ping')).toContain('infinite');
    expect(cssRule('graph/graph.css', '.gb-edge.flow')).toContain('infinite');
    expect(cssRule('graph/graph.css', '.gb-edge.flow')).toContain('stroke-dasharray');
    expect(css.match(/infinite/g)).toHaveLength(2);
    expect(cssRule('graph/graph.css', '.gb-edge.hot')).not.toContain('animation');
  });
});
