import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, ApiError, type RunView } from '../api';
import { LivePlan } from '../runs/PlanCard';
import type { RouteCard } from './api';
import { RunTaskCard, taskState } from './taskCards';
import { Thread } from './Thread';
import { useAssistant } from './useAssistant';
import { calls, makeAwaitingRun, makeRun, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';

beforeEach(() => {
  vi.mocked(api).mockReset();
});

describe('the started run card follows its run live', () => {
  it('shows the run as a live plan card', async () => {
    routeApi({ 'GET /api/runs/r9': makeRun({ id: 'r9', costUsd: 0.4 }) });
    renderApp(<LivePlan runId="r9" />);
    const card = await screen.findByRole('region', { name: 'Plan' });
    expect(card.textContent).toContain('Add rate limiting');
    expect(card.textContent).toContain('$0.40');
    expect(screen.getAllByRole('img', { name: 'done' })).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'working' })).toBeTruthy();
  });

  it('says Tether is planning while a live team run has no steps yet', async () => {
    const r = makeRun({ id: 'r9', kind: 'team', planning: true });
    routeApi({ 'GET /api/runs/r9': { ...r, pipeline: { ...r.pipeline, nodes: [], edges: [] }, nodes: {} } });
    renderApp(<LivePlan runId="r9" />);
    await waitFor(() => expect(screen.getByText('Tether is planning…')).toBeTruthy());
  });

  it('draws nothing for a run it cannot find', async () => {
    routeApi({ 'GET /api/runs/gone': new Error('unknown run gone') });
    const { container } = renderApp(<LivePlan runId="gone" />);
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).toBe('');
  });
});

describe('a run a chat started is a task card', () => {
  it('maps a run to a task state: finished ones as they ended, waiting on you, paused or lost as waiting, else working', () => {
    expect(taskState({ status: 'done', waiting: false })).toBe('done');
    expect(taskState({ status: 'error', waiting: false })).toBe('failed');
    expect(taskState({ status: 'stopped', waiting: true })).toBe('cancelled');
    expect(taskState({ status: 'running', waiting: true, live: true })).toBe('waiting');
    expect(taskState({ status: 'paused', waiting: false })).toBe('waiting');
    expect(taskState({ status: 'running', waiting: false, live: false })).toBe('waiting');
    expect(taskState({ status: 'running', waiting: false, live: true })).toBe('working');
  });

  it('follows the run: its task, id, state, time and spend; open, its steps; Open run goes to it', async () => {
    routeApi({ 'GET /api/runs/r9': makeRun({ id: 'r9', costUsd: 0.4 }) });
    const onOpen = vi.fn();
    renderApp(<RunTaskCard runId="r9" task="Add rate limiting" onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByText('$0.40')).toBeTruthy());
    const card = document.querySelector('[data-slot="task-card"]') as HTMLElement;
    expect(card.dataset.state).toBe('working');
    expect(screen.getByText('R-R9')).toBeTruthy();
    expect(screen.getByText('1:00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add rate limiting/ }));
    expect(screen.getByText('planner')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'working' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open run' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('waits when the run needs the person, and says why a failed run failed', async () => {
    routeApi({ 'GET /api/runs/r1': makeAwaitingRun(), 'GET /api/runs/r2': makeRun({ id: 'r2', status: 'error', live: false, error: 'tests failed\nmore', finishedAt: Date.now() }) });
    renderApp(<RunTaskCard runId="r1" task="x" onOpen={() => {}} />);
    renderApp(<RunTaskCard runId="r2" task="x" onOpen={() => {}} />);
    await waitFor(() => expect(screen.getByText('tests failed')).toBeTruthy());
    expect(screen.getByText('Waiting for you')).toBeTruthy();
    expect([...document.querySelectorAll('[data-slot="task-card"]')].map((c) => (c as HTMLElement).dataset.state).sort()).toEqual(['failed', 'waiting']);
  });
});

describe('the route card', () => {
  const TRUST_BODY = "Agents can run commands here, like tests and installs. Undo restores files, but it can't reverse everything a command does. Some things always stop and ask first. Files in a downloaded project can try to steer an agent, so only trust folders you know.";
  const NO_GIT = /\b(git|merge|branch|PR|commit|repository)\b/i;
  const rows = [
    { kind: 'solo', why: 'One folder, one job.', cost: 'about 8k tokens' },
    { kind: 'ticket', why: 'Only if you want to track it.', cost: 'about 8k tokens' },
    { kind: 'workflow', why: 'Too many steps for this.', cost: 'about 24k tokens' },
    { kind: 'team', why: 'Too heavy for one question.', cost: '' },
  ];
  const card = (o: Partial<RouteCard> = {}) => ({ id: 'rc1', task: 'Finish question 3', recommend: 'solo', rows, workflow: 'plan-code-review', status: 'proposed', ...o }) as RouteCard;
  const onGo = vi.fn();
  function Host() {
    const chat = useAssistant('w1', 'c1', true);
    return <Thread chat={chat} onGo={onGo} empty="" />;
  }
  /** A chat holding one card; `post` answers a click, and every click lands in `posts`. */
  const posts: Record<string, unknown>[] = [];
  const open = (route: RouteCard, more: Parameters<typeof routeApi>[0] = {}, post?: (b: Record<string, unknown>) => unknown) => {
    posts.length = 0;
    routeApi({
      'GET /api/assistant': { messages: [{ id: 'm1', role: 'tether', text: 'I read your folder.', at: 1, route }], agent: 'claude', models: [], asksToGoals: true },
      'GET /api/health': { ok: true },
      'POST /api/assistant/routes/rc1': (b: unknown) => (posts.push(b as Record<string, unknown>), post ? post(b as Record<string, unknown>) : { route: card({ status: 'started', chose: 'solo', runId: 'r1' }) }),
      'GET /api/runs/r1': plainRun(),
      ...more,
    });
    return renderApp(<Host />);
  };
  const plainRun = (o: Partial<RunView> = {}) => makeRun({ id: 'r1', solo: true, history: '/h', status: 'done', live: false, finishedAt: Date.now(), pipeline: { ...makeRun().pipeline, name: 'solo', nodes: [{ id: 'work', kind: 'agent', role: 'coder', title: 'Finish question 3', x: 0, y: 0 }], edges: [] }, nodes: { work: { status: 'done', attempts: 1, costUsd: 0, loops: 0, stat: { files: 1, added: 12, deleted: 3 } } }, ...o } as Partial<RunView>);
  const running = () => plainRun({ status: 'running', live: true, finishedAt: undefined, nodes: { work: { status: 'running', attempts: 1, costUsd: 0, loops: 0, live: '' } } } as Partial<RunView>);
  const landed = (files = ['hw3.py']) => plainRun({ ship: { merged: true, landed: { pre: 'a', post: 'b', files } } });
  const click = async (name: string) => {
    const b = await screen.findByRole('button', { name });
    await act(async () => void fireEvent.click(b));
  };
  const needsTrust = () => new ApiError('{"needsTrust":true}', 409, { needsTrust: true, folder: '/x' });
  const askedOnce = (ok: unknown) => {
    let asked = false;
    return () => (asked ? ok : ((asked = true), needsTrust()));
  };

  beforeEach(() => onGo.mockReset());

  it('shows four rows, marks the recommendation, and starts it', async () => {
    open(card());
    const c = await screen.findByRole('region', { name: "How I'd do this" });
    expect(within(c).getAllByRole('listitem')).toHaveLength(4);
    const rec = within(c).getAllByRole('listitem').find((r) => r.dataset.recommended !== undefined)!;
    expect(rec.textContent).toContain('Do it myself');
    expect(rec.textContent).toContain('Recommended. One folder, one job.');
    expect(rec.querySelector('em')!.textContent).toBe('about 8k tokens');
    expect(within(c).getAllByRole('button').map((b) => b.textContent)).toEqual(['Do it myself', 'Make a ticket', 'Use a workflow', 'Use a team']);
    await click('Do it myself');
    expect(posts).toEqual([{ ws: 'w1', chat: 'c1', choice: 'solo' }]);
    expect(await screen.findByText("This work isn't in your folder yet.")).toBeTruthy();
  });

  it('a double click starts one run', async () => {
    let finish!: (v: unknown) => void;
    open(card(), {}, () => new Promise((r) => (finish = r)));
    const b = await screen.findByRole('button', { name: 'Do it myself' });
    fireEvent.click(b);
    fireEvent.click(b);
    fireEvent.click(screen.getByRole('button', { name: 'Use a team' }));
    expect(posts).toHaveLength(1);
    await act(async () => finish({ route: card({ status: 'started', chose: 'solo', runId: 'r1' }) }));
  });

  it('asks Trust this folder? with the exact words, then starts', async () => {
    open(card(), {}, askedOnce({ route: card({ status: 'started', chose: 'solo', runId: 'r1' }) }));
    await click('Do it myself');
    const d = await screen.findByRole('dialog', { name: 'Trust this folder?' });
    expect(d).toHaveProperty('textContent', expect.stringContaining(TRUST_BODY));
    expect(d.textContent).toContain('/x');
    await waitFor(() => expect(d.contains(document.activeElement)).toBe(true));
    // pressed twice: the dialog is still on its way out for the second press
    const trust = screen.getByRole('button', { name: 'Trust' });
    fireEvent.click(trust);
    fireEvent.click(trust);
    await act(async () => {});
    expect(posts.at(-1)).toEqual({ ws: 'w1', chat: 'c1', choice: 'solo', trust: true });
    expect(posts).toHaveLength(2);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Trust this folder?' })).toBeNull());
  });

  it.each([['Use a workflow', 'workflow'], ['Use a team', 'team']])('asks for %s too, and closing the question starts nothing', async (button) => {
    open(card(), {}, () => needsTrust());
    await click(button);
    await screen.findByRole('dialog', { name: 'Trust this folder?' });
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Trust this folder?' })).toBeNull());
    expect(posts).toHaveLength(1);
    expect(await screen.findByRole('button', { name: button })).toBeTruthy();
  });

  it('a ticket never asks, and opens the ticket it made', async () => {
    open(card(), {}, () => ({ route: card({ status: 'started', chose: 'ticket', goalId: 'g1' }) }));
    await click('Make a ticket');
    expect(screen.queryByRole('dialog')).toBeNull();
    await click('Open the ticket');
    expect(onGo).toHaveBeenCalledWith({ tab: 'tickets', id: 'g1' });
  });

  it('Not now still does the work, without commands', async () => {
    open(card(), { 'GET /api/runs/r1': running() }, askedOnce({ route: card({ status: 'started', chose: 'solo', runId: 'r1', noCommands: true }) }));
    await click('Do it myself');
    await click('Not now');
    expect(posts.at(-1)).toEqual({ ws: 'w1', chat: 'c1', choice: 'solo', trust: false });
    expect(await screen.findByText("It can't run commands here, because this folder isn't trusted.")).toBeTruthy();
  });

  it('shows the task first, so a person sees what they are approving', async () => {
    open(card());
    const c = await screen.findByRole('region', { name: "How I'd do this" });
    expect(c.querySelector('h4')!.nextElementSibling!.textContent).toBe(card().task);
  });

  it('keeps saying a run without commands was not checked once it ends, in plain words', async () => {
    const started = () => card({ status: 'started', chose: 'solo', runId: 'r1', noCommands: true });
    const line = 'It ran without commands, so this wasn\'t checked.';
    const a = open(started(), { 'GET /api/runs/r1': landed() });
    expect(await screen.findByText(line)).toBeTruthy();
    a.unmount();
    const b = open(started(), { 'GET /api/runs/r1': plainRun({ status: 'error', error: 'boom' } as Partial<RunView>) });
    expect(await screen.findByText("This didn't finish, so your folder wasn't changed.")).toBeTruthy();
    expect(screen.getByText(line)).toBeTruthy();
    b.unmount();
    // the stop already says it, once is enough
    open(started(), { 'GET /api/runs/r1': plainRun({ status: 'stopped', error: "This folder isn't trusted, so the check didn't run." } as Partial<RunView>) });
    expect(await screen.findByText("This folder isn't trusted, so the check didn't run.")).toBeTruthy();
    expect(screen.queryByText(line)).toBeNull();
  });

  it('moves through working to landed and undoes', async () => {
    let run = running();
    open(card({ status: 'started', chose: 'solo', runId: 'r1' }), { 'GET /api/runs/r1': () => run, 'POST /api/runs/r1/undo-land': () => ((run = plainRun({ undone: true } as Partial<RunView>)), run) });
    expect(await screen.findByText('Doing it myself · saved a checkpoint first')).toBeTruthy();
    run = landed();
    expect(await screen.findByText('hw3.py · +12 −3', undefined, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText('hw3.py · +12 −3').closest('[role="status"]')).toBeTruthy();
    await click('See changes');
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r1' });
    await click('Undo');
    expect(await screen.findByText('Undone. Your folder is back to how it was.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  }, 10_000);

  it('counts files when several landed, and stays undone after a reload', async () => {
    const a = open(card({ status: 'started', chose: 'solo', runId: 'r1' }), { 'GET /api/runs/r1': landed(['a.py', 'b.py', 'c.py']) });
    expect(await screen.findByText('3 files')).toBeTruthy();
    a.unmount();
    open(card({ status: 'started', chose: 'solo', runId: 'r1' }), { 'GET /api/runs/r1': plainRun({ undone: true } as Partial<RunView>) });
    expect(await screen.findByText('Undone. Your folder is back to how it was.')).toBeTruthy();
  });

  it('says plainly when an undo is refused, and never in git words', async () => {
    open(card({ status: 'started', chose: 'solo', runId: 'r1' }), { 'GET /api/runs/r1': landed(), 'POST /api/runs/r1/undo-land': new Error('git checkout failed: /home/x/.aorch/history') });
    await click('Undo');
    expect(await screen.findByText("That couldn't be undone, so nothing was changed.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\.aorch/);
  });

  it('shows the conflict in plain words, with no git words', async () => {
    const conflict = 'hw3.py changed since this work started, so nothing in the folder was changed. Keep your version, or rewind this run from its page and run it again.';
    open(card({ status: 'started', chose: 'solo', runId: 'r1' }), { 'GET /api/runs/r1': plainRun({ ship: { error: conflict } }) });
    expect(await screen.findByText(conflict)).toBeTruthy();
    await click('Open the run');
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r1' });
    expect(screen.getByRole('button', { name: 'Open the run' }).closest('article')!.textContent).not.toMatch(NO_GIT);
  });

  it('no files is not a failure', async () => {
    open(card({ status: 'started', chose: 'solo', runId: 'r1' }), { 'GET /api/runs/r1': plainRun({ ship: { error: 'No files came out of this run.' } }) });
    const line = await screen.findByText('Nothing changed in your folder.');
    expect(line.className).not.toMatch(/bad|danger|destructive/);
    expect(screen.queryByText('No files came out of this run.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open the run' })).toBeTruthy();
  });

  it("a failed run never shows its raw error", async () => {
    open(card({ status: 'started', chose: 'solo', runId: 'r1' }), { 'GET /api/runs/r1': plainRun({ status: 'error', error: 'fatal: not a git repository: merge branch aorch/r1' }) });
    expect(await screen.findByText("This didn't finish, so your folder wasn't changed.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open the run' }).closest('article')!.textContent).not.toMatch(NO_GIT);
  });

  it('a refused run says so plainly', async () => {
    open(card({ status: 'started', chose: 'workflow', runId: 'r1' }), { 'GET /api/runs/r1': plainRun({ status: 'stopped', error: "This folder isn't trusted, so the check didn't run." }) });
    expect(await screen.findByText("This folder isn't trusted, so the check didn't run.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open the run' })).toBeTruthy();
  });

  it('a failed card shows its note, with no retry', async () => {
    open(card({ status: 'failed', chose: 'solo', note: "That couldn't start." }));
    expect(await screen.findByText("That couldn't start.")).toBeTruthy();
    expect(screen.getByText("That couldn't start.").closest('article')!.querySelector('button')).toBeNull();
  });

  it('a real repo ends on Ready with Open the run', async () => {
    open(card({ status: 'started', chose: 'solo', runId: 'r1' }), { 'GET /api/runs/r1': plainRun({ history: undefined }) });
    expect(await screen.findByText('Ready')).toBeTruthy();
    await click('Open the run');
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r1' });
  });

  it('a plain run that ended without landing says so, and never Ready', async () => {
    open(card({ status: 'started', chose: 'workflow', runId: 'r1' }), { 'GET /api/runs/r1': plainRun({ solo: undefined }) });
    expect(await screen.findByText("This work isn't in your folder yet.")).toBeTruthy();
    expect(screen.queryByText('Ready')).toBeNull();
    await click('Open the run');
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r1' });
  });

  describe('reads the run only while there is more to come', () => {
    const LONG_AGO = Date.now() - 3_600_000;
    const started = card({ status: 'started', chose: 'solo', runId: 'r1' });
    const reads = () => calls('GET', '/api/runs/r1').length;
    const later = () => act(() => vi.advanceTimersByTimeAsync(40_000));
    beforeEach(() => void vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => void vi.useRealTimers());

    it.each([
      ['landed', () => landed(), 'hw3.py · +12 −3'],
      ['undone', () => plainRun({ undone: true } as Partial<RunView>), 'Undone. Your folder is back to how it was.'],
      ['failed', () => plainRun({ status: 'error' }), "This didn't finish, so your folder wasn't changed."],
      ['stopped', () => plainRun({ status: 'stopped' }), "This was stopped, so your folder wasn't changed."],
      ['ready', () => plainRun({ history: undefined }), 'Ready'],
      ['not in the folder', () => plainRun({ solo: undefined }), "This work isn't in your folder yet."],
      ['a solo run that never landed', () => plainRun({ finishedAt: LONG_AGO }), "This work isn't in your folder yet."],
      ['paused', () => plainRun({ status: 'paused', finishedAt: undefined }), 'Waiting for you'],
      ['waiting on a person', () => ({ ...makeAwaitingRun(), id: 'r1' }), 'Waiting for you'],
      ['auto-fix asking for edits', () => plainRun({ status: 'error', live: true, autofix: { round: 0, of: 3, rounds: [], needsWrites: 'read-only' } } as Partial<RunView>), "This didn't finish, so your folder wasn't changed."],
    ] as [string, () => RunView, string][])('%s: no more requests', async (_, run, text) => {
      open(started, { 'GET /api/runs/r1': run() });
      await screen.findByText(text);
      await act(async () => {}); // the effect that stops the reads, which an open act would hold back
      const seen = reads();
      await later();
      expect(reads()).toBe(seen);
    });

    it('a deleted run: the 404 stops it', async () => {
      open(started, { 'GET /api/runs/r1': new ApiError('unknown run r1', 404) });
      expect(await screen.findByText("This run couldn't be read.")).toBeTruthy();
      await act(async () => {});
      await later();
      expect(reads()).toBe(1);
    });

    it('a server that is away is tried again', async () => {
      open(started, { 'GET /api/runs/r1': new ApiError('Bad gateway', 502) });
      await screen.findByText("This run couldn't be read.");
      await later();
      expect(reads()).toBeGreaterThan(1);
    });

    it('Undo still answers once the reads have stopped', async () => {
      open(started, { 'GET /api/runs/r1': landed(), 'POST /api/runs/r1/undo-land': plainRun({ undone: true } as Partial<RunView>) });
      await screen.findByText('hw3.py · +12 −3');
      await click('Undo');
      expect(await screen.findByText('Undone. Your folder is back to how it was.')).toBeTruthy();
    });

    it('a failed run auto-fix is working on is followed to its landing', async () => {
      let run = plainRun({ status: 'error', live: true });
      open(started, { 'GET /api/runs/r1': () => run });
      await screen.findByText("This didn't finish, so your folder wasn't changed.");
      run = landed();
      await later();
      expect(screen.getByText('hw3.py · +12 −3')).toBeTruthy();
    });

    it('a solo run that just finished is followed to its landing', async () => {
      let run = plainRun();
      open(started, { 'GET /api/runs/r1': () => run });
      await screen.findByText("This work isn't in your folder yet.");
      run = landed();
      await later();
      expect(screen.getByText('hw3.py · +12 −3')).toBeTruthy();
    });
  });

  it('a row wraps rather than squeezing its reason at phone width', async () => {
    open(card());
    const row = (await screen.findByText('Do it myself', { selector: 'b' })).closest('li')!;
    expect(row.className).toContain('flex-wrap');
    expect(row.querySelector('span')!.className).toMatch(/min-w-\[/);
  });

  it('a plain card has no merge, branch, PR or commit', async () => {
    const a = open(card({ status: 'started', chose: 'solo', runId: 'r1' }), { 'GET /api/runs/r1': { ...running(), nodes: { work: { status: 'running', attempts: 1, costUsd: 0, loops: 0, live: '[tool] Bash git commit -m wip\n' } } } });
    const line = await screen.findByText('Finish question 3');
    expect(line.closest('article')!.textContent).not.toMatch(NO_GIT);
    a.unmount();
    open(card({ status: 'started', chose: 'solo', runId: 'r1' }), { 'GET /api/runs/r1': landed() });
    const c = (await screen.findByRole('button', { name: 'Undo' })).closest('article')!;
    expect(c.textContent).not.toMatch(NO_GIT);
  });

  it("Don't ask for small jobs saves the pref and says what it means", async () => {
    open(card(), { 'PUT /api/prefs': { soloWithoutAsking: true } });
    const box = await screen.findByRole('checkbox', { name: "Don't ask for small jobs" });
    await act(async () => fireEvent.click(box));
    expect(calls('PUT', '/api/prefs')[0]![2]).toEqual({ soloWithoutAsking: true });
    expect(screen.getByText('Small jobs then start without asking in folders you trust.')).toBeTruthy();
  });

  it('an old chat with a run proposal and no route card still renders', async () => {
    routeApi({ 'GET /api/assistant': { messages: [{ id: 'm1', role: 'tether', text: 'Old.', at: 1, proposals: [{ id: 'p', kind: 'team', task: 'x', status: 'dismissed' }] }], agent: 'claude', models: [], asksToGoals: true } });
    renderApp(<Host />);
    expect(await screen.findByText('Dismissed')).toBeTruthy();
    expect(screen.queryByRole('region', { name: "How I'd do this" })).toBeNull();
  });
});
