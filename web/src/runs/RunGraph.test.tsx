import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cssRule } from '../test/css';
import { makeRun } from '../test/fixtures';
import { renderApp } from '../test/render';
import { RunGraph } from './RunGraph';

describe('RunGraph fans', () => {
  it('gives each card a fan of the run actions when it can act, keyboard reachable on the selected card', () => {
    const onAct = vi.fn(async () => true);
    const onSelect = vi.fn();
    const { container } = renderApp(<RunGraph run={makeRun()} selected="code" onSelect={onSelect} onAct={onAct} onViewDiff={() => {}} />);
    const codeFan = container.querySelector('[data-id="code"]')!.parentElement!.querySelector('[role="toolbar"]')!;
    expect([...codeFan.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Open logs', 'Retry from here', 'View diff', 'Pause run']);
    expect((codeFan.querySelector('button') as HTMLButtonElement).tabIndex).toBe(0);
    fireEvent.click(codeFan.querySelector('[aria-label="Pause run"]')!);
    expect(onAct).toHaveBeenCalledWith('stop');
    fireEvent.click(codeFan.querySelector('[aria-label="Open logs"]')!);
    expect(onSelect).toHaveBeenCalledWith('code');
  });
  it('draws no fan without an act handler', () => {
    const { container } = renderApp(<RunGraph run={makeRun()} onSelect={() => {}} />);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });
});

describe('RunGraph', () => {
  it('draws one card per step with name, role · agent and state, and selects on click', () => {
    const onSelect = vi.fn();
    const { container } = renderApp(<RunGraph run={makeRun()} onSelect={onSelect} />);
    const code = container.querySelector('[data-id="code"]')!;
    expect(code.className).toContain('s-loading');
    expect(code.getAttribute('aria-label')).toMatch(/writing$/);
    expect(code.textContent).toContain('coder · claude');
    expect(container.querySelector('[data-id="gate"]')!.textContent).toContain('npm test');
    fireEvent.click(code);
    expect(onSelect).toHaveBeenCalledWith('code');
    expect(container.querySelectorAll('.rg-edge')).toHaveLength(2);
    expect(container.querySelector('.rg-edge.e-live')).toBeTruthy();
    expect(container.querySelector('.rg-dot animateMotion')).toBeTruthy();
  });
  it('marks the selected card', () => {
    const { container } = renderApp(<RunGraph run={makeRun()} selected="plan" onSelect={() => {}} />);
    expect(container.querySelector('[data-id="plan"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-id="code"]')!.getAttribute('aria-pressed')).toBe('false');
  });
  it('renders nothing for a run with no steps yet', () => {
    const { container } = renderApp(<RunGraph run={makeRun({ pipeline: { ...makeRun().pipeline, nodes: [], edges: [] } })} onSelect={() => {}} />);
    expect(container.querySelector('.rg')).toBeNull();
  });
  it('keeps the moving dot still under reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    const { container } = renderApp(<RunGraph run={makeRun()} onSelect={() => {}} />);
    expect(container.querySelector('.rg-edge.e-live')).toBeTruthy();
    expect(container.querySelector('.rg-dot')).toBeNull();
  });
  it('scrolls wide graphs sideways', () => expect(cssRule('runs/graph.css', '.rg')).toContain('overflow-x: auto'));
});
