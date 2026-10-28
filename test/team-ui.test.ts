import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { Tui } from '../src/tui.js';
import { Engine } from '../src/engine.js';
import { interpret } from '../src/maestro.js';
import { CardInput, cardKey, cardLines, finalSummary, modeCommand, planDecision, progressLines, runNeedsYou, MODE_HELP, parseModeArg, parseSwap } from '../src/teamchat.js';
import type { Question, RunState } from '../src/types.js';
import { strip, vlen } from '../src/ui.js';
import { makeRepo, setup, tmp } from './helpers.js';

const q = (id: string, extra: Partial<Question> = {}): Question => ({
  id,
  ask: 'Which database should the service use?',
  why: 'It changes the migration plan.',
  options: [
    { id: 'pg', label: 'PostgreSQL' },
    { id: 'sqlite', label: 'SQLite', detail: 'single file, no server' },
  ],
  recommended: 'pg',
  ...extra,
});
const plain = (ls: string[]) => ls.map(strip).join('\n');

describe('chat question cards', () => {
  it('renders nothing when nothing is pending', () => {
    expect(cardLines([], 80)).toEqual([]);
  });

  it('one card: question, numbered options, recommended marker, key hints', () => {
    const ls = cardLines([q('db')], 80);
    const t = plain(ls);
    expect(t).toContain('Which database should the service use?');
    expect(t).toContain('1) PostgreSQL (recommended)');
    expect(t).toContain('2) SQLite');
    expect(t).toMatch(/1-2/);
    expect(t).toMatch(/enter/);
    expect(t).not.toMatch(/\bo\b.*own/); // no free text on this card
    for (const l of ls) expect(vlen(l)).toBeLessThanOrEqual(80);
  });

  it('free text hint only when the card allows it', () => {
    expect(plain(cardLines([q('a', { allowOther: true })], 80))).toMatch(/o type your own/);
  });

  it('two cards: first is active, second waits its turn', () => {
    const t = plain(cardLines([q('a'), q('b', { ask: 'Allow schema changes?' })], 80));
    expect(t).toContain('question 1 of 2');
    expect(t).toContain('Allow schema changes?');
    expect(t.indexOf('Which database')).toBeLessThan(t.indexOf('Allow schema'));
  });

  it('a long label wraps inside the width', () => {
    const long = q('l', { options: [{ id: 'x', label: 'An extraordinarily long option label that keeps going and going well past the edge of a narrow terminal window' }, { id: 'y', label: 'Short' }], recommended: 'x' });
    const ls = cardLines([long], 40);
    for (const l of ls) expect(vlen(l)).toBeLessThanOrEqual(40);
    expect(ls.length).toBeGreaterThan(6);
  });
});

describe('chat card keys', () => {
  const card = q('db', { allowOther: true });
  it('a number picks that option', () => {
    expect(cardKey(card, '2')).toEqual({ answer: { question: 'db', option: 'sqlite', by: 'user' } });
  });
  it('enter takes the recommendation', () => {
    expect(cardKey(card, 'enter')).toEqual({ answer: { question: 'db', option: 'pg', by: 'user' } });
  });
  it('o starts free text only when allowed', () => {
    expect(cardKey(card, 'o')).toEqual({ other: true });
    expect(cardKey(q('db'), 'o')).toBeUndefined();
  });
  it('unknown keys and out-of-range numbers are ignored', () => {
    for (const k of ['x', '9', '0', 'up', 'tab', 'a']) expect(cardKey(card, k)).toBeUndefined();
  });
});

function team(over: Partial<RunState> = {}): RunState {
  return {
    id: 'r1',
    status: 'running',
    kind: 'team',
    mode: 'live',
    pipeline: {
      name: 'team',
      version: 1,
      mode: 'pipeline',
      nodes: [
        { id: 'boss', kind: 'agent', role: 'planner', title: 'Boss' },
        { id: 'w1', kind: 'agent', role: 'coder', title: 'Coder' },
      ],
      edges: [],
      settings: { maxCostUsd: 10 },
    },
    nodes: { boss: { status: 'done', attempts: 1, costUsd: 0, loops: 0 }, w1: { status: 'running', attempts: 1, costUsd: 0, loops: 0 } },
    costUsd: 0,
    startedAt: 0,
    branch: 'aorch/x',
    pending: [],
    talk: [],
    ...over,
  } as unknown as RunState;
}

describe('Tether progress lines', () => {
  it('live mode reports step start and finish once each', () => {
    const seen: string[] = [];
    const a = progressLines(team(), seen);
    expect(a.join('\n')).toMatch(/Coder.*started/);
    expect(a.join('\n')).toMatch(/Boss.*finished/);
    expect(progressLines(team(), seen)).toEqual([]);
  });

  it('autonomous mode stays silent, and switching to live does not replay the backlog', () => {
    const seen: string[] = [];
    expect(progressLines(team({ mode: 'autonomous' }), seen)).toEqual([]);
    expect(progressLines(team({ mode: 'live' }), seen)).toEqual([]);
  });

  it('reports a redo, a handoff and cost milestones', () => {
    const seen: string[] = [];
    progressLines(team(), seen);
    const st = team({
      nodes: { boss: { status: 'done', attempts: 1, costUsd: 0, loops: 0 }, w1: { status: 'running', attempts: 2, costUsd: 0, loops: 0 } },
      talk: [{ from: 'boss', to: 'w1', question: 'add the endpoint', answer: 'ok', round: 1, ts: 1 }],
      costUsd: 5.5,
    });
    const t = progressLines(st, seen).join('\n');
    expect(t).toMatch(/Coder.*again|redo/i);
    expect(t).toMatch(/Boss.*Coder/);
    expect(t).toMatch(/50%/);
    expect(t).not.toMatch(/25%/); // only the highest milestone newly crossed
    expect(progressLines(st, seen)).toEqual([]);
    expect(progressLines({ ...st, costUsd: 9.2 } as RunState, seen).join('\n')).toMatch(/90%/);
  });

  it('workflow runs get no team progress', () => {
    expect(progressLines(team({ kind: 'workflow' }), [])).toEqual([]);
  });

  it('final summary names steps, cost and branch', () => {
    const t = finalSummary(team({ status: 'done', costUsd: 1.25 }));
    expect(t).toContain('$1.25');
    expect(t).toContain('aorch/x');
  });
});

describe('the face', () => {
  it('a pending question in a live or paused run needs you; a stopped run does not', () => {
    expect(runNeedsYou({ status: 'running', pending: 1 })).toBe(true);
    expect(runNeedsYou({ status: 'paused', pending: 2 })).toBe(true);
    expect(runNeedsYou({ status: 'running', pending: 0 })).toBe(false);
    expect(runNeedsYou({ status: 'stopped', pending: 1 })).toBe(false);
    expect(runNeedsYou({ status: 'running' })).toBe(false);
  });
  it('the store summary carries kind, mode and pending cards', async () => {
    const { store, engine } = setup();
    const repo = makeRepo();
    const id = await engine.startTeam({ task: 'x', repo, workspace: false, roster: ['coder'], mode: 'autonomous', mock: { questions: [[{ id: 'q1', ask: 'ask', options: [{ id: 'a', label: 'A' }], recommended: 'a' }]] } as never });
    const row = store.list().find((r) => r.id === id)!;
    expect(row).toMatchObject({ kind: 'team', mode: 'autonomous', pending: 1 });
    expect(runNeedsYou(row)).toBe(true);
    engine.stop(id);
  });
});

describe('/mode', () => {
  it('parses live and autonomous, rejects the rest', () => {
    expect(parseModeArg('live')).toBe('live');
    expect(parseModeArg(' Autonomous ')).toBe('autonomous');
    expect(parseModeArg('fast')).toBeUndefined();
    expect(parseModeArg(undefined)).toBeUndefined();
    expect(MODE_HELP).toMatch(/live.*autonomous/);
  });
});

describe('Tether proposes a team', () => {
  it('parses a team proposal with a mode', () => {
    const { home, registry } = setup();
    const r = interpret(JSON.stringify({ reply: 'This is open-ended; a team fits.', intent: 'team', task: 'Make the API faster', mode: 'autonomous' }), { home, repo: tmp(), registry });
    expect(r.proposal).toEqual({ kind: 'team', task: 'Make the API faster', mode: 'autonomous' });
  });
  it('mode is optional and a bad one is dropped; a team needs a task', () => {
    const { home, registry } = setup();
    const o = { home, repo: tmp(), registry };
    expect(interpret(JSON.stringify({ reply: 'ok', intent: 'team', task: 'x y', mode: 'bogus' }), o).proposal).toEqual({ kind: 'team', task: 'x y' });
    const none = interpret(JSON.stringify({ reply: 'ok', intent: 'team' }), o);
    expect(none.proposal).toBeUndefined();
    expect(none.text).toMatch(/task/);
  });
});

describe('dashboard', () => {
  it('compiles under the web tsconfig', () => {
    expect(() => execFileSync('npx', ['tsc', '--noEmit', '-p', 'web/tsconfig.json'], { cwd: process.cwd(), stdio: 'pipe' })).not.toThrow();
  }, 90_000);
});

describe('review fixes: progress and limits', () => {
  it('reports the finish after a redo, and a limit that ended the run', () => {
    const seen: string[] = [];
    progressLines(team(), seen);
    const redo = team({ nodes: { boss: { status: 'done', attempts: 1, costUsd: 0, loops: 0 }, w1: { status: 'running', attempts: 2, costUsd: 0, loops: 0 } } });
    progressLines(redo, seen);
    const fin = team({ nodes: { boss: { status: 'done', attempts: 1, costUsd: 0, loops: 0 }, w1: { status: 'done', attempts: 2, costUsd: 0, loops: 0 } } });
    expect(progressLines(fin, seen).join('\n')).toMatch(/Coder finished/);
    const t = finalSummary(team({ status: 'error', error: 'budget exhausted ($5.1000 of $5)', costUsd: 5.1 }));
    expect(t).toMatch(/budget exhausted/);
    expect(finalSummary(team({ status: 'error', error: 'wall-clock limit reached' }))).toMatch(/wall-clock limit reached/);
  });
  it('a finished plan waiting for approval needs you', () => {
    expect(runNeedsYou({ status: 'running', pending: 0, planReady: true })).toBe(true);
    expect(runNeedsYou({ status: 'stopped', pending: 0, planReady: true })).toBe(false);
  });
});

describe('CardInput', () => {
  const mk = () => {
    const calls: unknown[][] = [];
    const engine = {
      recordPlanAnswers: vi.fn((...a: unknown[]) => (calls.push(['plan', ...a]), true)),
      continuePlanningInBackground: vi.fn(),
      answerUser: vi.fn((...a: unknown[]) => (calls.push(['user', ...a]), new Promise<void>(() => {}))),
    };
    return { engine, calls, input: new CardInput() };
  };
  const st = (extra: Partial<RunState> = {}) => team({ planning: true, pending: [q('db', { allowOther: true })], ...extra });
  const errs: string[] = [];
  const onError = (m: string) => errs.push(m);

  it('with focus, digits and enter answer the first card; unknown keys and typed text are left alone', () => {
    const { engine, input } = mk();
    expect(input.key(engine as never, 'r1', st(), 'x', '', onError).used).toBe(false);
    expect(input.key(engine as never, 'r1', st(), '1', 'ok', onError).used).toBe(false);
    expect(input.key(engine as never, 'r1', st(), '2', '', onError).used).toBe(false); // no focus yet: a chat message
    expect(engine.recordPlanAnswers).not.toHaveBeenCalled();
    expect(input.key(engine as never, 'r1', st(), 'enter', '', onError).used).toBe(true); // focus
    expect(input.key(engine as never, 'r1', st(), '2', '', onError).used).toBe(true);
    expect(engine.recordPlanAnswers).toHaveBeenCalledWith('r1', [{ question: 'db', option: 'sqlite', by: 'user' }]);
    expect(engine.continuePlanningInBackground).toHaveBeenCalledWith('r1');
    expect(input.key(engine as never, 'r1', st(), 'enter', '', onError).used).toBe(true);
  });

  it('o starts free text; empty enter is a no-op that stays in free text; enter sends; esc backs out', () => {
    const { engine, input } = mk();
    input.key(engine as never, 'r1', st(), 'enter', '', onError);
    expect(input.key(engine as never, 'r1', st(), 'o', '', onError).used).toBe(true);
    expect(input.other).toBe('db');
    expect(input.key(engine as never, 'r1', st(), 'k', 'k', onError).used).toBe(false); // typing
    expect(input.key(engine as never, 'r1', st(), 'enter', '', onError)).toMatchObject({ used: true });
    expect(engine.recordPlanAnswers).not.toHaveBeenCalled();
    expect(input.other).toBe('db');
    const r = input.key(engine as never, 'r1', st(), 'enter', '  use sqlite  ', onError);
    expect(r).toMatchObject({ used: true, clearText: true });
    expect(engine.recordPlanAnswers).toHaveBeenCalledWith('r1', [{ question: 'db', text: 'use sqlite', by: 'user' }]);
    expect(input.other).toBeUndefined();
    input.key(engine as never, 'r1', st(), 'o', '', onError);
    expect(input.key(engine as never, 'r1', st(), 'esc', 'abc', onError)).toMatchObject({ used: true, clearText: true });
    expect(input.other).toBeUndefined();
  });

  it('a worker question goes to answerUser and a second press while it is in flight is ignored', () => {
    const { engine, input, calls } = mk();
    const w = st({ planning: false, userAsks: [{ node: 'w1', question: q('db'), wait: true }] } as never);
    input.key(engine as never, 'r1', w, 'enter', '', onError);
    input.key(engine as never, 'r1', w, '1', '', onError);
    input.key(engine as never, 'r1', w, '1', '', onError);
    expect(calls).toEqual([['user', 'r1', 'db', { option: 'pg', text: undefined }]]);
  });
});

describe('/mode and plan commands', () => {
  it('/mode reaches engine.setMode; a bad or missing value only explains', () => {
    const engine = { setMode: vi.fn() };
    expect(modeCommand(engine as never, 'r1', team(), 'autonomous')).toMatch(/autonomous/);
    expect(engine.setMode).toHaveBeenCalledWith('r1', 'autonomous');
    engine.setMode.mockClear();
    expect(modeCommand(engine as never, 'r1', team(), 'fast')).toMatch(/live \| autonomous/);
    expect(modeCommand(engine as never, 'r1', team({ kind: 'workflow' }), 'live')).toMatch(/team run/);
    expect(engine.setMode).not.toHaveBeenCalled();
    engine.setMode.mockImplementation(() => { throw new Error('this run is not active (done)'); });
    expect(modeCommand(engine as never, 'r1', team(), 'live')).toMatch(/not active/);
  });
  it('approve and reject call approveTeamPlan', async () => {
    const engine = { approveTeamPlan: vi.fn(async () => {}) };
    await planDecision(engine as never, 'r1', true);
    await planDecision(engine as never, 'r1', false);
    expect(engine.approveTeamPlan.mock.calls).toEqual([['r1', true], ['r1', false]]);
  });
});

describe('Tui chat wiring', () => {
  const card = { id: 'q1', ask: 'ask q1', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], recommended: 'b', allowOther: true };
  const plan = { goal: 'g', success: ['s'], assignments: [{ bot: 'coder', goal: 'c' }] };
  async function boot(mock: object, o: object = {}) {
    const { home, registry, store } = setup();
    const engine = new Engine(store, { home, registry, bindings: () => ({ orchestrator: { agent: 'mock' }, manager: { agent: 'mock' } }) });
    const repo = makeRepo();
    const out = { write: () => true, columns: 100, rows: 40 } as unknown as NodeJS.WriteStream;
    const ui = new Tui({ cfg: { home, vault: tmp('v-'), adapters: {}, endpoints: {} } as never, store, engine }, out) as any;
    const id = await engine.startTeam({ task: 'x', repo, workspace: false, roster: ['coder'], mock: mock as never, ...o });
    return { ui, engine, store, id };
  }

  it('the run view of a team run that is still planning has no steps; no key throws', async () => {
    const { ui, id } = await boot({ questions: [[card]], plan });
    ui.push({ kind: 'run', runId: id, sel: 0 });
    for (const k of ['enter', 'i', 'd', '+', '-', 'a', 'x', 'right', 'left', 'enter']) {
      expect(() => ui.runKey(ui.screen, k), k).not.toThrow();
    }
    expect(ui.screen.sel).toBe(0);
    // the screen draws too: this was the real crash (runBody indexed an empty step list)
    let lines: string[] = [];
    expect(() => (lines = ui.runBody(ui.screen, 30))).not.toThrow();
    expect(lines.join('\n')).toContain('no steps yet');
    expect(lines.join('\n')).toContain('/');
    expect(() => ui.draw()).not.toThrow();
  });

  it('a pending permit prompt wins over a team card; the card keeps its question', async () => {
    const { ui, store, id } = await boot({ questions: [[card]], plan });
    ui.openRunSession(id);
    ui.sess.log.push({ k: 'permit', command: 'ls', cwd: '/', st: 'pending', sel: 0 });
    ui.chatKey(ui.screen, '1'); // allow once, not "option 1 of the card"
    expect(ui.sess.log.at(-1).st).not.toBe('pending');
    expect(store.state(id)!.pending).toHaveLength(1);
    ui.sess.log.push({ k: 'offer', r: { text: '', warnings: [], proposal: { kind: 'team', task: 't' } }, st: 'pending' });
    ui.chatKey(ui.screen, 'enter');
    expect(store.state(id)!.pending).toHaveLength(1);
  });

  it('digits answer the card in the run conversation; the main chat ignores another run\'s card', async () => {
    const { ui, store, id } = await boot({ questions: [[card]], plan });
    ui.chatKey(ui.screen, '1');
    ui.chatKey(ui.screen, 'enter');
    expect(store.state(id)!.pending).toHaveLength(1); // main chat: not captured
    ui.openRunSession(id);
    ui.chatKey(ui.screen, 'enter'); // give the card focus
    ui.chatKey(ui.screen, '1');
    await vi.waitFor(() => expect(store.state(id)!.answers).toEqual([{ question: 'q1', option: 'a', by: 'user' }]));
  });

  it('free text: empty enter is swallowed and the card stays in free-text mode', async () => {
    const { ui, store, id } = await boot({ questions: [[card]], plan });
    ui.openRunSession(id);
    ui.chatKey(ui.screen, 'enter');
    ui.chatKey(ui.screen, 'o');
    expect(ui.cardIn.other).toBe('q1');
    ui.chatKey(ui.screen, 'enter');
    expect(ui.cardIn.other).toBe('q1');
    expect(store.state(id)!.pending).toHaveLength(1);
    for (const ch of 'hi') ui.chatKey(ui.screen, ch);
    ui.chatKey(ui.screen, 'enter');
    await vi.waitFor(() => expect(store.state(id)!.answers).toEqual([{ question: 'q1', text: 'hi', by: 'user' }]));
  });

  it('without card focus, a message that starts with a digit or "o" is typed, not an answer', async () => {
    const { ui, store, id } = await boot({ questions: [[card]], plan });
    ui.openRunSession(id);
    for (const ch of '2 more reviewers') ui.chatKey(ui.screen, ch);
    expect(ui.talk.text).toBe('2 more reviewers');
    ui.talk.text = '';
    for (const ch of 'ok go') ui.chatKey(ui.screen, ch);
    expect(ui.talk.text).toBe('ok go');
    expect(ui.cardIn.other).toBeUndefined();
    expect(store.state(id)!.answers).toEqual([]);
    expect(store.state(id)!.pending).toHaveLength(1);
  });

  it('free text after o never reaches Tether, even when a permit prompt shows up meanwhile', async () => {
    const { ui, store, id } = await boot({ questions: [[card]], plan });
    ui.openRunSession(id);
    const sent = vi.spyOn(ui, 'sendTalk').mockImplementation(() => undefined);
    ui.chatKey(ui.screen, 'enter');
    ui.chatKey(ui.screen, 'o');
    for (const ch of 'half') ui.chatKey(ui.screen, ch);
    ui.sess.log.push({ k: 'permit', command: 'ls', cwd: '/', st: 'pending', sel: 0 });
    for (const ch of ' done') ui.chatKey(ui.screen, ch);
    ui.chatKey(ui.screen, 'enter');
    expect(sent).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(store.state(id)!.answers).toEqual([{ question: 'q1', text: 'half done', by: 'user' }]));
    expect(ui.cardIn.other).toBeUndefined();
    expect(ui.sess.log.at(-1).st).toBe('pending'); // the permit is still there to answer
  });

  it('the face is waiting while a question or a ready plan needs you', async () => {
    const a = await boot({ questions: [[card]], plan });
    expect(a.ui.faceMood(a.store.list())).toBe('waiting');
    const b = await boot({ questions: [], plan }, { yes: true });
    expect(b.store.state(b.id)!.plan).toBeDefined();
    expect(b.store.list()[0]).toMatchObject({ planReady: true });
    expect(b.ui.faceMood(b.store.list())).toBe('waiting');
  });

  it('/mode and /approve /reject reach the engine', async () => {
    const { ui, engine, store, id } = await boot({ questions: [], plan }, { yes: true });
    ui.openRunSession(id);
    ui.slash(ui.screen, '/mode autonomous');
    expect(store.state(id)!.mode).toBe('autonomous');
    const spy = vi.spyOn(engine, 'approveTeamPlan').mockResolvedValue(undefined);
    ui.slash(ui.screen, '/approve');
    ui.slash(ui.screen, '/reject');
    expect(spy.mock.calls).toEqual([[id, true], [id, false]]);
  });

  it('/swap reaches the engine and shows its refusal as a note', async () => {
    const { ui, engine, id } = await boot({ questions: [], plan }, { yes: true });
    ui.openRunSession(id);
    const spy = vi.spyOn(engine, 'swapAssignment').mockImplementationOnce(() => ({}) as RunState).mockImplementationOnce(() => {
      throw new Error('"nobody" is not on this plan\'s roster');
    });
    ui.slash(ui.screen, '/swap 1 helper');
    ui.slash(ui.screen, '/swap 1 nobody');
    ui.slash(ui.screen, '/swap one helper');
    expect(spy.mock.calls).toEqual([[id, 0, 'helper'], [id, 0, 'nobody']]);
    const notes = ui.sess.log.filter((e: any) => e.k === 'note').map((e: any) => e.text);
    expect(notes.slice(-3)).toEqual(['assignment 1 → helper', '"nobody" is not on this plan\'s roster', expect.stringMatching(/^usage: \/swap/)]);
  });

  it('the ready plan numbers assignments, shows why, the swap mark and the roster', async () => {
    const withWhy = { ...plan, assignments: [{ bot: 'coder', goal: 'c', why: 'knows the parser' }] };
    const { ui, engine, id } = await boot({ questions: [], plan: withWhy }, { yes: true, roster: ['coder', 'reviewer'] });
    ui.openRunSession(id);
    engine.swapAssignment(id, 0, 'reviewer');
    const text = ui.transcript(100).map((l: { text: string }) => strip(l.text)).join('\n');
    expect(text).toMatch(/1\. · reviewer \(your pick\): c/);
    expect(text).toContain('why: knows the parser');
    expect(text).toContain('/swap <n> <bot>');
    expect(text).toMatch(/roster: .*reviewer/);
  });

  it('autonomous mode tells the person when a limit ended the run', async () => {
    const { ui, store, id } = await boot({ questions: [], plan }, { yes: true, mode: 'autonomous' });
    ui.openRunSession(id);
    const sess = ui.sess;
    const st = { ...store.state(id)!, status: 'error', error: 'budget exhausted ($5.2000 of $5)' };
    ui.report(sess, st);
    expect(sess.log.filter((e: any) => e.k === 'tether').map((e: any) => e.text).join('\n')).toMatch(/budget exhausted/);
  });
});

describe('/swap', () => {
  it('parses a 1-based assignment and a bot id', () => {
    expect(parseSwap('/swap 2 go-reviewer')).toEqual({ assignment: 1, bot: 'go-reviewer' });
    expect(parseSwap('/swap 0 x')).toBeUndefined();
    expect(parseSwap('/swap two x')).toBeUndefined();
    expect(parseSwap('/approve')).toBeUndefined();
  });
});
