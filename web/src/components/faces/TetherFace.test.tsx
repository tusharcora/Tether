import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Face } from '../../Face';
import { cssRule } from '../../test/css';
import { TetherFace } from './TetherFace';

/** requestAnimationFrame under the test's control: `pump(n)` runs n frames 16 ms apart. */
function frames() {
  let queue: FrameRequestCallback[] = [];
  let now = 1000;
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => (queue.push(cb), queue.length));
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const pump = (n: number) => {
    for (let i = 0; i < n; i++) {
      const run = queue;
      queue = [];
      now += 16;
      for (const cb of run) cb(now);
    }
  };
  return { raf, pump };
}
const eyeX = () => [...document.querySelectorAll('.tf-ball > g > g')].map((g) => Number(/translate\(([\d.]+)/.exec(g.getAttribute('transform') ?? '')?.[1]));

afterEach(() => vi.restoreAllMocks());

describe('TetherFace (bencho eye tracker)', () => {
  it('draws a soft cube with two eyes, named by its caller or hidden when decorative', () => {
    const { rerender } = render(<TetherFace size={40} label="Tether" />);
    expect(screen.getByRole('img', { name: 'Tether' })).toBeTruthy();
    expect(document.querySelectorAll('.tf-eye')).toHaveLength(2);
    expect(eyeX()).toEqual([40.5, 59.5]);
    rerender(<TetherFace size={40} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(document.querySelector('.tf')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('turns its eyes toward the pointer', () => {
    const { pump } = frames();
    render(<TetherFace size={40} label="Tether" />);
    pump(2);
    const [left0, right0] = eyeX();
    fireEvent.pointerMove(window, { clientX: 900, clientY: 0 });
    pump(40);
    const [left1, right1] = eyeX();
    expect(left1!).toBeGreaterThan(left0!);
    expect(right1!).toBeGreaterThan(right0!);
  });

  it('idle: a still mark — no animation frames, the pointer ignored', () => {
    const { raf, pump } = frames();
    render(<TetherFace size={20} idle />);
    fireEvent.pointerMove(window, { clientX: 900, clientY: 0 });
    pump(10);
    expect(raf).not.toHaveBeenCalled();
    expect(eyeX()).toEqual([40.5, 59.5]);
  });

  it('reduced motion: drawn once, facing front, no loop', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as unknown as MediaQueryList);
    const { raf, pump } = frames();
    render(<TetherFace size={40} label="Tether" />);
    fireEvent.pointerMove(window, { clientX: 900, clientY: 0 });
    pump(10);
    expect(raf).not.toHaveBeenCalled();
    expect(eyeX()).toEqual([40.5, 59.5]);
  });

  it('takes its colours from Studio tokens', () => {
    expect(cssRule('components/faces/TetherFace.css', '.tf-body')).toBe('fill: var(--tf-slab,var(--s3));');
    expect(cssRule('components/faces/TetherFace.css', '.tf-eye')).toBe('fill: var(--tf-eye,var(--ink));');
  });

  it('is the orchestrator bot’s face wherever a Face is drawn: still when static, alive when animated', () => {
    const { rerender } = render(<Face id="orchestrator" label="Tether" size={24} />);
    expect(screen.getByRole('img', { name: 'Tether' }).classList.contains('tf')).toBe(true);
    expect(screen.getByRole('img', { name: 'Tether' }).hasAttribute('data-idle')).toBe(true);
    rerender(<Face id="orchestrator" label="Tether" size={24} animate="always" />);
    expect(screen.getByRole('img', { name: 'Tether' }).hasAttribute('data-idle')).toBe(false);
  });
});
