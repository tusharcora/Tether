import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCrew, getCrew, type CrewState } from './crewStore';
import { Face, faceSvg, faceUri, MOOD_EXPRESSION, moodFor } from './Face';

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

  it('is deterministic per id and stable across releases', () => {
    expect(faceSvg('coder')).toBe(faceSvg('coder'));
    expect(faceSvg('coder')).not.toBe(faceSvg('planner'));
    expect(faceSvg('coder', { mood: 'working' })).not.toBe(faceSvg('coder'));
    expect({ orchestrator: faceSvg('orchestrator'), planner: faceSvg('planner'), coder: faceSvg('coder') }).toMatchSnapshot();
  });

  it('applies face overrides and renders an image with the bot name', () => {
    expect(faceSvg('coder', { face: { hue: 10 } })).not.toBe(faceSvg('coder'));
    saved = getCrew();
    applyCrew([{ id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: '', look: { body: '', eyes: '', mouth: '', top: '', side: '', pattern: '', color: '#3fb97c', accent: 'auto' } }]);
    render(<Face id="coder" size={40} />);
    const img = screen.getByRole('img', { name: 'Bolt' }) as HTMLImageElement;
    expect(img.src.startsWith('data:image/svg+xml')).toBe(true);
    expect(faceUri('coder')).toContain(encodeURIComponent('<svg'));
  });

  it('animates as inline SVG: always, or on hover', () => {
    const { container } = render(
      <>
        <Face id="coder" mood="working" animate="always" />
        <Face id="planner" animate="hover" />
      </>,
    );
    const [always, hover] = [...container.querySelectorAll('span.face[role="img"]')];
    expect(always!.querySelector('svg > g.mo-root.mo-always')).toBeTruthy();
    expect(hover!.querySelector('.mo-root')).toBeTruthy();
    expect(hover!.querySelector('.mo-always')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
