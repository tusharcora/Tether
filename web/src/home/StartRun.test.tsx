import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { cssRule } from '../test/css';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { StartRun } from './StartRun';

const WS = [
  { id: 'api', name: 'API', path: '/p/api', isDefault: true, exists: true, repos: [] },
  { id: 'web', name: 'Web', path: '/p/web', isDefault: false, exists: true, repos: [] },
];
const routes = { 'GET /api/workspaces': WS, 'GET /api/roster/preview': new Error('hidden'), 'POST /api/runs': { id: 'r7' } };
const taskField = () => screen.findByLabelText('Task') as Promise<HTMLTextAreaElement>;
const type = async (text: string) => fireEvent.change(await taskField(), { target: { value: text } });
const start = () => screen.getByRole('button', { name: 'Start run' }) as HTMLButtonElement;
const setup = (p: { onGo?: () => void; onStarted?: (id: string) => void } = {}) => renderApp(<StartRun onGo={p.onGo ?? (() => {})} onStarted={p.onStarted ?? (() => {})} />);

beforeEach(() => {
  vi.mocked(api).mockReset();
  localStorage.clear();
  routeApi(routes);
});

describe('Start a run', () => {
  it('starts a live team run in the default workspace with Meta+Enter', async () => {
    const onStarted = vi.fn();
    setup({ onStarted });
    await type('Fix the login bug');
    await act(async () => fireEvent.keyDown(await taskField(), { key: 'Enter', metaKey: true }));
    expect(calls('POST', '/api/runs')[0]![2]).toEqual({ kind: 'team', mode: 'live', task: 'Fix the login bug', repo: '/p/api' });
    expect(onStarted).toHaveBeenCalledWith('r7');
    expect((await taskField()).value).toBe('');
  });

  it('picks autonomous from the run-kind chip and starts with Ctrl+Enter; plain Enter only adds a newline', async () => {
    setup();
    await type('Write the docs');
    fireEvent.click(screen.getByRole('button', { name: /Squad · live/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Squad · autonomous' }));
    expect(screen.getByRole('button', { name: /Squad · autonomous/ })).toBeTruthy();
    fireEvent.keyDown(await taskField(), { key: 'Enter' });
    expect(calls('POST', '/api/runs')).toHaveLength(0);
    await act(async () => fireEvent.keyDown(await taskField(), { key: 'Enter', ctrlKey: true }));
    expect(calls('POST', '/api/runs')[0]![2]).toMatchObject({ mode: 'autonomous', task: 'Write the docs' });
  });

  it('picks the workspace from the project chip', async () => {
    setup();
    await type('Fix it');
    fireEvent.click(screen.getByRole('button', { name: /API/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Web/ }));
    expect(screen.getByRole('button', { name: /Web/ })).toBeTruthy();
    await act(async () => fireEvent.click(start()));
    expect(calls('POST', '/api/runs')[0]![2]).toMatchObject({ repo: '/p/web' });
  });

  it('keeps Start disabled until there is a task', async () => {
    setup();
    await taskField();
    expect(start().disabled).toBe(true);
    await type('   ');
    expect(start().disabled).toBe(true);
    await type('Do it');
    expect(start().disabled).toBe(false);
  });

  it('shows a refused start inline and keeps the task', async () => {
    routeApi({ ...routes, 'POST /api/runs': new Error('repo path does not exist: /p/api') });
    setup();
    await type('Fix it');
    await act(async () => fireEvent.click(start()));
    expect(screen.getByRole('alert').textContent).toContain('repo path does not exist');
    expect((await taskField()).value).toBe('Fix it');
  });

  it('starts one run when Start is clicked twice', async () => {
    routeApi({ ...routes, 'POST /api/runs': new Promise(() => {}) });
    setup();
    await type('Fix it');
    fireEvent.click(start());
    fireEvent.click(start());
    await act(async () => {});
    expect(calls('POST', '/api/runs')).toHaveLength(1);
    expect(start().disabled).toBe(true);
  });

  it('uses the API tab’s workspace', async () => {
    localStorage.setItem('aorch.api.ws', 'web');
    setup();
    await type('Fix it');
    await act(async () => fireEvent.click(start()));
    expect(calls('POST', '/api/runs')[0]![2]).toMatchObject({ repo: '/p/web' });
  });

  it('falls back to the default workspace when the stored one is gone', async () => {
    localStorage.setItem('aorch.api.ws', 'removed');
    setup();
    await type('Fix it');
    await act(async () => fireEvent.click(start()));
    expect(calls('POST', '/api/runs')[0]![2]).toMatchObject({ repo: '/p/api' });
  });

  it('does not start in a workspace whose folder is missing', async () => {
    routeApi({ ...routes, 'GET /api/workspaces': [{ ...WS[0]!, exists: false }] });
    setup();
    await type('Fix it');
    expect(start().disabled).toBe(true);
    expect(screen.getByRole('note').textContent).toContain('/p/api');
  });

  it('shows the register-a-workspace empty state when none is registered', async () => {
    routeApi({ ...routes, 'GET /api/workspaces': [] });
    setup();
    expect((await screen.findByText(/No workspace yet/)).className).toBe('sl-quiet');
    expect(screen.getByText(/tether workspace init/)).toBeTruthy();
    expect(screen.queryByLabelText('Task')).toBeNull();
  });

  it('offers to copy the register command when no workspace is registered', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    routeApi({ ...routes, 'GET /api/workspaces': [] });
    setup();
    await screen.findByText(/No workspace yet/);
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Copy command' })));
    expect(writeText).toHaveBeenCalledWith('tether workspace init');
    expect(await screen.findByText('Command copied')).toBeTruthy();
  });

  it('shows suggestions only while the empty field is focused', async () => {
    setup();
    const task = await taskField();
    expect(screen.queryByText('Fix the flaky login test')).toBeNull();
    fireEvent.focus(task);
    fireEvent.mouseDown(screen.getByText('Fix the flaky login test'));
    expect(task.value).toBe('Fix the flaky login test');
    expect(screen.queryByText('Write a README section for the CLI')).toBeNull();
  });

  it('hands off to the Builder from the run-kind menu', async () => {
    const onGo = vi.fn();
    setup({ onGo });
    await taskField();
    fireEvent.click(screen.getByRole('button', { name: /Squad · live/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Workflow…' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'builder' });
  });

  it('shows Tether picks the crew as a label, not a control', async () => {
    setup();
    await taskField();
    expect(screen.getByText('Tether picks the crew').closest('button')).toBeNull();
  });

  it('grows with its content', () => expect(cssRule('home/home.css', '.composer textarea')).toContain('field-sizing: content'));
  it('keeps a workspace name on one line in its menu', () => expect(cssRule('home/home.css', '.composer-menu [role="menuitem"] > span:first-child')).toContain('white-space: nowrap'));

  it('shows Tether’s likely picks as a guess, next to the core crew', async () => {
    routeApi({ ...routes, 'GET /api/roster/preview': { bots: [{ id: 'rag-pipeline-reviewer', name: 'RAG reviewer', why: 'Reviews retrieval' }], core: ['planner', 'coder', 'reviewer', 'architect'] } });
    setup();
    await type('fix the RAG retriever');
    expect(await screen.findByText('RAG reviewer', {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText(/a guess/)).toBeTruthy();
    expect(screen.getByText('core crew (planner, coder, reviewer…) always available')).toBeTruthy();
  });

  it('says Tether will use the core crew when it would pick no specialist', async () => {
    routeApi({ ...routes, 'GET /api/roster/preview': { bots: [], core: ['planner', 'coder'] } });
    setup();
    await type('tidy the readme file');
    await waitFor(() => expect(screen.getByText('Tether will use the core crew')).toBeTruthy(), { timeout: 2000 });
  });
});
