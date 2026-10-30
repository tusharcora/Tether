import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type Question } from '../api';
import { Runs } from '../Runs';
import { calls, FakeEventSource, makeAwaitingRun, makeRow, makeRun, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { tagModels } from '../../../src/openrouter';
import fixture from '../../../test/fixtures/openrouter-models.json';
import { gateSummary } from './ApprovalBar';
import { loadComments } from './comments';
import { LimitBar } from './LimitBar';
import { RunFiles } from './RunFiles';
import { RunHeader } from './RunHeader';
import { RunNotices } from './RunNotices';

const act0 = vi.fn(async () => true);
const DIFF = 'diff --git a/src/limit.ts b/src/limit.ts\n--- a/src/limit.ts\n+++ b/src/limit.ts\n@@ -1,2 +1,2 @@\n // the limit\n-export const limit = 5;\n+export const limit = 10;\n';

describe('run header, notices and approval bar', () => {
  it('heads the run: ← Runs / workflow / short id, the task with its badge, and time · cost of its cap', () => {
    renderApp(<RunHeader run={makeRun({ pipeline: { ...makeRun().pipeline, settings: { ...makeRun().pipeline.settings, maxCostUsd: 5 } } })} onAct={act0} onBack={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Add rate limiting' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('← Runs/plan-code-review/R-R1');
    expect(screen.getByText(/^\d+:\d{2} · \$0\.12 of \$5\.00$/)).toBeTruthy();
    expect(document.querySelector('[data-status="loading"]')!.textContent).toContain('running');
  });
  it('a goal’s run says which try it is and opens the goal; a team’s run opens in its room', () => {
    const onGoal = vi.fn();
    const onTeam = vi.fn();
    const goal = { id: 'g1', type: 'bugfix', maxRuns: 3, items: [{ id: 1, kind: 'run', runId: 'r1' }] } as never;
    renderApp(<RunHeader run={makeRun()} onAct={act0} onBack={() => {}} goal={goal} team="web" onGoal={onGoal} onTeam={onTeam} />);
    fireEvent.click(screen.getByRole('button', { name: '! Goal · try 1 of 3' }));
    expect(onGoal).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open in # web' }));
    fireEvent.click(screen.getByRole('button', { name: '# web' }));
    expect(onTeam).toHaveBeenCalledTimes(2);
  });
  it('reads a finished run’s time as a duration and goes back to the list', () => {
    const onBack = vi.fn();
    const t = Date.now();
    renderApp(<RunHeader run={makeRun({ status: 'done', live: false, startedAt: t - 3 * 86_400_000 - 16 * 3_600_000, finishedAt: t })} onAct={act0} onBack={onBack} />);
    expect(screen.getByText(/^3d 16h · /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Runs' }));
    expect(onBack).toHaveBeenCalled();
  });
  it('says interrupted in the badge, not a separate chip', () => {
    renderApp(<RunHeader run={makeRun({ live: false })} onAct={act0} onBack={() => {}} />);
    expect(screen.getAllByText('interrupted')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });
  it('shows coach findings as lines, two at most before "and N more", dismissible for the session', () => {
    const coach = [1, 2, 3, 4].map((i) => ({ id: `f${i}`, title: `T${i}`, detail: `d${i}`, action: `a${i}` }));
    const { unmount } = renderApp(<RunNotices run={makeRun({ coach })} onRetryStream={() => {}} />);
    expect(screen.queryByText('Coach')).toBeNull();
    expect(screen.getByText('T2')).toBeTruthy();
    expect(screen.queryByText('T3')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'and 2 more' }));
    expect(screen.getByText('T4')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
    unmount();
    renderApp(<RunNotices run={makeRun({ coach })} onRetryStream={() => {}} />);
    expect(screen.queryByText('T1')).toBeNull();
    expect(screen.getByText('a2').closest('a')).toBeNull();
  });
  it('shows a run error as a red line and keeps the stream retry', () => {
    const retry = vi.fn();
    renderApp(<RunNotices run={makeRun({ error: 'budget exhausted ($6.41 of $4.50)\nstack' })} streamError="stream lost" onRetryStream={retry} />);
    expect(screen.getByText('budget exhausted ($6.41 of $4.50)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(retry).toHaveBeenCalled();
  });
  it('a step out of free requests: the amber bar with Add credits, Switch model… and Wait, the files kept, the counter in the meta line', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const resetsAt = new Date(2026, 9, 29, 2, 0).getTime();
    routeApi({
      'GET /api/accounts/openrouter/models': { models: tagModels(fixture) },
      'GET /api/accounts/openrouter/allowance': { used: 50, limit: 50, remaining: 0, resetsAt },
      'GET /api/bots': { crew: [], agents: { claude: { ok: true, models: [] } } },
      'GET /api/runs/r1/diff': '',
    });
    const base = makeRun();
    const run = makeRun({
      status: 'paused',
      live: false,
      pipeline: { ...base.pipeline, nodes: base.pipeline.nodes.map((n) => (n.id === 'code' ? { ...n, agent: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free' } : n)) },
      nodes: { ...base.nodes, code: { status: 'awaiting', attempts: 1, costUsd: 0, loops: 0, limit: { resetsAt } } },
    });
    const onAct = vi.fn(async () => true);
    renderApp(<LimitBar run={run} onAct={onAct} />);
    expect(screen.getByText('Out of free requests for today').closest('.run-approve')).toBeTruthy();
    expect(screen.getByText('Bolt picks up where it stopped at 02:00, or keep going now on another model.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Wait until 02:00' }));
    expect(screen.getByText('Bolt picks up where it stopped at 02:00.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Switch model…' }));
    fireEvent.click(await screen.findByText('Flint'));
    expect(onAct).toHaveBeenCalledWith('resume', { agent: 'openrouter', model: 'recursive/flint-v1.0:free' });
    fireEvent.click(screen.getByRole('button', { name: 'Add credits ↗' }));
    expect(open).toHaveBeenCalledWith('https://openrouter.ai/settings/credits', '_blank', 'noopener');
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onAct).toHaveBeenLastCalledWith('resume');

    renderApp(<RunFiles run={run} onOpen={() => {}} />);
    expect(screen.getByText('Kept in the worktree. Nothing is lost.')).toBeTruthy();
    renderApp(<RunHeader run={run} onAct={act0} onBack={() => {}} />);
    expect(await screen.findByText(/ · 50\/50 free requests$/)).toBeTruthy();
  });
  it('shows no limit bar on a run that is not waiting for free requests', () => {
    const { container } = renderApp(<LimitBar run={makeAwaitingRun()} onAct={act0} />);
    expect(container.querySelector('.run-approve')).toBeNull();
  });
  it('summarises gates', () => {
    expect(gateSummary(makeRun())).toBe('npm test not run');
    expect(gateSummary(makeAwaitingRun())).toBe('npm test passed');
    expect(gateSummary(makeRun({ nodes: { ...makeRun().nodes, gate: { status: 'done', attempts: 2, costUsd: 0, loops: 1, gate: { ok: false, exitCode: 1, output: '' } } } }))).toBe('npm test failed');
    expect(gateSummary(makeRun({ pipeline: { ...makeRun().pipeline, nodes: makeRun().pipeline.nodes.filter((n) => n.kind !== 'gate') } }))).toBe('No gates in this run');
  });
});

const q1: Question = { id: 'q1', ask: 'Which store?', recommended: 'a', options: [{ id: 'a', label: 'Postgres' }, { id: 'b', label: 'Redis' }] };
const open = (run = makeRun(), props: Partial<Parameters<typeof Runs>[0]> = {}) => {
  const p = { onSelect: vi.fn(), onSelectNode: vi.fn(), ...props };
  renderApp(<Runs selected="r1" {...p} />);
  act(() => FakeEventSource.all[0]!.emit('state', run));
  return p;
};

describe('run page', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    localStorage.clear();
    FakeEventSource.all = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    routeApi({
      'GET /api/runs': [makeRow()],
      'GET /api/runs/r1/events': [],
      'GET /api/runs/r1/events?chunks=1': [{ seq: 1, ts: 1, runId: 'r1', event: { type: 'node.chunk', node: 'code', text: '[tool] Read src/limit.ts\nthinking out loud\n[tool] Edit src/limit.ts\n[tool] Bash npm test\n' } }],
      'GET /api/runs/r1/diff': { diff: '' },
      'GET /api/runs/r1/diff?node=code': { diff: DIFF },
      'POST /api/runs/r1/sendback': (b: unknown) => ({ ...makeRun(), b }),
      'POST /api/runs/r1/ship': makeRun({ status: 'running' }),
      'POST /api/runs/r1/approve': makeRun({ status: 'running' }),
    });
  });

  it('tells the run as a story on the left, the step in the middle, the outcome on the right', async () => {
    const p = open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Add rate limiting' })).toBeTruthy();
    const story = screen.getByRole('navigation', { name: 'What happened' });
    expect(within(story).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Scout looked into it, done', 'Bolt is making the changes, working', 'Probe runs gate, not started']);
    // the working step is open; its transcript has its tool calls as rows
    expect(within(screen.getByRole('region', { name: 'Step' })).getByText('Bolt is making the changes')).toBeTruthy();
    const tools = await screen.findByRole('list', { name: 'Tool calls' });
    expect(within(tools).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Readsrc/limit.ts', 'Editedsrc/limit.ts', 'Rannpm test']);
    fireEvent.click(within(story).getByRole('button', { name: 'Scout looked into it, done' }));
    expect(p.onSelectNode).toHaveBeenLastCalledWith('plan');
    const outcome = screen.getByRole('complementary', { name: 'Outcome' });
    expect(within(outcome).getByText('aorch/r1')).toBeTruthy();
    expect(within(outcome).getByText('Bolt · claude')).toBeTruthy();
  });

  it('a comment on a diff line goes back to its step with your reason, and is marked sent', async () => {
    const r = makeAwaitingRun();
    open({ ...r, status: 'paused', live: false, nodes: { ...r.nodes, code: { ...r.nodes.code!, status: 'done', commit: 'c1' } } }, { node: 'code' });
    fireEvent.click(await screen.findByRole('tab', { name: /Changes/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Comment on src\/limit.ts line 2: export const limit = 10;/ }));
    fireEvent.change(screen.getByLabelText('Your comment on src/limit.ts'), { target: { value: 'Make it a setting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    const decision = screen.getByRole('region', { name: 'Decision' });
    expect(within(decision).getByText('npm test passed · 1 comment of yours not sent yet')).toBeTruthy();
    fireEvent.click(within(decision).getByRole('button', { name: 'Send back…' }));
    fireEvent.change(within(decision).getByLabelText('Why (optional)'), { target: { value: 'Not a constant' } });
    await act(async () => fireEvent.click(within(decision).getByRole('button', { name: 'Send back' })));
    const sent = calls('POST', '/api/runs/r1/sendback')[0]![2] as { node: string; note: string };
    expect(sent.node).toBe('code');
    expect(sent.note).toBe('Not a constant\n\nComments on the diff:\n- src/limit.ts: "+ export const limit = 10;": Make it a setting');
    await waitFor(() => expect(loadComments('r1')).toMatchObject([{ text: 'Make it a setting', sent: true }]));
  });

  it('ships from the decision banner: Merge to main, or Open PR instead', async () => {
    open(makeAwaitingRun());
    const decision = await screen.findByRole('region', { name: 'Decision' });
    expect(within(decision).getByText('Checks pass. Ship it?')).toBeTruthy();
    await act(async () => fireEvent.click(within(decision).getByRole('button', { name: 'Merge to main' })));
    expect(calls('POST', '/api/runs/r1/ship')[0]![2]).toEqual({ merge: true });
  });

  it('a team run’s questions open in place as a row; planning comes first', async () => {
    open(makeRun({ kind: 'team', planning: true, round: 1, pipeline: { ...makeRun().pipeline, nodes: [], edges: [] }, nodes: {}, pending: [q1] }));
    expect(await screen.findByRole('radio', { name: /Postgres/ })).toBeTruthy();
    const story = screen.getByRole('navigation', { name: 'What happened' });
    expect(within(story).getByRole('button', { name: 'Tether is planning, working' })).toBeTruthy();
    expect(within(story).getByRole('group', { name: 'Tether asks you' })).toBeTruthy();
  });

  it('opens every event from More, and goes back to the list', async () => {
    const p = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Every event (raw timeline)' }));
    expect(await screen.findByRole('complementary', { name: 'Run details' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Runs' }));
    expect(p.onSelect).toHaveBeenCalledWith(undefined);
  });
});
