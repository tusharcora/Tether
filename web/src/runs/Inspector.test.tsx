import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type RunView } from '../api';
import { makeRun, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { Inspector } from './Inspector';

const act0 = vi.fn(async () => true);
const show = (run: RunView, selected?: string) => renderApp(<Inspector run={run} events={[]} selected={selected} onAct={act0} />);
const DIFF = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n+one\n+two\n-three';

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({ 'GET /api/runs/r1/diff': { diff: DIFF } });
});

describe('Inspector step pane', () => {
  it('shows the bot face and name, the status chip, and a caret only while the step runs', () => {
    const { container, unmount } = show(makeRun(), 'code');
    expect(screen.getByRole('heading', { name: /Bolt · coder/ })).toBeTruthy();
    expect(container.querySelector('.sl-chip.t-live')!.textContent).toBe('running');
    expect(container.querySelector('.live-out .caret')).toBeTruthy();
    unmount();
    const done = makeRun({ nodes: { ...makeRun().nodes, code: { ...makeRun().nodes.code!, status: 'done', live: 'last words' } } });
    const again = show(done, 'code');
    expect(again.container.querySelector('.live-out .caret')).toBeNull();
  });

  it('says why Tether picked the bot on team runs only', () => {
    const plan = { goal: 'g', success: [], assignments: [{ bot: 'coder', goal: 'c', mode: 'write' as const, why: 'Bolt knows this code' }], limits: { allowWrites: true }, answers: [] };
    const { unmount } = show(makeRun({ kind: 'team', plan }), 'code');
    expect(screen.getByText('Bolt knows this code')).toBeTruthy();
    expect(screen.getByText('Why Tether picked it')).toBeTruthy();
    unmount();
    show(makeRun({ plan }), 'code');
    expect(screen.queryByText('Why Tether picked it')).toBeNull();
  });

  it('draws per-file bars for the step’s committed diff', async () => {
    const withCommit = makeRun({ nodes: { ...makeRun().nodes, code: { ...makeRun().nodes.code!, status: 'done', commit: 'abc1234' } } });
    routeApi({ 'GET /api/runs/r1/diff?node=code': { diff: DIFF } });
    show(withCommit, 'code');
    // the file summary (name, counts, bar) and beui's file-diff disclosure both name the file
    expect((await screen.findAllByText('src/a.ts')).length).toBe(2);
    expect(screen.getByText('+2 −1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /src\/a\.ts/ })).toBeTruthy();
  });

  it('says so when the linked step is not in the run', () => {
    show(makeRun(), 'ghost');
    expect(screen.getByRole('note').textContent).toContain('This step is not in this run');
  });

  it('hints to pick a step when none is selected', async () => {
    show(makeRun());
    await waitFor(() => expect(screen.getByText('Click a step in the graph to see its output, diff and gate results.')).toBeTruthy());
    await act(async () => {});
  });

  it('shows a failed diff load inline with a retry, never "No committed changes" (F9)', async () => {
    routeApi({ 'GET /api/runs/r1/diff': new Error('diff failed') });
    show(makeRun());
    const tab = screen.getByRole('tab', { name: 'Branch diff' });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(await screen.findByText('diff failed')).toBeTruthy();
    expect(screen.queryByText(/No committed changes/)).toBeNull();
    routeApi({ 'GET /api/runs/r1/diff': { diff: DIFF } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect((await screen.findAllByText('src/a.ts')).length).toBeGreaterThan(0);
  });

  it('holds the diff place with the loading skeleton while it loads (F18)', async () => {
    routeApi({ 'GET /api/runs/r1/diff': new Promise(() => {}) });
    show(makeRun());
    const tab = screen.getByRole('tab', { name: 'Branch diff' });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(await screen.findByLabelText('Loading diff')).toBeTruthy();
    expect(screen.queryByText(/No committed changes/)).toBeNull();
  });
});
