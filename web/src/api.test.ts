import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('api()', () => {
  it('throws an ApiError with the server error text and the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'no workspace' }), { status: 409 })));
    const err = await api('GET', '/api/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: 'no workspace', status: 409 });
  });

  it('falls back to the status line when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    await expect(api('GET', '/api/x')).rejects.toMatchObject({ message: 'HTTP 502', status: 502 });
  });
});
