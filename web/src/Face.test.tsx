import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCrew, getCrew, type CrewState } from './crewStore';
import { Face, MOOD_EXPRESSION, moodFor, TETHER_ID } from './Face';
import { faceArt } from './faceArt';

describe('faces', () => {
  let saved: CrewState | undefined;
  afterEach(() => {
    if (!saved) return;
    // put the crew store back the way the test found it
    applyCrew(Object.entries(saved.crew).map(([id, c]) => ({ id, name: c.name, title: c.title, kind: 'agent', persona: '', source: c.source, whenToUse: c.whenToUse, look: { body: '', eyes: '', mouth: '', top: '', side: '', pattern: '', color: c.hue, accent: 'auto', face: c.face } })));
    saved = undefined;
  });
  it('maps moods to expressions and statuses to moods', () => {
    expect(MOOD_EXPRESSION).toEqual({ idle: 'idle', working: 'thinking', done: 'happy', failed: 'sad', waiting: 'unsure', asleep: 'sleepy', stopped: 'mad' });
    expect(moodFor('running')).toBe('working');
    expect(moodFor('awaiting')).toBe('waiting');
    expect(moodFor('error')).toBe('failed');
    expect(moodFor(undefined)).toBe('idle');
  });

  it("draws Tether's face inline (its colours are tokens), hidden from assistive tech when unlabelled", () => {
    const { container } = render(<Face id={TETHER_ID} size={30} label="" />);
    const face = container.querySelector('span.face')!;
    expect(face.getAttribute('aria-hidden')).toBe('true');
    expect(face.querySelector('svg g')!.getAttribute('style')).toBe('fill:var(--tf-slab, var(--s3))');
    render(<Face id={TETHER_ID} label="Tether" />);
    expect(screen.getByRole('img', { name: 'Tether' }).tagName).toBe('SPAN');
  });

  it('is stable across releases', () => {
    expect({ planner: faceArt('planner'), coder: faceArt('coder'), quill: faceArt('quill', { mood: 'working' }) }).toMatchSnapshot();
  });

  it('renders a static image with the bot name, and takes the saved face pins', () => {
    saved = getCrew();
    applyCrew([{ id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: '', look: { body: '', eyes: '', mouth: '', top: '', side: '', pattern: '', color: '#3fb97c', accent: 'auto', face: { body: 'cloud' } } }]);
    render(<Face id="coder" size={40} />);
    const img = screen.getByRole('img', { name: 'Bolt' }) as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(decodeURIComponent(img.src)).toBe(`data:image/svg+xml;utf8,${faceArt('coder', { body: 'cloud', size: 40 })}`);
    expect(img.dataset.mood).toBe('idle');
  });

  it('animates as inline SVG, marking how it animates and its mood', () => {
    const { container } = render(
      <>
        <Face id="coder" mood="working" animate="always" />
        <Face id="planner" animate="hover" label="Scout" />
      </>,
    );
    const [always, hover] = [...container.querySelectorAll('span.face[role="img"]')] as HTMLElement[];
    expect(always!.dataset).toMatchObject({ animate: 'always', mood: 'working' });
    expect(always!.querySelector('svg > .fa-eyes .fa-eye')).toBeTruthy();
    expect(hover!.dataset.animate).toBe('hover');
    expect(hover!.getAttribute('aria-label')).toBe('Scout');
    expect(container.querySelector('img')).toBeNull();
  });

  it('marks a black body so the dark theme can outline it', () => {
    const { container } = render(
      <>
        <Face id="coder" />
        <Face id="planner" animate="always" />
        <Face id="planner" face={{ color: '#0B0B0C' }} animate="always" />
      </>,
    );
    expect([...container.querySelectorAll('.face')].map((f) => f.hasAttribute('data-dark-body'))).toEqual([true, false, true]);
  });

  it('paints nothing behind a face in any stylesheet: no fill, rounding or ring', () => {
    // read from disk (vitest blanks CSS imports); the base goes through a variable so Vite leaves the URL alone
    const here = import.meta.url;
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    const css = walk(fileURLToPath(new URL('./', here))).filter((p) => p.endsWith('.css'));
    const painted = css.flatMap((p) =>
      [...readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, sel, body]) => sel!.split(',').some((s) => /\.face(?![\w-])[^\s>+~]*$/.test(s.trim())) && /background|border-radius|box-shadow/.test(body!))
        .map(([, sel]) => sel!.trim()),
    );
    expect(painted).toEqual([]);
  });
});
