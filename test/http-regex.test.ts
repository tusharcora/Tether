import { describe, expect, it } from 'vitest';
import { compileRegex } from '../src/http/regex.js';

describe('compileRegex', () => {
  it('compiles a pattern of up to 200 characters', () => {
    expect(compileRegex('^ok$').test('ok')).toBe(true);
    expect(compileRegex('a'.repeat(200)).source).toHaveLength(200);
  });

  it('refuses a pattern over 200 characters or not a string', () => {
    expect(() => compileRegex('a'.repeat(201))).toThrow('a "matches" pattern must be a string of at most 200 characters');
    expect(() => compileRegex(5)).toThrow(/at most 200 characters/);
  });

  it('reports an invalid pattern', () => {
    expect(() => compileRegex('(')).toThrow(/^invalid pattern: /);
  });
});
