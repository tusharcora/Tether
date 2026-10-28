import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { Builder } from './Builder';
import { calls, makeRun, routeApi } from './test/fixtures';
import { renderApp } from './test/render';
import { PHONE } from './ui/studio/useMediaQuery';

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
    'GET /api/skills': [{ name: 'tdd-workflow', description: 'TDD', source: 'ecc', kind: 'skill' }],
    'GET /api/skills/ecc/tdd-workflow': { name: 'tdd-workflow', prompt: 'PROMPT' },
    'GET /api/http/tree': { workspace: 'api', activeEnv: null, environments: ['local', 'stage'], root: { path: '', name: '', requests: [{ id: 'health', name: 'Health', method: 'GET', url: '{{base}}/h' }], collections: [{ path: 'runs', name: 'runs', collections: [], requests: [{ id: 'runs/list', name: 'List runs', method: 'GET', url: '{{base}}/api/runs' }] }] } },
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

  it('can start a run without the saved API requests in prompts', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    fireEvent.change(screen.getByLabelText(/Git repository/), { target: { value: '/code/app' } });
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Add caching' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /saved API requests/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start run' })));
    expect(calls('POST', '/api/runs')[0]![2]).toEqual({ pipeline: pcr, task: 'Add caching', repo: '/code/app', autoApprove: false, endpoints: false });
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

  it('sets a step’s tool calls to follow its bot, Code Mode or Direct, and checks the pipeline with it', async () => {
    const { container } = renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    fireEvent.pointerDown(container.querySelector('[data-id="code"] .node-body')!, { pointerId: 1 });
    const group = await screen.findByRole('group', { name: 'Tool calls' });
    expect(within(group).getByRole('button', { name: 'Follow bot' }).getAttribute('aria-pressed')).toBe('true');
    const before = calls('POST', '/api/preflight').length;
    fireEvent.click(within(group).getByRole('button', { name: 'Direct' }));
    expect(within(group).getByRole('button', { name: 'Direct' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(calls('POST', '/api/preflight').length).toBeGreaterThan(before));
    const sent = calls('POST', '/api/preflight').at(-1)![2] as { nodes: { id: string; toolStyle?: string }[] };
    expect(sent.nodes.find((n) => n.id === 'code')!.toolStyle).toBe('direct');
    fireEvent.click(within(group).getByRole('button', { name: 'Follow bot' }));
    expect(within(group).getByRole('button', { name: 'Follow bot' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('adds an ECC skill as a step', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    await waitFor(() => expect(calls('POST', '/api/preflight').length).toBeGreaterThan(0));
    vi.mocked(api).mockClear();
    fireEvent.change(screen.getByLabelText('Find a skill'), { target: { value: 'tdd' } });
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: /tdd-workflow/ })));
    await waitFor(() => {
      const body = calls('POST', '/api/preflight').at(-1)?.[2] as { nodes: { title?: string; prompt?: string }[] } | undefined;
      expect(body?.nodes.at(-1)).toMatchObject({ title: 'tdd-workflow', prompt: 'PROMPT' });
    });
  });
  it('switches a gate between a command and a saved request', async () => {
    const { container } = renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    await waitFor(() => expect(calls('POST', '/api/preflight').length).toBeGreaterThan(0));
    fireEvent.pointerDown(container.querySelector('[data-id="gate"] .node-body')!, { pointerId: 1 });
    fireEvent.change(screen.getByLabelText('Command (exit 0 = pass)'), { target: { value: 'npm run check' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    expect(await screen.findByText(/Saved request/)).toBeTruthy();
    expect(screen.queryByLabelText('Command (exit 0 = pass)')).toBeNull();
    await waitFor(() => {
      const body = calls('POST', '/api/preflight').at(-1)?.[2] as { nodes: { id: string; command?: string; http?: unknown }[] };
      const g = body.nodes.find((n) => n.id === 'gate')!;
      expect(g.command).toBeUndefined();
      expect(g.http).toEqual({ run: 'health' });
    });
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: '130' } });
    fireEvent.click(screen.getByRole('button', { name: 'Last send' }));
    await waitFor(() => {
      const body = calls('POST', '/api/preflight').at(-1)?.[2] as { nodes: { id: string; http?: unknown }[] };
      expect(body.nodes.find((n) => n.id === 'gate')!.http).toEqual({ run: 'health', repeat: 130, expect: 'last' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Command' }));
    expect((screen.getByLabelText('Command (exit 0 = pass)') as HTMLInputElement).value).toBe('npm run check');
    // exactly one of the two is ever kept: back on Command, the request settings are gone
    await waitFor(() => {
      const body = calls('POST', '/api/preflight').at(-1)?.[2] as { nodes: { id: string; command?: string; http?: unknown }[] };
      const g = body.nodes.find((n) => n.id === 'gate')!;
      expect(g.http).toBeUndefined();
      expect(g.command).toBe('npm run check');
    });
  });

  it('keeps a request gate half-filled while there is no saved request to pick', async () => {
    routeApi({
      'GET /api/doctor': {},
      'GET /api/pipelines': [{ name: 'plan-code-review', nodes: 3 }],
      'GET /api/pipelines/plan-code-review': { pipeline: pcr },
      'POST /api/preflight': { issues: [] },
      'GET /api/http/tree': { workspace: 'api', activeEnv: null, environments: [], root: { path: '', name: '', requests: [], collections: [] } },
    });
    const { container } = renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    await waitFor(() => expect(calls('POST', '/api/preflight').length).toBeGreaterThan(0));
    fireEvent.pointerDown(container.querySelector('[data-id="gate"] .node-body')!, { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    expect((await screen.findAllByText('no saved requests yet')).length).toBeGreaterThan(0);
    await waitFor(() => {
      const body = calls('POST', '/api/preflight').at(-1)?.[2] as { nodes: { id: string; command?: string; http?: unknown }[] };
      const g = body.nodes.find((n) => n.id === 'gate')!;
      expect(g.command).toBeUndefined();
      expect(g.http).toEqual({ run: '' });
    });
  });

  it('adds a prefilled request gate handed over from the API tab, once', async () => {
    const used = vi.fn();
    renderApp(<Builder onStarted={() => {}} gate={{ run: 'runs/list', env: 'local' }} onGateUsed={used} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    await waitFor(() => {
      const body = calls('POST', '/api/preflight').at(-1)?.[2] as { nodes: { id: string; kind: string; http?: unknown; title?: string }[]; edges: { from: string; to: string }[] } | undefined;
      const g = body?.nodes.at(-1);
      expect(g).toMatchObject({ kind: 'gate', title: 'list', http: { run: 'runs/list', env: 'local' } });
    });
    expect(used).toHaveBeenCalledTimes(1);
  });

  it('puts the workflow, step and loop counts in the header and adds steps from the palette', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'plan-code-review' })).toBeTruthy();
    expect(screen.getByText('workflows / plan-code-review · 3 steps · 1 fix loop')).toBeTruthy();
    expect(screen.getByText('Saved')).toBeTruthy();
    const palette = screen.getByRole('complementary', { name: 'Steps palette' });
    expect([...palette.querySelectorAll('.bl-item:not(.bl-skill) .bl-item-name')].map((e) => e.textContent)).toEqual(['Planner', 'Architect', 'Coder', 'Reviewer', 'Gate', 'Approval']);
    fireEvent.click(within(palette).getByRole('button', { name: /Approval/ }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.getByText('workflows / plan-code-review · 4 steps · 1 fix loop')).toBeTruthy();
  });

  it('selects the step an issue names', async () => {
    routeApi({
      'GET /api/doctor': {},
      'GET /api/pipelines': [{ name: 'plan-code-review', nodes: 3 }],
      'GET /api/pipelines/plan-code-review': { pipeline: pcr },
      'POST /api/preflight': { issues: [{ level: 'error', node: 'code', message: 'needs a role' }] },
    });
    renderApp(<Builder onStarted={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: '1 error' }));
    expect(screen.getByText('needs a role')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'code' }));
    expect(await screen.findByLabelText('Instructions (blank = default for the role)')).toBeTruthy();
  });

  it('edits a step with switches and goes back to the pipeline settings', async () => {
    const { container } = renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    await waitFor(() => expect(calls('POST', '/api/preflight').length).toBeGreaterThan(0));
    fireEvent.pointerDown(container.querySelector('[data-id="code"] .node-body')!, { pointerId: 1 });
    expect(screen.getByRole('heading', { level: 2, name: 'coder' })).toBeTruthy();
    expect(screen.getByText('Agent step')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Must end with VERDICT: PASS / FAIL' }));
    await waitFor(() => {
      const body = calls('POST', '/api/preflight').at(-1)?.[2] as typeof pcr;
      expect(body.nodes.find((n) => n.id === 'code')).toMatchObject({ verdict: true });
    });
    fireEvent.click(screen.getByRole('button', { name: /^Pipeline settings: mode pipeline · 4 parallel read-only · 30 min timeout/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Pipeline settings' })).toBeTruthy();
  });

  it('is view-and-run only at phone width', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === PHONE, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
    renderApp(<Builder onStarted={() => {}} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'plan-code-review' })).toBeTruthy();
    expect(screen.queryByRole('complementary', { name: 'Steps palette' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Step inspector' })).toBeNull();
    expect(screen.queryByLabelText('Pipeline name')).toBeNull();
    expect(screen.getByText('Editing needs a wider screen. You can look around and run this workflow.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Run/ })).toBeTruthy();
    expect(screen.getByText('Drag to pan · use + / − to zoom')).toBeTruthy();
  });

  it('shows issues without their step buttons at phone width (there is no inspector to open)', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === PHONE, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
    routeApi({
      'GET /api/doctor': { claude: { ok: true } },
      'GET /api/pipelines': [{ name: 'plan-code-review', nodes: 3 }],
      'GET /api/pipelines/plan-code-review': { pipeline: pcr },
      'POST /api/preflight': { issues: [{ level: 'warn', node: 'plan', message: 'no gate after plan' }] },
    });
    renderApp(<Builder onStarted={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: '1 warning' }));
    expect(screen.getByText('no gate after plan')).toBeTruthy();
    expect(document.querySelector('.bl-issue-node')).toBeNull();
  });
});
