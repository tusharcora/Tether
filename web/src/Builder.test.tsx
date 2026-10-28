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

const routes = {
  'GET /api/doctor': { claude: { ok: true }, codex: { ok: false } },
  'GET /api/pipelines': [{ name: 'plan-code-review', nodes: 3 }, { name: 'other', nodes: 1 }],
  'GET /api/pipelines/plan-code-review': { pipeline: pcr },
  'GET /api/pipelines/other': { pipeline: other },
  'POST /api/preflight': { issues: [] },
  'POST /api/runs': { id: 'r42' },
  'GET /api/skills': [{ name: 'tdd-workflow', description: 'TDD', source: 'ecc', kind: 'skill' }],
  'GET /api/skills/ecc/tdd-workflow': { name: 'tdd-workflow', prompt: 'PROMPT' },
  'GET /api/http/tree': { workspace: 'api', activeEnv: null, environments: ['local', 'stage'], root: { path: '', name: '', requests: [{ id: 'health', name: 'Health', method: 'GET', url: '{{base}}/h' }], collections: [{ path: 'runs', name: 'runs', collections: [], requests: [{ id: 'runs/list', name: 'List runs', method: 'GET', url: '{{base}}/api/runs' }] }] } },
};
const openStep = (id: string) => fireEvent.pointerDown(document.querySelector(`[data-id="${id}"] .node-body`)!, { pointerId: 1 });
const lastBody = () => calls('POST', '/api/preflight').at(-1)?.[2] as typeof pcr;

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi(routes);
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
    fireEvent.click(screen.getByRole('button', { name: /Add step/ }));
    const menu = await screen.findByRole('dialog', { name: 'Add a step' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.mocked(api).mockClear();
    fireEvent.click(within(menu).getByText('Reviewer'));
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
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    fireEvent.change(screen.getByLabelText(/Git repository/), { target: { value: '/code/app' } });
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Add caching' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start run' })));
    expect(calls('POST', '/api/runs')[0]![2]).toEqual({ pipeline: pcr, task: 'Add caching', repo: '/code/app', autoApprove: false });
    expect(onStarted).toHaveBeenCalledWith('r42');

    // the closing dialog stays mounted (hiding the page from role queries) until its exit animation ends
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Add caching' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start run' })));
    expect(calls('POST', '/api/runs')[1]![2]).toEqual({ kind: 'team', mode: 'live', task: 'Add caching', repo: '/code/app' });
  });

  it('can start a run without the saved API requests in prompts', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
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
    const newWorkflow = () => (fireEvent.click(screen.getByRole('button', { name: 'Workflows' })), fireEvent.click(screen.getByRole('menuitem', { name: 'New workflow' })));
    newWorkflow();
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Pipeline name') as HTMLInputElement).value).toBe('changed');
    await screen.findByRole('button', { name: 'Workflows' });
    newWorkflow();
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

  it('adds steps from the bar and from the menu: steps, integrations after the selected step, skills', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await screen.findByDisplayValue('plan-code-review');
    await waitFor(() => expect(calls('POST', '/api/preflight').length).toBeGreaterThan(0));
    expect(screen.getByText('Saved')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approval' }));
    expect(document.querySelectorAll('[data-node]')).toHaveLength(4);
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add step/ }));
    const menu = await screen.findByRole('dialog', { name: 'Add a step' });
    expect(['Planner', 'Architect', 'Coder', 'Reviewer', 'Gate', 'GitHub', 'HTTP request', 'Webhook'].every((t) => within(menu).queryAllByText(t).length > 0)).toBe(true);
    // the new Approval step is selected, so the integrations can follow it
    fireEvent.click(within(menu).getByText('Webhook after approve'));
    await waitFor(() => expect(lastBody().edges).toContainEqual({ from: 'approve', to: 'gate2' }));
    fireEvent.click(screen.getByRole('button', { name: /Add step/ }));
    fireEvent.change(within(await screen.findByRole('dialog', { name: 'Add a step' })).getByRole('combobox'), { target: { value: 'tdd' } });
    await act(async () => fireEvent.click(await screen.findByText('tdd-workflow')));
    await waitFor(() => expect(lastBody().nodes.at(-1)).toMatchObject({ title: 'tdd-workflow', prompt: 'PROMPT' }));
  });

  it('edits a selected step in the dock and closes it with Esc', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await screen.findByDisplayValue('plan-code-review');
    openStep('code');
    const dock = screen.getByRole('complementary', { name: 'Step editor' });
    expect(within(dock).getByRole('heading', { level: 2, name: 'coder' })).toBeTruthy();
    expect(within(dock).getByText('Agent step')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Step editor' })).toBeNull();
    expect(document.querySelector('.node.selected')).toBeNull();
  });

  it('opens the workflow settings in the same dock from Settings', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await screen.findByDisplayValue('plan-code-review');
    openStep('code');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.queryByRole('complementary', { name: 'Step editor' })).toBeNull();
    const dock = screen.getByRole('complementary', { name: 'Workflow settings' });
    expect(within(dock).getByRole('heading', { level: 2, name: 'Workflow settings' })).toBeTruthy();
    expect(within(dock).getByLabelText('Step timeout (minutes)')).toBeTruthy();
    openStep('gate');
    expect(screen.queryByRole('complementary', { name: 'Workflow settings' })).toBeNull();
  });

  it('shows Save only with unsaved changes and the spend cap when one is set', async () => {
    routeApi({ ...routes, 'GET /api/pipelines/plan-code-review': { pipeline: { ...pcr, settings: { ...pcr.settings, maxCostUsd: 5 } } } });
    renderApp(<Builder onStarted={() => {}} />);
    await screen.findByDisplayValue('plan-code-review');
    expect(screen.getByText('$5 cap')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Pipeline name'), { target: { value: 'pcr-2' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('picks a workflow and starts a new one from the name menu', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await screen.findByDisplayValue('plan-code-review');
    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    expect(screen.getByRole('menuitem', { name: 'plan-code-review' }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'other' }));
    await waitFor(() => expect((screen.getByLabelText('Pipeline name') as HTMLInputElement).value).toBe('other'));
    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New workflow' }));
    expect((screen.getByLabelText('Pipeline name') as HTMLInputElement).value).toBe('untitled');
  });

  it('gives each step card corner actions: edit, duplicate, delete and run from here', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await screen.findByRole('heading', { level: 1, name: 'plan-code-review' });
    const card = document.querySelector('[data-node][data-id="plan"]') as HTMLElement;
    const bar = within(card).getByRole('toolbar');
    expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Run from here', 'Edit step', 'Duplicate step', 'Delete step']);
    // edit selects the step and opens it in the inspector
    fireEvent.click(within(bar).getByRole('button', { name: 'Edit step' }));
    expect(await screen.findByLabelText('Label')).toBeTruthy();
    // duplicate adds an unconnected copy and selects it
    fireEvent.click(within(bar).getByRole('button', { name: 'Duplicate step' }));
    expect(document.querySelector('[data-node][data-id="plan-copy"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-node]')).toHaveLength(4);
    // delete removes it again, with its connections
    fireEvent.click(within(document.querySelector('[data-node][data-id="plan-copy"]') as HTMLElement).getByRole('button', { name: 'Delete step' }));
    expect(document.querySelector('[data-node][data-id="plan-copy"]')).toBeNull();
  });

  it('runs from a step: a workflow of that step and the ones after it', async () => {
    const onStarted = vi.fn();
    renderApp(<Builder onStarted={onStarted} />);
    await screen.findByRole('heading', { level: 1, name: 'plan-code-review' });
    const card = document.querySelector('[data-node][data-id="code"]') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Run from here' }));
    expect(await screen.findByRole('dialog', { name: /from code/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Git repository/), { target: { value: '/code/app' } });
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Check it' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start run' })));
    const body = calls('POST', '/api/runs').at(-1)![2] as { pipeline: { name: string; nodes: { id: string }[]; edges: unknown[] } };
    expect(body.pipeline.name).toBe('plan-code-review-from-code');
    expect(body.pipeline.nodes.map((n) => n.id)).toEqual(['code', 'gate']);
    expect(body.pipeline.edges).toEqual([{ from: 'code', to: 'gate' }]);
    expect(onStarted).toHaveBeenCalledWith('r42');
  });

  it('offers the webhook and HTTP request integrations as ready-made steps, one that follows the selected step', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await screen.findByDisplayValue('plan-code-review');
    fireEvent.click(screen.getByRole('button', { name: /Add step/ }));
    expect(within(await screen.findByRole('dialog', { name: 'Add a step' })).queryByText(/ after /)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close command palette' }));
    fireEvent.click(screen.getByRole('button', { name: 'Webhook' }));
    expect(document.querySelectorAll('[data-node]')).toHaveLength(4);
    // the new gate is selected: its card holds the curl to the webhook
    expect(document.querySelector('.node.selected .node-preview')?.textContent).toContain('$WEBHOOK_URL');
    fireEvent.pointerDown(document.querySelector('[data-node][data-id="plan"] .node-title') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: /Add step/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Add a step' })).getByText('HTTP request after plan'));
    expect(document.querySelectorAll('[data-node]')).toHaveLength(5);
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

  it('edits a step with switches and goes to the workflow settings', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Workflow settings' })).toBeTruthy();
  });

  it('is view-and-run only at phone width', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === PHONE, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
    renderApp(<Builder onStarted={() => {}} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'plan-code-review' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add step/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    openStep('code');
    expect(screen.queryByRole('complementary', { name: 'Step editor' })).toBeNull();
    expect(screen.queryByLabelText('Pipeline name')).toBeNull();
    expect(screen.getByText('Editing needs a wider screen. You can look around and run this workflow.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();
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

  // The view is remembered for the page session (a module variable), so these run in order and end back on Canvas.
  const view = (m: 'Canvas' | 'Outline') => fireEvent.click(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: m }));

  it('switches between Canvas and Outline, keeping the selected step and its editor', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await screen.findByDisplayValue('plan-code-review');
    openStep('code');
    view('Outline');
    expect(document.querySelector('.canvas')).toBeNull();
    expect(screen.queryByRole('button', { name: /Add step/ })).toBeNull();
    expect(document.querySelector('.bl-blk[aria-pressed="true"]')!.textContent).toContain('coder');
    expect(screen.getByRole('complementary', { name: 'Step editor' })).toBeTruthy();
  });

  it('outlines the workflow: numbered blocks in run order, bot, chips, preview and the loop sentence', async () => {
    renderApp(<Builder onStarted={() => {}} />); // still Outline: the session remembers it
    await screen.findByDisplayValue('plan-code-review');
    expect(screen.getByRole('heading', { level: 2, name: 'plan-code-review' })).toBeTruthy();
    expect(screen.getByText('3 steps · Scout → Bolt → Probe')).toBeTruthy();
    const blocks = [...document.querySelectorAll('.bl-blk')];
    expect(blocks.map((b) => b.querySelector('.bl-blk-n')!.textContent)).toEqual(['1', '2', '3']);
    expect(blocks[0]!.textContent).toContain('read-only');
    expect(blocks[2]!.textContent).toContain('$ npm test');
    expect(blocks[2]!.textContent).toContain('If it fails, the output goes back to coder, up to 2 times.');
    fireEvent.click(blocks[0]!);
    expect(within(screen.getByRole('complementary', { name: 'Step editor' })).getByRole('heading', { level: 2, name: 'planner' })).toBeTruthy();
    view('Canvas');
  });

  it('outlines an empty and a branching workflow', async () => {
    const branchy = { ...pcr, name: 'other', nodes: [...pcr.nodes, { id: 'docs', kind: 'agent' as const, role: 'planner', x: 520, y: 200 }], edges: [...pcr.edges, { from: 'code', to: 'docs' }] };
    routeApi({ ...routes, 'GET /api/pipelines/other': { pipeline: branchy } });
    renderApp(<Builder pipeline="other" onStarted={() => {}} />);
    await screen.findByDisplayValue('other');
    view('Outline');
    expect(document.querySelectorAll('.bl-blk')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New workflow' }));
    expect(screen.getByText('No steps yet')).toBeTruthy();
    expect(document.querySelectorAll('.bl-blk')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /type \/ to add a step/ }));
    expect(screen.getByRole('dialog', { name: 'Add a step' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close command palette' }));
    view('Canvas');
  });

  it('"/" opens the add-step menu, but types a slash in fields', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await screen.findByDisplayValue('plan-code-review');
    fireEvent.keyDown(screen.getByLabelText('Pipeline name'), { key: '/' });
    expect(screen.queryByRole('dialog', { name: 'Add a step' })).toBeNull();
    fireEvent.keyDown(document.body, { key: '/', metaKey: true });
    expect(screen.queryByRole('dialog', { name: 'Add a step' })).toBeNull();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.getByRole('dialog', { name: 'Add a step' })).toBeTruthy();
  });
});
