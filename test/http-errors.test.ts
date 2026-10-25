import { describe, expect, it } from 'vitest';
import { HttpClientError, statusFor } from '../src/http/errors.js';

describe('http errors', () => {
  it('carries a code and a message and is an Error', () => {
    const e = new HttpClientError('not_found', 'no request "a"');
    expect(e).toBeInstanceOf(Error);
    expect([e.code, e.message]).toEqual(['not_found', 'no request "a"']);
  });

  it('maps each code to its HTTP status', () => {
    expect(statusFor('invalid')).toBe(400);
    expect(statusFor('unknown_vars')).toBe(400);
    expect(statusFor('secret_adhoc')).toBe(400);
    expect(statusFor('not_found')).toBe(404);
    expect(statusFor('conflict')).toBe(409);
    expect(statusFor('too_large')).toBe(413);
    expect(statusFor('secrets_file')).toBe(500);
  });
});
