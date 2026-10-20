import { describe, expect, it } from 'vitest';
import { box, clip, detectColorLevel, gradient, meter, renderBoard, strip, vlen } from '../src/ui.js';
import { foldRun } from '../src/types.js';

describe('ui', () => {
  it('detects colour level and honours NO_COLOR / non-TTY', () => {
    expect(detectColorLevel({ NO_COLOR: '1' }, true)).toBe(0);
    expect(detectColorLevel({}, false)).toBe(0);
    expect(detectColorLevel({ COLORTERM: 'truecolor' }, true)).toBe(3);
    expect(detectColorLevel({ TERM: 'xterm-256color' }, true)).toBe(2);
    expect(detectColorLevel({ TERM: 'xterm' }, true)).toBe(1);
  });

  it('measures and clips visible width, ignoring ANSI', () => {
    const s = '\x1b[31mhello\x1b[0m world';
    expect(vlen(s)).toBe(11);
    expect(vlen(clip(s, 6))).toBe(6);
    expect(strip(gradient('abc'))).toBe('abc');
  });

  it('draws boxes whose every row has the same visible width', () => {
    const rows = box(['short', '\x1b[32mcoloured line\x1b[0m', 'x'.repeat(200)], { title: 'T', footer: 'F', width: 50 });
    for (const r of rows) expect(vlen(r)).toBe(50);
  });

  it('meter has a fixed width', () => {
    for (const f of [0, 0.3, 1, 2, -1]) expect(vlen(meter(f, 12))).toBe(12);
  });

  it('renders a run board with aligned rows from folded events', () => {
    const pipeline = {
      name: 'p', version: 1, mode: 'pipeline' as const, settings: { maxCostUsd: 5 },
      nodes: [{ id: 'a', kind: 'agent' as const, role: 'coder', agent: 'mock' }, { id: 'g', kind: 'gate' as const, command: 'true' }],
      edges: [{ from: 'a', to: 'g' }],
    };
    const state = foldRun([
      { runId: 'r', seq: 1, ts: 1000, event: { type: 'run.started', pipeline, task: 't', repo: '/r', workdir: '/w', baseSha: 'x', branch: 'b', autoApprove: false } },
      { runId: 'r', seq: 2, ts: 1100, event: { type: 'node.started', node: 'a', attempt: 1 } },
    ] as never)!;
    const board = renderBoard({ state, frame: 3, now: 2000 }, 70);
    expect(board.length).toBeGreaterThanOrEqual(4);
    for (const l of board) expect(vlen(l)).toBe(70);
    expect(strip(board.join('\n'))).toContain('coder');
  });
});
