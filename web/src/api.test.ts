import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, describeEvent } from './api';

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

describe('the timeline line for a step’s metrics', () => {
  const name = (id: string) => (id === 'code' ? 'Bolt' : id);
  it('says Code Mode with run_code runs, connector calls, round-trips and tokens', () => {
    expect(describeEvent({ type: 'node.metrics', node: 'code', toolStyle: 'code', runCode: 2, connectorCalls: 7, roundTrips: 3, inputTokens: 11_200, outputTokens: 1_100 }, name)).toEqual({ text: 'Bolt · Code Mode · 2 run_code · 7 connector calls · 3 tool round-trips · 12.3k tokens', tone: 'info' });
  });
  it('says direct, and when an agent fell back to it', () => {
    expect(describeEvent({ type: 'node.metrics', node: 'code', toolStyle: 'direct', runCode: 0, connectorCalls: 0, roundTrips: 9, inputTokens: 800 }, name)!.text).toBe('Bolt · direct · 9 tool round-trips · 800 tokens');
    expect(describeEvent({ type: 'node.metrics', node: 'x', toolStyle: 'direct', fallback: true, runCode: 0, connectorCalls: 0, roundTrips: 1 }, name)!.text).toBe('x · direct (no Code Mode route) · 1 tool round-trip');
  });
});
