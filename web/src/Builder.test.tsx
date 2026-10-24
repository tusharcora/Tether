import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { Builder } from './Builder';
import { calls, makeRun, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const pcr = makeRun().pipeline;
const other = { ...pcr, name: 'other', nodes: pcr.nodes.slice(0, 1), edges: [] };

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({
    'GET /api/doctor': { claude: { ok: true }, codex: { ok: false } },
    'GET /api/pipelines': [{ name: 'plan-code-review', nodes: 3 }, { name: 'other', nodes: 1 }],
    'GET /api/pipelines/plan-code-review': { pipeline: pcr },
    'GET /api/pipelines/other': { pipeline: other },
    'POST /api/preflight': { issues: [] },
    'POST /api/runs': { id: 'r42' },
  });
});

describe('Builder', () => {
  it('opens plan-code-review by default, or the workflow it is given', async () => {
    const { unmount } = renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('Pipeline name') as HTMLInputElement).value).toBe('plan-code-review'));
    unmount();
    renderApp(<Builder pipeline="other" onStarted={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('Pipeline name') as HTMLInputElement).value).toBe('other'));
  });

  it('toggles the issue list from the status button', async () => {
    routeApi({
      'GET /api/doctor': { claude: { ok: true } },
      'GET /api/pipelines': [{ name: 'plan-code-review', nodes: 3 }],
      'GET /api/pipelines/plan-code-review': { pipeline: pcr },
      'POST /api/preflight': { issues: [{ level: 'warn', node: 'plan', message: 'no gate after plan' }] },
    });
    renderApp(<Builder onStarted={() => {}} />);
    const toggle = await screen.findByRole('button', { name: '1 warning' });
    expect(screen.queryByText('no gate after plan')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('no gate after plan')).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.queryByText('no gate after plan')).toBeNull();
  });

  it('chains a new step onto the last one and validates once after edits settle', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    // let the load's own validation finish on real timers before faking them
    await waitFor(() => expect(calls('POST', '/api/preflight').length).toBeGreaterThan(0));
    // fake only the debounce clock: a faked requestAnimationFrame strands motion's shared frame loop for the later tests
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.mocked(api).mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Reviewer/ }));
    fireEvent.change(screen.getByLabelText('Pipeline name'), { target: { value: 'plan-code-review-2' } });
    await act(() => vi.advanceTimersByTimeAsync(350));
    const pre = calls('POST', '/api/preflight');
    expect(pre).toHaveLength(1);
    const body = pre[0]![2] as typeof pcr;
    expect(body.nodes.at(-1)).toMatchObject({ id: 'review', role: 'reviewer', verdict: true });
    expect(body.edges).toContainEqual({ from: 'gate', to: 'review' });
  });

  it('starts a workflow run and a team run with the right body', async () => {
    const onStarted = vi.fn();
    renderApp(<Builder onStarted={onStarted} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    fireEvent.change(screen.getByLabelText(/Git repository/), { target: { value: '/code/app' } });
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Add caching' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start run' })));
    expect(calls('POST', '/api/runs')[0]![2]).toEqual({ pipeline: pcr, task: 'Add caching', repo: '/code/app', autoApprove: false });
    expect(onStarted).toHaveBeenCalledWith('r42');

    // the closing dialog stays mounted (hiding the page from role queries) until its exit animation ends
    fireEvent.click(await screen.findByRole('button', { name: /Run/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Add caching' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start run' })));
    expect(calls('POST', '/api/runs')[1]![2]).toEqual({ kind: 'team', mode: 'live', task: 'Add caching', repo: '/code/app' });
  });

  it('asks before discarding unsaved changes', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    fireEvent.change(screen.getByLabelText('Pipeline name'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Pipeline name') as HTMLInputElement).value).toBe('changed');
    fireEvent.click(await screen.findByRole('button', { name: 'New' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect((screen.getByLabelText('Pipeline name') as HTMLInputElement).value).toBe('untitled');
  });

  it('renders the agent select with "follow its bot" chosen without throwing', async () => {
    const { container } = renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    fireEvent.pointerDown(container.querySelector('[data-id="code"] .node-body')!, { pointerId: 1 });
    // Radix renders the chosen label twice in the trigger (screen-reader copy and the animated copy)
    expect((await screen.findAllByText(/follow .* \(set in Crew\)/)).length).toBeGreaterThan(0);
  });
});
