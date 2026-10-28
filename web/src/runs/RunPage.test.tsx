import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { cssRule } from '../test/css';
import { makeAwaitingRun, makeRun } from '../test/fixtures';
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
