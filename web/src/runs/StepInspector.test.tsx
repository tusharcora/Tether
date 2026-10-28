import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type RunView, type StoredEvent } from '../api';
import { Runs } from '../Runs';
import { cssRule } from '../test/css';
import { calls, FakeEventSource, makeAwaitingRun, makeRow, makeRun, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';

const DIFF = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n+one\n+two\n-three';
const done = () => makeRun({ status: 'done', live: false, nodes: { ...makeRun().nodes, code: { ...makeRun().nodes.code!, status: 'done', live: undefined }, gate: { status: 'done', attempts: 1, costUsd: 0, loops: 0 } } });
const show = (run: RunView, props: Partial<Parameters<typeof Runs>[0]> = {}, events: StoredEvent['event'][] = []) => {
  const p = { onSelect: vi.fn(), onSelectNode: vi.fn(), ...props };
  renderApp(<Runs selected="r1" {...p} />);
  act(() => FakeEventSource.all[0]!.emit('state', run));
  events.forEach((event, i) => act(() => FakeEventSource.all[0]!.emit('event', { seq: i + 1, ts: Date.now(), event })));
  return p;
};
const panel = (name = 'Step inspector') => screen.findByRole('complementary', { name });

beforeEach(() => {
  vi.mocked(api).mockReset();
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  routeApi({
    'GET /api/runs': [makeRow()],
    'GET /api/runs/r1/events': [],
    'GET /api/runs/r1/diff': { diff: DIFF },
    'POST /api/runs/r1/feedback': (b: unknown) => ((b as { rating: string }).rating === 'down' ? new Error('feedback store is read-only') : done()),
  });
});

describe('StepInspector', () => {
  it('opens a 440 px panel when a crew card is clicked', async () => {
    const p = show(makeRun());
    fireEvent.click(await screen.findByRole('button', { name: /writing$/ }));
    expect(p.onSelectNode).toHaveBeenCalledWith('code');
    expect(await panel()).toBeTruthy();
    expect(cssRule('runs/inspector.css', '.insp')).toContain('width: 440px');
    expect(cssRule('runs/inspector.css', '.insp', '@media (max-width: 899px)')).toContain('inset: 0');
  });

  it('opens from a deep link once the run loads, with identity, figures and tabs', async () => {
    renderApp(<Runs selected="r1" node="code" onSelect={() => {}} />);
    expect(screen.queryByRole('complementary', { name: 'Step inspector' })).toBeNull();
    act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
    const el = await panel();
    expect(within(el).getByText('2 of 3')).toBeTruthy();
    expect(within(el).getByRole('heading', { name: 'Bolt' })).toBeTruthy();
    expect(within(el).getByText('coder · claude · default')).toBeTruthy();
    expect(within(el).getByText('Attempts')).toBeTruthy();
    expect(within(el).getByText('$0.07')).toBeTruthy();
    expect(within(el).getByRole('tab', { name: 'Output' })).toBeTruthy();
    expect(within(el).queryByRole('tab', { name: 'Checks' })).toBeNull();
    expect(el.querySelector('.caret')).toBeTruthy();
    expect(within(el).getByRole('button', { name: 'Step 2: Bolt' }).getAttribute('aria-current')).toBe('step');
  });

  it('moves with ← → and closes with Esc back to the run', async () => {
    const p = show(makeRun(), { node: 'code' });
    await panel();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(p.onSelectNode).toHaveBeenLastCalledWith('gate');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onSelectNode).toHaveBeenLastCalledWith(undefined);
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Step inspector' })).toBeNull());
  });

  it('closes from the × and from the scrim', async () => {
    const p = show(makeRun(), { node: 'code' });
    fireEvent.click(within(await panel()).getByRole('button', { name: 'Close inspector' }));
    expect(p.onSelectNode).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(await screen.findByRole('button', { name: /writing$/ }));
    await panel();
    fireEvent.click(document.querySelector('.insp-scrim')!);
    expect(p.onSelectNode).toHaveBeenLastCalledWith(undefined);
  });

  it('leaves arrow keys alone inside a text field', async () => {
    const p = show(done(), { node: 'plan' });
    const el = await panel();
    fireEvent.click(within(el).getByRole('button', { name: 'Good' }));
    const note = await within(el).findByLabelText('Why (optional)');
    note.focus();
    fireEvent.keyDown(note, { key: 'ArrowRight' });
    expect(p.onSelectNode).not.toHaveBeenCalledWith('code');
    fireEvent.keyDown(note, { key: 'Escape' });
    expect(screen.getByRole('complementary', { name: 'Step inspector' })).toBeTruthy();
    expect(p.onSelectNode).not.toHaveBeenCalledWith(undefined);
  });

  it('ignores arrows with no steps', async () => {
    const p = show(makeRun({ kind: 'team', planning: true, pipeline: { ...makeRun().pipeline, nodes: [], edges: [] }, nodes: {} }), { node: 'ghost' });
    const el = await panel();
    expect(within(el).getByRole('note').textContent).toContain('This step is not in this run');
    expect(() => fireEvent.keyDown(window, { key: 'ArrowRight' })).not.toThrow();
    expect(p.onSelectNode).not.toHaveBeenCalled();
  });

  it('shows one Checks row per gate run with the fix-loop count', async () => {
    const run = makeRun({ status: 'done', live: false, nodes: { ...makeRun().nodes, gate: { status: 'done', attempts: 2, costUsd: 0, loops: 1, gate: { ok: true, exitCode: 0, output: 'ok' } } } });
    show(run, { node: 'gate' }, [
      { type: 'gate.result', node: 'gate', ok: false, exitCode: 1, output: 'boom', durationMs: 900 },
      { type: 'gate.result', node: 'gate', ok: true, exitCode: 0, output: 'ok', durationMs: 800 },
    ]);
    const el = await panel();
    const tab = within(el).getByRole('tab', { name: 'Checks' });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    const rows = await waitFor(() => {
      const r = el.querySelectorAll('.chk');
      expect(r).toHaveLength(2);
      return r;
    });
    expect(rows[0]!.textContent).toMatch(/Run 1.*failed.*exit 1/);
    expect(rows[1]!.textContent).toMatch(/Run 2.*passed.*exit 0/);
    expect(within(el).getByText('Fix loops: 1 of 2')).toBeTruthy();
  });

  it('rates a step with a thumb, then saves an optional note through feedback', async () => {
    show(done(), { node: 'plan' });
    const el = await panel();
    expect(within(el).getByText('How did Scout do?')).toBeTruthy();
    await act(async () => fireEvent.click(within(el).getByRole('button', { name: 'Good' })));
    expect(calls('POST', '/api/runs/r1/feedback')[0]![2]).toEqual({ node: 'plan', rating: 'up' });
    fireEvent.change(within(el).getByLabelText('Why (optional)'), { target: { value: 'nice' } });
    await act(async () => fireEvent.click(within(el).getByRole('button', { name: 'Save note' })));
    expect(calls('POST', '/api/runs/r1/feedback')[1]![2]).toEqual({ node: 'plan', rating: 'up', note: 'nice' });
    expect(within(el).getByText('Saved')).toBeTruthy();
    await act(async () => fireEvent.click(within(el).getByRole('button', { name: 'Bad' })));
    expect(await screen.findByText('feedback store is read-only')).toBeTruthy();
  });

  it('shows no rating for an approval step', async () => {
    show(makeAwaitingRun(), { node: 'ship' });
    await panel();
    expect(screen.queryByText(/How did/)).toBeNull();
  });

  it('says why Tether picked the bot on team runs', async () => {
    const plan = { goal: 'g', success: [], assignments: [{ bot: 'coder', goal: 'c', mode: 'write' as const, why: 'Bolt knows this code' }], limits: { allowWrites: true }, answers: [] };
    show(makeRun({ kind: 'team', plan }), { node: 'code' });
    const el = await panel();
    expect(within(el).getByText('Why Tether picked it')).toBeTruthy();
    expect(within(el).getByText('Bolt knows this code')).toBeTruthy();
  });

  it('draws per-file bars for the step’s committed diff, and a failed diff with Retry', async () => {
    routeApi({ 'GET /api/runs': [makeRow()], 'GET /api/runs/r1/events': [], 'GET /api/runs/r1/diff': { diff: '' }, 'GET /api/runs/r1/diff?node=code': new Error('diff failed') });
    show(makeRun({ nodes: { ...makeRun().nodes, code: { ...makeRun().nodes.code!, status: 'done', commit: 'abc1234' } } }), { node: 'code' });
    const el = await panel();
    const tab = within(el).getByRole('tab', { name: 'Changes' });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    expect(await within(el).findByText('diff failed')).toBeTruthy();
    routeApi({ 'GET /api/runs': [makeRow()], 'GET /api/runs/r1/events': [], 'GET /api/runs/r1/diff': { diff: '' }, 'GET /api/runs/r1/diff?node=code': { diff: DIFF } });
    await act(async () => fireEvent.click(within(el).getByRole('button', { name: 'Retry' })));
    expect(await within(el).findByText('+2 −1')).toBeTruthy();
  });

  it('opens run mode on Timeline from ?pane=timeline', async () => {
    renderApp(<Runs selected="r1" pane="timeline" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
    act(() => FakeEventSource.all[0]!.emit('event', { seq: 1, ts: Date.now(), event: { type: 'run.started' } }));
    const el = await panel('Run details');
    expect(within(el).getByRole('tab', { name: 'Timeline (1)' }).getAttribute('aria-selected')).toBe('true');
  });

  it('opens run mode on Changes from Run details and Review diff, and keeps the branch diff live', async () => {
    const base = makeAwaitingRun();
    show(base);
    fireEvent.click(await screen.findByRole('button', { name: 'Run details' }));
    let el = await panel('Run details');
    expect(within(el).getByRole('tab', { name: 'Changes' }).getAttribute('aria-selected')).toBe('true');
    expect(within(el).getByText('aorch/r1')).toBeTruthy();
    expect((await within(el).findAllByText('src/a.ts')).length).toBeGreaterThan(0);
    const n = calls('GET', '/api/runs/r1/diff').length;
    act(() => FakeEventSource.all[0]!.emit('state', { ...base, costUsd: 0.5 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls('GET', '/api/runs/r1/diff')).toHaveLength(n);
    act(() => FakeEventSource.all[0]!.emit('state', { ...base, nodes: { ...base.nodes, code: { ...base.nodes.code!, commit: 'def5678' } } }));
    await waitFor(() => expect(calls('GET', '/api/runs/r1/diff').length).toBeGreaterThan(n));
    fireEvent.click(within(el).getByRole('button', { name: 'Close inspector' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review diff' }));
    el = await panel('Run details');
    expect(within(el).getByRole('tab', { name: 'Changes' }).getAttribute('aria-selected')).toBe('true');
  });
});
