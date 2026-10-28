import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type Question } from '../api';
import { Runs } from '../Runs';
import { cssRule } from '../test/css';
import { FakeEventSource, makeAwaitingRun, makeRow, makeRun, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { ApprovalBar, gateSummary } from './ApprovalBar';
import { RunHeader } from './RunHeader';
import { RunNotices } from './RunNotices';

const act0 = vi.fn(async () => true);

describe('run header, notices and approval bar', () => {
  it('heads the run with its task, badge, kind tag and one mono line', () => {
    renderApp(<RunHeader run={makeRun({ pipeline: { ...makeRun().pipeline, settings: { ...makeRun().pipeline.settings, maxCostUsd: 5 } } })} onAct={act0} onBack={() => {}} onDetails={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Add rate limiting' })).toBeTruthy();
    expect(screen.getByText(/^R-\w+ · plan-code-review · \d+:\d{2} · \$0\.12 of \$5\.00$/)).toBeTruthy();
    expect(document.querySelector('[data-status="loading"]')!.textContent).toContain('running');
    expect(screen.getByText('plan-code-review', { selector: '.sl-tag' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run details' })).toBeTruthy();
  });
  it('reads a finished run’s time as a duration and goes back to the list', () => {
    const onBack = vi.fn();
    const t = Date.now();
    renderApp(<RunHeader run={makeRun({ status: 'done', live: false, startedAt: t - 3 * 86_400_000 - 16 * 3_600_000, finishedAt: t })} onAct={act0} onBack={onBack} onDetails={() => {}} />);
    expect(screen.getByText(/ · 3d 16h · /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Runs' }));
    expect(onBack).toHaveBeenCalled();
  });
  it('says interrupted in the badge, not a separate chip', () => {
    renderApp(<RunHeader run={makeRun({ live: false })} onAct={act0} onBack={() => {}} onDetails={() => {}} />);
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
  it('puts a waiting approval in a sticky bar with Review diff, Reject and Approve', async () => {
    const onAct = vi.fn(async () => true);
    const review = vi.fn();
    renderApp(<ApprovalBar run={makeAwaitingRun()} onAct={onAct} onReviewDiff={review} />);
    expect(screen.getByText('Approve Ship it (ship)?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review diff' }));
    expect(review).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith('approve', { node: 'ship', approved: false }));
    expect(cssRule('runs/runs.css', '.run-approve')).toContain('position: sticky');
  });
  it('shows no approval bar when nothing waits', () => {
    const { container } = renderApp(<ApprovalBar run={makeRun()} onAct={act0} onReviewDiff={() => {}} />);
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
    FakeEventSource.all = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    routeApi({ 'GET /api/runs': [makeRow()], 'GET /api/runs/r1/events': [], 'GET /api/runs/r1/diff': { diff: '' } });
  });

  it('lays out header, graph, output and files, full width with no runs list', async () => {
    open();
    act(() => FakeEventSource.all[0]!.emit('event', { seq: 1, ts: Date.now(), event: { type: 'node.started', node: 'code', attempt: 1 } }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Add rate limiting' })).toBeTruthy();
    expect(document.querySelector('.rg [data-id="code"]')).toBeTruthy();
    expect(screen.getByText('Files · branch aorch/r1')).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Runs' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Runs' })).toBeNull();
    expect(document.querySelector('.out-line[data-node="code"]')!.textContent).toContain('started');
    expect(await screen.findByText('No committed changes yet.')).toBeTruthy();
  });
  it('opens a step from an output line', async () => {
    const p = open();
    act(() => FakeEventSource.all[0]!.emit('event', { seq: 1, ts: Date.now(), event: { type: 'node.started', node: 'code', attempt: 1 } }));
    await screen.findByRole('heading', { level: 1, name: 'Add rate limiting' });
    fireEvent.click(document.querySelector('.out-line[data-node="code"]')!);
    expect(p.onSelectNode).toHaveBeenCalledWith('code');
  });
  it('goes back to the list', async () => {
    const p = open();
    fireEvent.click(await screen.findByRole('button', { name: '← Runs' }));
    expect(p.onSelect).toHaveBeenCalledWith(undefined);
  });
  it('renders a team run before approval without a graph, with its questions inline', async () => {
    open(makeRun({ kind: 'team', planning: true, pipeline: { ...makeRun().pipeline, nodes: [], edges: [] }, nodes: {}, pending: [q1] }));
    expect(await screen.findByRole('radio', { name: /Postgres/ })).toBeTruthy();
    expect(document.querySelector('.rg')).toBeNull();
    expect(document.querySelector('.run-split')).toBeNull();
  });
  it('says Tether is planning while a team run plans with nothing to ask', async () => {
    open(makeRun({ kind: 'team', planning: true, pipeline: { ...makeRun().pipeline, nodes: [], edges: [] }, nodes: {} }));
    expect((await screen.findByText('Tether is planning…')).className).toBe('sl-quiet');
  });
  it('collapses planning and the team plan into disclosure rows', async () => {
    const answers = [1, 2, 3, 4, 5].map((i) => ({ question: `c${i}`, option: 'a', by: 'user' as const }));
    open(makeRun({ kind: 'team', cards: answers.map((a) => ({ ...q1, id: a.question })), answers }));
    const planning = await screen.findByRole('button', { name: /Planning · 5 answers/ });
    expect(planning.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: /Team plan · 1 of 3/ }).getAttribute('aria-expanded')).toBe('false');
  });
  it('puts the approval bar on the page and opens the run changes from Review diff', async () => {
    open(makeAwaitingRun());
    fireEvent.click(await screen.findByRole('button', { name: 'Review diff' }));
    expect(await screen.findByRole('dialog', { name: 'Inspector' })).toBeTruthy();
  });
  it('keeps the team plan inside the page width', () => expect(cssRule('runs/runs.css', '.run-disclosure')).toContain('min-width: 0'));
});
