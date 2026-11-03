import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { claudeArgs } from '../src/adapters/claude.js';
import { CliAdapter, codexSpec, customSpec, opencodeSpec } from '../src/adapters/cli.js';
import { CLAUDE_TOOL } from '../src/codemode/delivery.js';
import { commandHookLine } from '../src/codemode/launch.js';
import { savePrefs } from '../src/prefs.js';
import { setTrust } from '../src/trust.js';
import type { CodeModeRequest } from '../src/types.js';
import { makeRepo, pipe, setup, tmp } from './helpers.js';

const fullPipeline = () =>
  pipe(
    [
      { id: 'plan', role: 'planner', readOnly: true, mock: { output: 'PLAN: add done.txt' } },
      { id: 'code', role: 'coder', mock: { writeFile: { path: 'done.txt', content: 'ok\n' }, writeFileFromAttempt: 2 } },
      { id: 'tests', kind: 'gate', command: 'test -f done.txt', fixNode: 'code', maxLoops: 2 },
      { id: 'review', role: 'reviewer', verdict: true, readOnly: true, includeDiff: true, mock: { verdicts: ['PASS'] } },
      { id: 'ok', kind: 'approval' },
    ],
    [['plan', 'code'], ['code', 'tests'], ['tests', 'review'], ['review', 'ok']],
  );

describe('engine', () => {
  it('records what each step’s commit changed and where the run was started from', async () => {
    const { engine } = setup();
    const p = pipe([{ id: 'code', role: 'coder', mock: { writeFile: { path: 'a.txt', content: 'one\ntwo\n' } } }], []);
    const id = await engine.start({ pipeline: p, task: 'write a.txt', repo: makeRepo(), origin: { kind: 'chat', id: 'c1' } });
    const s = await engine.wait(id);
    expect(s.nodes.code!.stat).toEqual({ files: 1, added: 2, deleted: 0 });
    expect(s.origin).toEqual({ kind: 'chat', id: 'c1' });
  });

  it('loops a failing gate back to the fixing agent, pauses at approval, and resumes without re-running finished nodes', async () => {
    const { engine, mock, store } = setup();
    const repo = makeRepo();
    const id = await engine.start({ pipeline: fullPipeline(), task: 'add done.txt', repo });
    let s = await engine.wait(id);

    expect(s.status).toBe('paused');
    expect(s.nodes.code!.attempts).toBe(2); // first attempt failed the gate, second fixed it
    expect(s.nodes.tests!.loops).toBe(1);
    expect(s.nodes.tests!.status).toBe('done');
    expect(s.nodes.review!.verdict).toBe('PASS');
    expect(s.nodes.ok!.status).toBe('awaiting');
    expect(s.nodes.code!.commit).toBeTruthy();

    // the fix attempt was told why it was sent back
    const fixPrompt = mock.calls.filter((c) => c.nodeId === 'code')[1]!.prompt;
    expect(fixPrompt).toContain('A check failed');
    // the reviewer saw the diff
    expect(mock.calls.find((c) => c.nodeId === 'review')!.prompt).toContain('done.txt');
    // the user's own checkout is untouched
    expect(existsSync(join(repo, 'done.txt'))).toBe(false);
    expect(existsSync(join(s.workdir, 'done.txt'))).toBe(true);

    const callsBefore = mock.calls.length;
    engine.approve(id, 'ok', true);
    await engine.resume(id);
    s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(mock.calls.length).toBe(callsBefore); // nothing re-ran
    expect(store.events(id).some((e) => e.event.type === 'run.resumed')).toBe(true);
  });

  it('a rejected approval fails the run', async () => {
    const { engine } = setup();
    const id = await engine.start({ pipeline: fullPipeline(), task: 't', repo: makeRepo() });
    await engine.wait(id);
    engine.approve(id, 'ok', false);
    await engine.resume(id);
    const s = await engine.wait(id);
    expect(s.status).toBe('error');
  });

  it('autoApprove runs straight through', async () => {
    const { engine } = setup();
    const id = await engine.start({ pipeline: fullPipeline(), task: 't', repo: makeRepo(), autoApprove: true });
    expect((await engine.wait(id)).status).toBe('done');
  });

  it('stop leaves the interrupted node recoverable; resume runs only what is left', async () => {
    const { engine, mock } = setup();
    const p = pipe(
      [
        { id: 'a', role: 'planner', readOnly: true },
        { id: 'b', role: 'coder', mock: { delayMs: 800, writeFile: { path: 'b.txt', content: 'b' } } },
        { id: 'c', role: 'tester', readOnly: true },
      ],
      [['a', 'b'], ['b', 'c']],
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    await new Promise((r) => setTimeout(r, 250));
    expect(engine.stop(id)).toBe(true);
    let s = await engine.wait(id);
    expect(s.status).toBe('stopped');
    expect(s.nodes.a!.status).toBe('done');
    expect(s.nodes.b!.output).toBeUndefined(); // never recorded a result

    await engine.resume(id);
    s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(mock.calls.filter((c) => c.nodeId === 'a')).toHaveLength(1); // a was not re-run
    expect(s.nodes.b!.status).toBe('done');
    expect(s.nodes.b!.attempts).toBe(2);
  });

  it('a failed node skips its downstream, lets siblings finish, and the run errors', async () => {
    const { engine } = setup();
    const p = pipe(
      [
        { id: 'a', role: 'planner', readOnly: true },
        { id: 'bad', role: 'coder', mock: { failFirst: 5 } },
        { id: 'sib', role: 'architect', readOnly: true },
        { id: 'after', role: 'tester', readOnly: true },
      ],
      [['a', 'bad'], ['a', 'sib'], ['bad', 'after']],
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(s.status).toBe('error');
    expect(s.nodes.bad!.status).toBe('error');
    expect(s.nodes.sib!.status).toBe('done');
    expect(s.nodes.after!.status).toBe('skipped');
  });

  it('resume with retryFailed re-runs only the failed branch', async () => {
    const { engine, mock } = setup();
    const p = pipe(
      [
        { id: 'a', role: 'planner', readOnly: true },
        { id: 'flaky', role: 'coder', mock: { failFirst: 1 } },
      ],
      [['a', 'flaky']],
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    expect((await engine.wait(id)).status).toBe('error');
    await engine.resume(id);
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(mock.calls.filter((c) => c.nodeId === 'a')).toHaveLength(1);
  });

  it('reverts and fails a read-only node that modifies files', async () => {
    const { engine } = setup();
    const p = pipe([{ id: 'sneaky', role: 'planner', readOnly: true, mock: { writeFile: { path: 'oops.txt', content: 'x' } } }], []);
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(s.nodes.sneaky!.status).toBe('error');
    expect(s.nodes.sneaky!.error).toMatch(/read-only/);
    expect(existsSync(join(s.workdir, 'oops.txt'))).toBe(false);
  });

  it('stops spending once the cap is reached', async () => {
    const { engine, mock, home } = setup();
    savePrefs(home, { spendingCaps: true });
    const p = pipe(
      [
        { id: 'a', role: 'planner', readOnly: true, mock: { costUsd: 0.6 } },
        { id: 'b', role: 'coder', mock: { costUsd: 0.6 } },
      ],
      [['a', 'b']],
      { maxCostUsd: 0.5 },
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/budget/);
    expect(s.nodes.b!.status).toBe('skipped');
    expect(mock.calls.some((c) => c.nodeId === 'b')).toBe(false);
  });

  it('a gate that never passes ends the run in error after the loop limit', async () => {
    const { engine } = setup();
    const p = pipe(
      [
        { id: 'code', role: 'coder', mock: { output: 'tried' } },
        { id: 'tests', kind: 'gate', command: 'echo nope >&2; exit 3', fixNode: 'code', maxLoops: 1 },
      ],
      [['code', 'tests']],
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(s.status).toBe('error');
    expect(s.nodes.tests!.loops).toBe(1);
    expect(s.nodes.tests!.gate!.exitCode).toBe(3);
    expect(s.nodes.code!.attempts).toBe(2);
  });

  it('passes upstream output downstream and runs setup once', async () => {
    const { engine, mock } = setup();
    const p = pipe(
      [
        { id: 'a', role: 'planner', readOnly: true, mock: { output: 'UNIQUE-UPSTREAM-TEXT' } },
        { id: 'b', role: 'coder', mock: { output: 'done' } },
      ],
      [['a', 'b']],
      { setup: 'echo hi > setup.marker' },
    );
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    const s = await engine.wait(id);
    expect(s.status).toBe('done');
    expect(mock.calls.find((c) => c.nodeId === 'b')!.prompt).toContain('UNIQUE-UPSTREAM-TEXT');
    expect(s.setupDone).toBe(true);
    // setup output stays out of the agent's commits (it is not the agent's work), and out of the read-only check
    expect(s.setupArtifacts).toContain('setup.marker');
    expect(s.nodes.b!.commit).toBeUndefined();
    expect(s.nodes.a!.status).toBe('done');
  });

  it('refuses unsupported modes in the engine itself, not just preflight', async () => {
    const { engine, store } = setup();
    const p = pipe([{ id: 'a' }], []);
    const id = await engine.start({ pipeline: p, task: 't', repo: makeRepo() });
    await engine.wait(id);
    // tamper: hand the engine a swarm run directly
    const swarm = { ...p, mode: 'swarm' as const };
    const repo = makeRepo();
    await expect(engine.start({ pipeline: swarm, task: 't', repo })).rejects.toThrow(/no scheduler/);
    expect(store.list().length).toBe(1);
  });
});

describe('deleting runs', () => {
  it('removes the log, worktree, branch and chat of a finished run, and refuses a live one', async () => {
    const { engine, store } = setup();
    const repo = makeRepo();
    const id = await engine.start({ pipeline: pipe([{ id: 'code', role: 'coder', mock: { writeFile: { path: 'a.txt', content: 'x\n' } } }], []), task: 'x', repo });
    const s = await engine.wait(id);
    expect(existsSync(s.workdir)).toBe(true);
    await engine.deleteRun(id);
    expect(store.state(id)).toBeUndefined();
    expect(store.runIds()).not.toContain(id);
    expect(existsSync(s.workdir)).toBe(false);
    await expect(engine.deleteRun(id)).rejects.toThrow(/unknown run/);
  });
});

const NO_COMMANDS = "You can't run commands here, so end by saying what you did not check.";
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const source = { execPath: process.execPath, electron: false, execArgv: ['--import', 'tsx'], cliPath: join(REPO_ROOT, 'src/cli.ts') };
const runLine = (line: string, input: string) => spawnSync('sh', ['-c', line], { input, cwd: REPO_ROOT, encoding: 'utf8' });
const hookRaw = (input: string) => runLine(commandHookLine(source), input);
const hook = (v: unknown) => hookRaw(JSON.stringify(v));
const hookOf = (args: string[]) => JSON.parse(args[args.indexOf('--settings') + 1]!).hooks.PreToolUse[0];

describe('commands', () => {
  it('Claude gets Bash, guarded by the command hook, only with commands', () => {
    const args = claudeArgs({ commands: true, readOnly: false });
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Bash');
    expect(args[args.indexOf('--settings') + 1]).toContain('PreToolUse');
    expect(hookOf(args).matcher).toBe('Bash|Monitor');
    expect(args).not.toContain('--disallowedTools');
    expect(JSON.parse(args[args.indexOf('--settings') + 1]!).disableAllHooks).toBe(false); // a project's own settings cannot turn the guard off
    const off = claudeArgs({ readOnly: false });
    expect(off.slice(off.indexOf('--disallowedTools'), off.indexOf('--disallowedTools') + 3)).toEqual(['--disallowedTools', 'Bash', 'Monitor']);
    expect(off).not.toContain('--allowedTools');
    expect(off).not.toContain('--settings');
  });

  it('denies Bash and Monitor in any mode but plan, in one list with Code Mode', () => {
    expect(claudeArgs({ readOnly: true })).not.toContain('--disallowedTools');
    expect(claudeArgs({ readOnly: false, permissionMode: 'plan' })).not.toContain('--disallowedTools');
    const bypass = claudeArgs({ readOnly: false, permissionMode: 'bypassPermissions' });
    expect(bypass[bypass.indexOf('--disallowedTools') + 1]).toBe('Bash');
    expect(claudeArgs({ readOnly: true, permissionMode: 'acceptEdits' })).toContain('--disallowedTools');

    const codeMode = { note: 'n', runner: {}, readsOnly: true, mcp: { command: 'x', args: [], dir: tmp() } } as unknown as CodeModeRequest;
    const args = claudeArgs({ readOnly: false, codeMode });
    expect(args.filter((a) => a === '--disallowedTools')).toHaveLength(1);
    expect(args.slice(args.indexOf('--disallowedTools') + 1, args.indexOf('--disallowedTools') + 5).sort()).toEqual(['Bash', 'Glob', 'Grep', 'Monitor']);
  });

  it('a read-only step gets neither, even if asked', () => {
    const args = claudeArgs({ commands: true, readOnly: true });
    expect(args.join(' ')).not.toContain('Bash');
    expect(args).not.toContain('--settings');
  });

  it('the hook also judges Monitor, and refuses a Monitor with no command', () => {
    expect(hook({ tool_name: 'Monitor', tool_input: { command: 'tail -f ../other.log' } }).status).toBe(2);
    expect(hook({ tool_name: 'Monitor', tool_input: { ws: { url: 'wss://example.com' } } }).status).toBe(2);
  });

  it('keeps one --allowedTools, with Code Mode', () => {
    const dir = tmp();
    const codeMode = { note: 'n', runner: {}, mcp: { command: 'x', args: [], dir } } as unknown as CodeModeRequest;
    const args = claudeArgs({ commands: true, readOnly: false, codeMode });
    expect(args.filter((a) => a === '--allowedTools')).toHaveLength(1);
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(`${CLAUDE_TOOL},Bash`);
    const off = claudeArgs({ readOnly: false, codeMode });
    expect(off[off.indexOf('--allowedTools') + 1]).toBe(CLAUDE_TOOL);
  });

  it('keeps the hook on, whatever permission mode the step sets', () => {
    const args = claudeArgs({ commands: true, readOnly: false, permissionMode: 'bypassPermissions' });
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions');
    expect(hookOf(args).hooks[0]).toMatchObject({ command: expect.stringMatching(/\|\| exit 2$/), onFailure: 'block' });
  });

  it('the command hook refuses what commandRule refuses, and refuses if it breaks', () => {
    expect(hook({ tool_input: { command: 'npm test' } }).status).toBe(0);
    const no = hook({ tool_input: { command: 'cd /etc' } });
    expect(no.status).toBe(2);
    expect(no.stderr).toMatch(/not run/i);
    expect(hookRaw('not json').status).toBe(2);
    expect(hook({ tool_input: {} }).status).toBe(2);
    expect(hookRaw('null').status).toBe(2);
  });

  it('the command hook takes the step folder from its cwd', () => {
    const root = tmp();
    expect(hook({ cwd: root, tool_input: { command: `cat ${root}/a.txt` } }).status).toBe(0);
    expect(hook({ tool_input: { command: `cat ${root}/a.txt` } }).status).toBe(2);
    expect(hook({ cwd: `${root}/a/b`, tool_input: { command: 'echo hi > ../../../marker' } }).status).toBe(2);
  });

  it('a hook file that is missing refuses, in a path with spaces and quotes', () => {
    const dir = join(tmp(), "Tether's App", 'dist');
    mkdirSync(dir, { recursive: true });
    const line = commandHookLine({ execPath: process.execPath, electron: false, execArgv: [], cliPath: join(dir, 'cli.js') });
    expect(line).toContain("Tether'\\''s App");
    expect(runLine(line, '{"tool_input":{"command":"npm test"}}').status).toBe(2);
    expect(runLine(`'/no such/node' 'x.js' || exit 2`, '{}').status).toBe(2);
  });

  it('runs the app\'s own binary as Node, and only passes loader flags for TypeScript', () => {
    const line = commandHookLine({ execPath: '/Applications/My Apps/Tether', electron: true, execArgv: ['--import', 'tsx', '--inspect'], cliPath: '/App Dir/dist/cli.js' });
    expect(line).toBe("ELECTRON_RUN_AS_NODE=1 '/Applications/My Apps/Tether' '/App Dir/dist/commandHook.js' || exit 2");
    expect(commandHookLine(source)).toBe(`'${process.execPath}' '--import' 'tsx' '${join(REPO_ROOT, 'src/commandHook.ts')}' || exit 2`);
  });

  it('a run in a trusted folder sends commands; an untrusted one does not', async () => {
    const { engine, mock, home } = setup();
    const repo = makeRepo();
    const p = () => pipe([{ id: 'look', role: 'planner', readOnly: true, mock: { output: 'ok' } }, { id: 'code', role: 'coder', mock: { output: 'ok' } }], [['look', 'code']]);
    await engine.wait(await engine.start({ pipeline: p(), task: 't', repo }));
    expect(mock.calls.map((c) => [c.nodeId, c.commands])).toEqual([['look', false], ['code', false]]);
    expect(mock.calls.map((c) => c.prompt.includes(NO_COMMANDS))).toEqual([true, true]);

    mock.calls.length = 0;
    setTrust(home, repo, true);
    await engine.wait(await engine.start({ pipeline: p(), task: 't', repo }));
    expect(mock.calls.map((c) => [c.nodeId, c.commands])).toEqual([['look', false], ['code', true]]);
    expect(mock.calls.map((c) => c.prompt.includes(NO_COMMANDS))).toEqual([true, false]);
  });

  it('says nothing about commands to an agent with its own shell', async () => {
    expect(new CliAdapter(codexSpec).ownShell).toBe(true);
    expect(new CliAdapter(opencodeSpec).ownShell).toBe(true);
    expect(new CliAdapter(customSpec('mine', { command: 'x', args: [] })).ownShell).toBe(true);
    const { engine, mock } = setup();
    Object.assign(mock, { ownShell: true });
    await engine.wait(await engine.start({ pipeline: pipe([{ id: 'code', role: 'coder', mock: { output: 'ok' } }], []), task: 't', repo: makeRepo() }));
    expect(mock.calls[0]!.prompt).not.toContain(NO_COMMANDS);
  });

  it('a verdict still ends the answer', async () => {
    const { engine, mock } = setup();
    await engine.wait(await engine.start({ pipeline: pipe([{ id: 'r', role: 'reviewer', verdict: true, prompt: 'Look.', mock: { verdicts: ['PASS'] } }], []), task: 't', repo: makeRepo() }));
    const prompt = mock.calls[0]!.prompt;
    expect(prompt.indexOf(NO_COMMANDS)).toBeGreaterThan(-1);
    expect(prompt.indexOf(NO_COMMANDS)).toBeLessThan(prompt.indexOf('End your answer with exactly one line'));
  });
});
