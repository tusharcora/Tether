import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import type { StoredEvent } from './api';
import { mergeEvents, useRunStream } from './runStream';
import { FakeEventSource, makeRun, routeApi } from './test/fixtures';

const ev = (seq: number, type = 'node.started'): StoredEvent => ({ seq, ts: 1000 + seq, event: { type, node: 'code', attempt: 1 } } as unknown as StoredEvent);

beforeEach(() => {
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

it('merges by seq without duplicates', () => {
  expect(mergeEvents([ev(1), ev(2)], [ev(2), ev(3)]).map((e) => e.seq)).toEqual([1, 2, 3]);
  expect(mergeEvents([ev(3)], [ev(1)]).map((e) => e.seq)).toEqual([1, 3]);
});

it('keeps history when a live event beats the snapshot', async () => {
  let release!: (v: StoredEvent[]) => void;
  routeApi({ 'GET /api/runs/r1/events': () => new Promise<StoredEvent[]>((r) => (release = r)) });
  const { result } = renderHook(() => useRunStream('r1'));
  act(() => FakeEventSource.all[0]!.emit('event', ev(5)));
  await act(async () => release([ev(1), ev(2)]));
  await waitFor(() => expect(result.current.events.map((e) => e.seq)).toEqual([1, 2, 5]));
});

it('ignores setRun with a view for another run', () => {
  routeApi({ 'GET /api/runs/r2/events': [] });
  const { result } = renderHook(() => useRunStream('r2'));
  act(() => FakeEventSource.all[0]!.emit('state', makeRun({ id: 'r2', costUsd: 0.2 })));
  act(() => result.current.setRun(makeRun({ id: 'r1' })));
  expect(result.current.run?.id).toBe('r2');
  act(() => result.current.setRun(makeRun({ id: 'r2', costUsd: 0.9 })));
  expect(result.current.run?.costUsd).toBe(0.9);
});

it('follows state, ignores chunks, closes on switch and ignores the old stream', async () => {
  routeApi({ 'GET /api/runs/r1/events': [], 'GET /api/runs/r2/events': [] });
  const { result, rerender } = renderHook(({ id }) => useRunStream(id), { initialProps: { id: 'r1' as string | undefined } });
  const first = FakeEventSource.all[0]!;
  expect(first.url).toBe('/api/runs/r1/stream');
  act(() => first.emit('state', makeRun({ id: 'r1' })));
  act(() => first.emit('event', ev(1, 'node.chunk')));
  expect(result.current.run?.id).toBe('r1');
  expect(result.current.events).toEqual([]);
  rerender({ id: 'r2' });
  expect(first.closed).toBe(true);
  act(() => first.emit('state', makeRun({ id: 'r1' })));
  expect(result.current.run).toBeUndefined();
});
