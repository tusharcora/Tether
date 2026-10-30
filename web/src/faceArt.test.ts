import { describe, expect, it } from 'vitest';
import { BODIES, COLORS, DARK_BODY, faceArt, faceLook, type Mood } from './faceArt';

const MOODS: Mood[] = ['idle', 'working', 'done', 'failed', 'waiting', 'asleep', 'stopped'];
const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml');

describe('faceArt', () => {
  it('is deterministic per id, and different ids get different looks', () => {
    expect(faceArt('quill')).toBe(faceArt('quill'));
    expect(faceLook('quill')).toEqual(faceLook('quill'));
    const looks = new Set(['quill', 'go-reviewer', 'tdd-guide', 'doc-writer', 'build-fixer', 'e2e-runner'].map((id) => JSON.stringify(faceLook(id))));
    expect(looks.size).toBeGreaterThan(3);
  });

  it('gives the built-in bots their hand-set looks', () => {
    expect(faceLook('planner')).toEqual({ body: 'orb', color: '#5E7FE6' });
    expect(faceLook('architect')).toEqual({ body: 'block', color: '#E8835F' });
    expect(faceLook('coder')).toEqual({ body: 'orb', color: DARK_BODY });
    expect(faceLook('tester')).toEqual({ body: 'bean', color: '#58B6C4' });
    expect(faceLook('reviewer')).toEqual({ body: 'drop', color: '#F7D02C' });
    expect(faceLook('manager')).toEqual({ body: 'tile', color: '#E35A5A' });
    expect(faceLook('approval')).toEqual({ body: 'cloud', color: '#C9CACD' });
    // an id that is also an Object.prototype key is just an id
    expect(BODIES).toContain(faceLook('constructor').body);
  });

  it('picks override the id; picks outside the lists are ignored', () => {
    expect(faceLook('coder', { body: 'flower', color: '#fbc3e6' })).toEqual({ body: 'flower', color: '#FBC3E6' });
    expect(faceLook('coder', { body: 'blob', color: 'red' })).toEqual(faceLook('coder'));
    expect(faceArt('coder', { body: 'cloud' })).not.toBe(faceArt('coder'));
    expect(faceArt('coder', { color: '"/><script>' })).toBe(faceArt('coder'));
  });

  it('draws every body, colour and mood as valid SVG with no background: the body comes first, nothing fills the box', () => {
    for (const body of BODIES)
      for (const [color] of COLORS)
        for (const mood of MOODS) {
          const doc = parse(faceArt('x', { body, color, mood, size: 40 }));
          const svg = doc.documentElement;
          expect(svg.nodeName).toBe('svg');
          expect(doc.querySelector('parsererror')).toBeNull();
          expect(svg.getAttribute('fill')).toBeNull();
          const first = svg.firstElementChild!;
          expect([first.nodeName, first.getAttribute('fill')]).toEqual(['g', color]);
          expect(svg.lastElementChild!.getAttribute('class')).toBe('fa-eyes');
          expect(svg.querySelector('.fa-eyes')!.children.length).toBe(2);
          for (const el of svg.querySelectorAll('rect, path'))
            expect(Number(el.getAttribute('width') ?? 0) >= 100 || /^M0[ ,]0/.test(el.getAttribute('d') ?? '')).toBe(false);
        }
  });

  it('inks the eyes to read on the body', () => {
    expect(faceArt('x', { color: DARK_BODY })).toContain('fill="#FFFFFF"');
    expect(faceArt('x', { color: '#FBC3E6' })).toContain('fill="#3D4A63"');
    expect(faceArt('x', { color: '#F7D02C' })).toContain('fill="#17181A"');
    expect(faceArt('x', { color: DARK_BODY, mood: 'done' })).toContain('stroke="#FFFFFF"');
  });

  it('gives each mood its own eyes', () => {
    expect(new Set(MOODS.map((mood) => faceArt('coder', { mood }))).size).toBe(MOODS.length);
  });
});
