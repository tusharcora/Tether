import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type AttentionItem } from '../api';
import type { Poll } from '../hooks';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { NeedsYou } from './NeedsYou';

const now = Date.now();
const items: AttentionItem[] = [
  { id: 'r1:approval:ok', ts: now - 60_000, runId: 'r1', kind: 'approval', title: 'Ship it waits for approval', meta: 'flow · r1 · aorch/r1', actions: ['approve', 'open'], node: 'ok' },
  { id: 'r2:failed', ts: now - 120_000, runId: 'r2', kind: 'failed', title: 'Failed', meta: 'flow · r2 · aorch/r2', actions: ['retry', 'open'] },
  { id: 'r3:question:q1', ts: now - 180_000, runId: 'r3', kind: 'question', title: 'Which database?', meta: 'Team run · r3 · aorch/r3', actions: ['answer'], node: 'code' },
];
const poll = (data?: { items: AttentionItem[] }, error?: string): Poll<{ items: AttentionItem[] }> => ({ data, error, fails: 0, refresh: vi.fn(async () => {}) });
const setup = (p: Poll<{ items: AttentionItem[] }>) => {
  const onGo = vi.fn();
  const onChanged = vi.fn();
  renderApp(<NeedsYou poll={p} onGo={onGo} onChanged={onChanged} />);
  return { onGo, onChanged };
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({ 'POST /api/runs/r1/approve': {}, 'POST /api/runs/r2/resume': {} });
});

describe('Needs you', () => {
  it('lists items newest first with a glyph, title, meta and actions', () => {
    setup(poll({ items }));
    const region = screen.getByRole('region', { name: 'Needs you' });
    expect(region.querySelector('.sl-sec-count')!.textContent).toBe('3');
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('.sl-row-title')!.textContent)).toEqual(['Ship it waits for approval', 'Failed', 'Which database?']);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByRole('img', { name: 'Needs you' })).toBeTruthy();
    expect(within(rows[1]!).getByRole('img', { name: 'Failed' })).toBeTruthy();
    expect(screen.getByText('flow · r1 · aorch/r1')).toBeTruthy();
    expect(within(rows[0]!).getAllByRole('button').map((b) => b.textContent)).toEqual(['Approve', 'Open']);
  });

  it('approves from the row with one click and refetches', async () => {
    const { onChanged } = setup(poll({ items }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve' })));
    expect(calls('POST', '/api/runs/r1/approve')[0]![2]).toEqual({ node: 'ok', approved: true });
    expect(onChanged).toHaveBeenCalled();
  });

  it('keeps the row busy until the re-fetch lands, so it cannot be approved twice', async () => {
    let done!: () => void;
    const onChanged = vi.fn(() => new Promise<void>((r) => (done = r)));
    renderApp(<NeedsYou poll={poll({ items })} onGo={vi.fn()} onChanged={onChanged} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve' })));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    // another row stays usable while r1 is in flight
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => done());
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false);
    expect(calls('POST', '/api/runs/r1/approve')).toHaveLength(1);
  });

  it('retries a failed run through resume', async () => {
    setup(poll({ items }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(calls('POST', '/api/runs/r2/resume')).toHaveLength(1);
  });

  it('toasts a failed action and leaves the row', async () => {
    routeApi({ 'POST /api/runs/r1/approve': new Error('run is not paused') });
    const { onChanged } = setup(poll({ items }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve' })));
    expect(await screen.findByText('run is not paused')).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByText('Ship it waits for approval')).toBeTruthy();
  });

  it('links answers to the asking step and open to the run', () => {
    const { onGo } = setup(poll({ items }));
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(onGo).toHaveBeenLastCalledWith({ tab: 'runs', id: 'r3', node: 'code' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]!);
    expect(onGo).toHaveBeenLastCalledWith({ tab: 'runs', id: 'r1', node: 'ok' });
    // F24: a failed run opens on its Timeline
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1]!);
    expect(onGo).toHaveBeenLastCalledWith({ tab: 'runs', id: 'r2', pane: 'timeline' });
  });

  it('keeps the list and offers a compact retry when a later poll fails', () => {
    const stale: Poll<{ items: AttentionItem[] }> = { data: { items }, error: 'down', fails: 1, refresh: vi.fn(async () => {}) };
    setup(stale);
    expect(screen.getByText('Ship it waits for approval')).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't refresh");
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(stale.refresh).toHaveBeenCalled();
  });

  it('shows one quiet line when nothing needs you', () => {
    setup(poll({ items: [] }));
    expect(screen.getByText('Nothing needs you.').className).toBe('sl-quiet');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a load error with retry', () => {
    const failing = poll(undefined, 'down');
    setup(failing);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failing.refresh).toHaveBeenCalled();
  });

  it('shows the ascii skeleton on first load', () => {
    renderApp(<NeedsYou poll={poll()} onGo={() => {}} onChanged={() => {}} />);
    expect(screen.getByRole('status', { name: 'Loading what needs you' })).toBeTruthy();
  });
});
