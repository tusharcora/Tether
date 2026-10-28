import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { cssRule } from '../test/css';
import { renderApp } from '../test/render';
import { ApiTab } from './ApiTab';
import { latencyBars } from './Tree';

const req = (name: string, url = '{{base}}/api/runs') => ({ v: 1, name, method: 'GET', url, query: [], headers: [], body: { kind: 'none' }, vars: {}, checks: [] });
const tree = {
  workspace: 'api',
  activeEnv: 'local',
  environments: ['local', 'stage'],
  root: {
    path: '', name: '',
    requests: [{ id: 'broken', name: 'broken', method: '?', url: '', invalid: 'unknown method "FETCH"' }],
    collections: [{ path: 'runs', name: 'runs', collections: [], requests: [{ id: 'runs/list', name: 'List runs', method: 'GET', url: '{{base}}/api/runs' }, { id: 'runs/start', name: 'Start run', method: 'POST', url: '{{base}}/api/runs' }] }],
  },
};
const out = { historyId: 5, request: { method: 'GET', url: 'http://h/api/runs', headers: [] }, result: { status: 200, statusText: 'OK', url: 'http://h/api/runs', headers: [], body: '[]', size: 2, truncated: false, ms: 12, timing: { ttfb: 10, download: 2 }, redirects: [] }, checks: [] };
const hist = (ms: number, status: number, id: number) => ({ id, ts: id, workspace: 'api', request: null, source: 'ui', runId: null, method: 'GET', url: 'u', status, ms, size: 1, ok: null, data: {} });

let routes: Record<string, unknown>;
beforeEach(() => {
  vi.mocked(api).mockReset();
  localStorage.clear();
  routes = {
    'GET /api/workspaces': [{ id: 'api', name: 'API', path: '/code/api', isDefault: true, exists: true, repos: [] }],
    'GET /api/http/tree': tree,
    'GET /api/http/history': [hist(30, 200, 4), hist(1500, 200, 3), hist(20, 404, 2)],
    'GET /api/http/requests/runs%2Flist': { id: 'runs/list', file: req('List runs'), vars: { base: { source: { from: 'env', env: 'local' }, value: 'http://h' } } },
    'GET /api/http/requests/runs%2Fstart': { id: 'runs/start', file: req('Start run'), vars: {} },
    'GET /api/http/requests/broken': { id: 'broken', error: 'unknown method "FETCH"', vars: {}, raw: '{ "method": "FETCH" }' },
    'PUT /api/http/active-env': (b: { name: string | null }) => ({ activeEnv: b.name }),
    'POST /api/http/send': out,
    'PUT /api/http/requests/runs%2Flist': (b: unknown) => ({ id: 'runs/list', file: b }),
    'POST /api/http/requests': { id: 'new-request' },
    'GET /api/http/secrets': { keys: [] },
  };
  routeApi(routes);
});

describe('latency strip', () => {
  it('shows sends oldest first, scaled to the slowest, with errors and slow ones amber', () => {
    // the server lists history newest first (ids descending)
    const bars = latencyBars([hist(30, 200, 4), hist(1500, 200, 3), hist(20, 404, 2)] as never);
    expect(bars.map((b) => [b.id, b.pct, b.amber])).toEqual([[2, 2, true], [3, 100, true], [4, 2, false]]);
  });
});

const history = () => fireEvent.click(within(screen.getByRole('group', { name: 'Response or history' })).getByRole('button', { name: 'History' }));
const agentDock = () => fireEvent.click(screen.getByRole('button', { name: 'Send to agent' }));

describe('ApiTab', () => {
  it('follows the current project, opens a requested request once its workspace is shown, and reports what is open', async () => {
    const onOpenRequest = vi.fn();
    const { rerender } = renderApp(<ApiTab workspace="api" request="runs/list" onOpenRequest={onOpenRequest} onStarted={() => {}} onUseAsGate={() => {}} />);
    await waitFor(() => expect(onOpenRequest).toHaveBeenLastCalledWith({ id: 'runs/list', label: 'List runs' }));
    expect(calls('GET', '/api/http/tree?ws=api').length).toBeGreaterThan(0);
    rerender(<ApiTab workspace="blog" request="runs/list" onOpenRequest={onOpenRequest} onStarted={() => {}} onUseAsGate={() => {}} />);
    await waitFor(() => expect(calls('GET', '/api/http/tree?ws=blog').length).toBeGreaterThan(0));
    expect(localStorage.getItem('aorch.api.ws')).toBe('blog');
    await waitFor(() => expect(calls('GET', '/api/http/requests/runs%2Flist?ws=blog')).toHaveLength(1));
  });

  it('asks to register a folder when there is no workspace', async () => {
    routeApi({ ...routes, 'GET /api/http/tree': new Error('no workspace'), 'GET /api/workspaces': [] });
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    expect(await screen.findByText('No workspace yet')).toBeTruthy();
    expect(screen.getByText(/tether workspace init/)).toBeTruthy();
  });

  it('offers Import or New when there are no requests', async () => {
    routeApi({ ...routes, 'GET /api/http/tree': { ...tree, root: { path: '', name: '', requests: [], collections: [] } } });
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    expect(await screen.findByText(/^No saved requests yet/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Import' }).length).toBeGreaterThan(0);
  });

  it('lists requests with method badges, filters, switches environment', async () => {
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    expect(await screen.findByRole('button', { name: 'GET List runs' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'POST Start run' }).querySelector('.method')!.getAttribute('data-method')).toBe('POST');
    fireEvent.change(screen.getByLabelText('Filter requests'), { target: { value: 'start' } });
    expect(screen.queryByRole('button', { name: 'GET List runs' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter requests'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Environment' }));
    expect(screen.getByRole('menuitem', { name: 'local' }).getAttribute('aria-current')).toBe('true');
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'stage' })));
    expect(calls('PUT', '/api/http/active-env')[0]![2]).toEqual({ name: 'stage' });
    history();
    expect(screen.getByLabelText('Last 20 sends').querySelectorAll('.lat')).toHaveLength(3);
  });

  it('opens a request, sends it by id, and sends a draft once edited', async () => {
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    const list = await screen.findByRole('button', { name: 'GET List runs' });
    await act(async () => fireEvent.click(list));
    expect((screen.getByLabelText('Request name') as HTMLInputElement).value).toBe('List runs');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Send(?! to)/ })));
    expect(calls('POST', '/api/http/send')[0]![2]).toEqual({ id: 'runs/list' });
    expect(await screen.findByText('200 OK')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'List all runs' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Send(?! to)/ })));
    expect(calls('POST', '/api/http/send')[1]![2]).toMatchObject({ id: 'runs/list', draft: { name: 'List all runs' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Save/ })));
    expect(calls('PUT', '/api/http/requests/runs%2Flist')[0]![2]).toMatchObject({ name: 'List all runs' });
  });

  it('asks before dropping unsaved edits when another request is opened', async () => {
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    const list = await screen.findByRole('button', { name: 'GET List runs' });
    await act(async () => fireEvent.click(list));
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'POST Start run' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Request name') as HTMLInputElement).value).toBe('edited');
    fireEvent.click(screen.getByRole('button', { name: 'New request' }));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Discard' })));
    await waitFor(() => expect((screen.getByLabelText('Request name') as HTMLInputElement).value).toBe('New request'));
  });

  it('saves a new request through create, deriving the id on the server', async () => {
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    await screen.findByRole('button', { name: 'GET List runs' });
    fireEvent.click(screen.getByRole('button', { name: 'New request' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Save/ })));
    expect(calls('POST', '/api/http/requests')[0]![2]).toMatchObject({ collection: '', file: { name: 'New request' } });
  });

  it('an invalid file shows its error and read-only JSON', async () => {
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    const row = await screen.findByRole('button', { name: /broken/ });
    expect(row.getAttribute('title')).toBe('unknown method "FETCH"');
    await act(async () => fireEvent.click(row));
    expect(screen.getByRole('alert').textContent).toContain('unknown method "FETCH"');
    expect((screen.getByLabelText('File contents (read-only)') as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it('opens a past send from the latency strip and hands that exchange to the agent panel', async () => {
    const past = { ...hist(1500, 200, 3), url: 'http://h/api/runs', data: { request: out.request, response: { ...out.result, ms: 1500 }, checks: [] } };
    routeApi({ ...routes, 'GET /api/http/history': [past], 'POST /api/http/send-to-agent': { runId: 'r7' }, 'GET /api/crew': { bots: [] } });
    const started = vi.fn();
    renderApp(<ApiTab onStarted={started} onUseAsGate={() => {}} />);
    await screen.findByRole('button', { name: 'GET List runs' });
    history();
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'GET 200 · 1500 ms' })));
    // the pick shows that exchange on the Response tab
    expect(screen.getByText('200 OK')).toBeTruthy();
    expect(screen.getByText('1500 ms', { selector: '.resp-head .mono' })).toBeTruthy();
    history();
    expect(screen.getByRole('button', { name: 'GET 200 · 1500 ms' }).getAttribute('aria-pressed')).toBe('true');
    agentDock();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Start run with/ })));
    expect(calls('POST', '/api/http/send-to-agent')[0]![2]).toMatchObject({ historyId: 3 });
    expect(started).toHaveBeenCalledWith('r7');
  });

  it('lists the sends in a history table: sortable, and a row opens that exchange', async () => {
    const past = (id: number, ms: number, status: number, url: string) => ({ ...hist(ms, status, id), url, data: { request: out.request, response: { ...out.result, status, ms }, checks: [] } });
    routeApi({ ...routes, 'GET /api/http/history': [past(9, 40, 200, 'http://h/api/runs'), past(8, 900, 404, 'http://h/api/orders?x=1')] });
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    await screen.findByRole('button', { name: 'GET List runs' });
    history();
    const table = await screen.findByRole('table', { name: 'Send history' });
    const order = () => within(table).getAllByRole('row').slice(1).map((r) => r.getAttribute('aria-label'));
    expect(order()).toEqual(['GET /api/runs, 200', 'GET /api/orders?x=1, 404']);
    fireEvent.click(within(table).getByRole('button', { name: /^Time/ }));
    expect(order()).toEqual(['GET /api/runs, 200', 'GET /api/orders?x=1, 404']);
    fireEvent.click(within(table).getByRole('button', { name: /^Time/ }));
    expect(order()).toEqual(['GET /api/orders?x=1, 404', 'GET /api/runs, 200']);
    await act(async () => fireEvent.click(within(table).getByRole('row', { name: 'GET /api/orders?x=1, 404' })));
    expect(screen.getByText('404 OK')).toBeTruthy();
  });

  it('says so when the history cannot be loaded, instead of an empty strip', async () => {
    routeApi({ ...routes, 'GET /api/http/history': new Error('database is locked') });
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    await screen.findByRole('button', { name: 'GET List runs' });
    await waitFor(() => expect(screen.getByRole('group', { name: 'Response or history' })).toBeTruthy());
    history();
    expect((await screen.findByText(/database is locked/)).textContent).toContain('History');
  });

  it('shows a tree load failure inline', async () => {
    routeApi({ ...routes, 'GET /api/http/tree': new Error('EACCES: .aorch/http') });
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toContain('EACCES: .aorch/http');
  });

  it('a clean request opens straight away, and Keep editing on New request keeps the draft', async () => {
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    const list = await screen.findByRole('button', { name: 'GET List runs' });
    await act(async () => fireEvent.click(list));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'POST Start run' })));
    expect(screen.queryByRole('button', { name: 'Keep editing' })).toBeNull();
    expect((screen.getByLabelText('Request name') as HTMLInputElement).value).toBe('Start run');
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'New request' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Request name') as HTMLInputElement).value).toBe('edited');
    expect(calls('POST', '/api/http/requests')).toHaveLength(0);
  });

  it('drops a send that finishes after another request was opened: no response, no spinner, nothing to hand over', async () => {
    let finish!: (v: unknown) => void;
    routeApi({ ...routes, 'POST /api/http/send': () => new Promise((r) => (finish = r)), 'GET /api/crew': { bots: [] } });
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    const list = await screen.findByRole('button', { name: 'GET List runs' });
    await act(async () => fireEvent.click(list));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Send(?! to)/ })));
    expect(screen.getByRole('button', { name: /^Send(?! to)/ }).getAttribute('aria-busy')).toBe('true');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'POST Start run' })));
    expect((screen.getByLabelText('Request name') as HTMLInputElement).value).toBe('Start run');
    await act(async () => finish(structuredClone(out)));
    expect(screen.queryByText('200 OK')).toBeNull();
    expect(screen.getByRole('button', { name: /^Send(?! to)/ }).getAttribute('aria-busy')).toBeNull();
    agentDock();
    expect((screen.getByRole('button', { name: /^Start run with/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('when request responses arrive out of order, the last one opened wins', async () => {
    let finish!: (v: unknown) => void;
    routeApi({ ...routes, 'GET /api/http/requests/runs%2Flist': () => new Promise((r) => (finish = r)) });
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    const list = await screen.findByRole('button', { name: 'GET List runs' });
    await act(async () => fireEvent.click(list));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'POST Start run' })));
    await act(async () => finish({ id: 'runs/list', file: req('List runs'), vars: {} }));
    expect((screen.getByLabelText('Request name') as HTMLInputElement).value).toBe('Start run');
    expect(screen.getByRole('button', { name: 'POST Start run' }).getAttribute('aria-current')).toBe('true');
  });

  it('warns before the page unloads only while there are unsaved edits, and reports them to the shell', async () => {
    const dirty = vi.fn();
    const unload = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} onDirtyChange={dirty} />);
    const list = await screen.findByRole('button', { name: 'GET List runs' });
    await act(async () => fireEvent.click(list));
    expect(unload()).toBe(false);
    fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'edited' } });
    expect(unload()).toBe(true);
    expect(dirty).toHaveBeenLastCalledWith(true);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Save/ })));
    expect(unload()).toBe(false);
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it('exports the workspace as a download named like the CLI, without secrets, and says what was left out', async () => {
    routeApi({ ...routes, 'GET /api/workspaces/api/export': { fileName: 'api-server.aorch.json', bundle: { v: 1, workspace: { name: 'API' }, notes: '', http: { files: {} } }, skipped: [{ path: '.aorch/http/stray.txt', reason: 'not a .json file with an allowed name' }] } });
    const created: Blob[] = [];
    const names: string[] = [];
    // jsdom has no object URLs and does not download on click; give it just enough to capture the download
    const revoked: string[] = [];
    Object.assign(URL, { createObjectURL: (b: Blob) => (created.push(b), 'blob:x'), revokeObjectURL: (u: string) => void revoked.push(u) });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    await screen.findByRole('button', { name: 'GET List runs' });
    fireEvent.click(screen.getByRole('button', { name: 'Import · Export' }));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Export workspace' })));
    expect(calls('GET', '/api/workspaces/api/export')).toHaveLength(1);
    expect(JSON.parse(await created[0]!.text())).toEqual({ v: 1, workspace: { name: 'API' }, notes: '', http: { files: {} } });
    expect(names).toEqual(['api-server.aorch.json']);
    // the object URL lives on after the click (a browser may start the download later), then is released
    expect(revoked).toEqual([]);
    await waitFor(() => expect(revoked).toEqual(['blob:x']), { timeout: 3000 });
    expect(await screen.findByText(/stray\.txt/)).toBeTruthy();
    click.mockRestore();
  });

  it('opens the workspace import dialog from the Import · Export menu', async () => {
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    await screen.findByRole('button', { name: 'GET List runs' });
    fireEvent.click(screen.getByRole('button', { name: 'Import · Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import workspace…' }));
    expect(await screen.findByText('Import a workspace')).toBeTruthy();
  });

  it('a send from the old workspace that lands after a switch leaves the new workspace\'s history alone', async () => {
    let finish!: (v: unknown) => void;
    routeApi({
      ...routes,
      'GET /api/workspaces': [{ id: 'api', name: 'API', path: '/code/api', isDefault: true, exists: true, repos: [] }, { id: 'b', name: 'B', path: '/code/b', isDefault: false, exists: true, repos: [] }],
      'GET /api/http/history?ws=b&limit=20': [hist(40, 200, 9)],
      'POST /api/http/send': () => new Promise((r) => (finish = r)),
    });
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    const list = await screen.findByRole('button', { name: 'GET List runs' });
    await act(async () => fireEvent.click(list));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Send(?! to)/ })));
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'B' })));
    history();
    await waitFor(() => expect(screen.getByLabelText('Last 20 sends').querySelectorAll('.lat')).toHaveLength(1));
    const oldHistory = () => calls('GET', '/api/http/history?limit=20').length;
    const before = oldHistory();
    await act(async () => finish(structuredClone(out)));
    expect(oldHistory()).toBe(before);
    expect(screen.getByLabelText('Last 20 sends').querySelectorAll('.lat')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'GET 200 · 40 ms' })).toBeTruthy();
  });
});

describe('ApiTab in the tool frame', () => {
  it('keeps the request tree in a left dock with New request at its foot, and the screen actions on top', async () => {
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    const dock = await screen.findByRole('complementary', { name: 'Requests' });
    expect(within(dock).getByRole('navigation', { name: 'Saved requests' })).toBeTruthy();
    expect(within(dock).getByRole('button', { name: 'New request' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'API client' })).toBeTruthy();
    for (const name of ['Workspace', 'Environment', 'Secrets', 'Import · Export', '+ New request']) expect(screen.getByRole('button', { name })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Secrets' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('opens Send to agent in the dock from the response card, and Esc closes it', async () => {
    routeApi({ ...routes, 'GET /api/crew': { bots: [] } });
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    const list = await screen.findByRole('button', { name: 'GET List runs' });
    await act(async () => fireEvent.click(list));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Send(?! to)/ })));
    expect(screen.queryByRole('complementary', { name: 'Send to agent' })).toBeNull();
    agentDock();
    const dock = screen.getByRole('complementary', { name: 'Send to agent' });
    expect((within(dock).getByRole('button', { name: /^Start run with/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Send to agent' })).toBeNull();
  });

  it('edits the active environment and adds one from the Environment menu', async () => {
    renderApp(<ApiTab onStarted={() => {}} onUseAsGate={() => {}} />);
    await screen.findByRole('button', { name: 'GET List runs' });
    fireEvent.click(screen.getByRole('button', { name: 'Environment' }));
    expect(screen.getByRole('menuitem', { name: 'Edit local…' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'New environment…' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});

describe('latency bars', () => {
  it('are neutral (blue means live), full strength on hover or press, amber kept for slow sends', () => {
    expect(cssRule('http/api.css', '.lat')).toContain('background: var(--mut)');
    expect(cssRule('http/api.css', '.lat')).toContain('opacity: .7');
    expect(cssRule('http/api.css', '.lat:hover,.lat[aria-pressed=\'true\']')).toContain('opacity: 1');
    expect(cssRule('http/api.css', '.lat[data-amber]')).toContain('background: var(--warn)');
  });
});
