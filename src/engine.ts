import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { AdapterRegistry } from './adapters/index.js';
import { computeCoach } from './coach.js';
import { commitAll, commitFiles, createWorktree, diffAgainst, entryPaths, revertEntries, statusEntries } from './git.js';
import { answersBlock, askable, consultPrompt, parseAsks, resolveTarget, stripAsks, type Ask } from './consult.js';
import { parentsOf, preflight } from './pipeline.js';
import { buildPrompt } from './prompt.js';
import { runProcess } from './proc.js';
import type { Store } from './store.js';
import type { AgentResult, Pipeline, PipelineNode, RunState } from './types.js';
import { applyBindings, type Bindings } from './bindings.js';
import { Vault } from './vault.js';
import { resolveWorkspace, snapshot } from './workspace.js';

export interface EngineOptions {
  /** Where worktrees live (state dir). */
  home: string;
  registry: AdapterRegistry;
  /** Bot ↔ model links, read fresh for every run so edits apply to the next start. */
  bindings?: () => Bindings;
  vault?: Vault;
}

export interface StartInput {
  pipeline: Pipeline;
  task: string;
  repo: string;
  ref?: string;
  autoApprove?: boolean;
  /** A workspace id, or false for none. Default: the registered workspace that holds the repo, or the repo's own .aorch files. */
  workspace?: string | false;
}

const MAX_OUTPUT = 200_000;
const tail = (s: string, n: number) => (s.length > n ? s.slice(s.length - n) : s);

interface NodeOutcome {
  ok: boolean;
  aborted?: boolean;
}

export class Engine {
  private active = new Map<string, AbortController>();
  private running = new Map<string, Promise<void>>();

  constructor(
    readonly store: Store,
    readonly opts: EngineOptions,
  ) {}

  isLive(runId: string): boolean {
    return this.active.has(runId);
  }

  /** Resolves when the run's current execution pass ends (done, error, paused or stopped). */
  async wait(runId: string): Promise<RunState> {
    await this.running.get(runId);
    const s = this.store.state(runId);
    if (!s) throw new Error(`unknown run ${runId}`);
    return s;
  }

  /** The pipeline as it will actually run: steps without their own agent follow their bot's binding. */
  resolve(p: Pipeline): Pipeline {
    return applyBindings(p, this.opts.bindings?.() ?? {});
  }

  async start(rawInput: StartInput): Promise<string> {
    const input = { ...rawInput, pipeline: this.resolve(rawInput.pipeline) };
    const ws = rawInput.workspace === false ? undefined : resolveWorkspace(this.opts.home, { workspace: rawInput.workspace, repo: input.repo });
    // the project's setup command is the run's default; a workflow that sets its own keeps it
    if (ws?.setup && !input.pipeline.settings.setup) input.pipeline = { ...input.pipeline, settings: { ...input.pipeline.settings, setup: ws.setup } };
    const errors = preflight(input.pipeline, this.opts.registry).filter((i) => i.level === 'error');
    if (errors.length) {
      throw new Error(`preflight failed:\n${errors.map((e) => `- ${e.node ? `[${e.node}] ` : ''}${e.message}`).join('\n')}`);
    }
    const runId = `r${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const wt = await createWorktree(input.repo, this.opts.home, runId, input.ref);
    this.store.append(runId, {
      type: 'run.started',
      pipeline: input.pipeline,
      task: input.task,
      repo: input.repo,
      workdir: wt.workdir,
      baseSha: wt.baseSha,
      branch: wt.branch,
      vault: this.opts.vault?.root,
      autoApprove: input.autoApprove,
      workspace: ws ? snapshot(ws) : undefined,
    });
    this.launch(runId);
    return runId;
  }

  /** Continue a run from its event log. Finished nodes are never re-run. */
  async resume(runId: string, o: { retryFailed?: boolean } = {}): Promise<void> {
    if (this.active.has(runId)) throw new Error('run is already live');
    const s = this.store.state(runId);
    if (!s) throw new Error(`unknown run ${runId}`);
    if (s.status === 'done') throw new Error('run already finished');
    if (!existsSync(s.workdir)) throw new Error(`worktree is gone (${s.workdir}); cannot resume`);
    this.store.append(runId, { type: 'run.resumed', retryFailed: o.retryFailed ?? s.status === 'error' });
    this.launch(runId);
  }

  /** Re-point one agent step at another agent/model before a resume. Recorded in the log. */
  amend(runId: string, node: string, patch: { agent?: string; model?: string; guidance?: string }, reason: string): void {
    const s = this.store.state(runId);
    const n = s?.pipeline.nodes.find((x) => x.id === node);
    if (!s || !n) throw new Error(`unknown step "${node}"`);
    if (n.kind !== 'agent') throw new Error(`step "${node}" is not an agent step`);
    if (this.active.has(runId)) throw new Error('stop the run before amending it');
    const agent = patch.agent ?? n.agent ?? 'claude';
    if (!this.opts.registry.has(agent)) throw new Error(`unknown agent adapter "${agent}"`);
    this.store.append(runId, { type: 'node.amended', node, agent: patch.agent ?? n.agent, model: patch.agent ? patch.model : n.model, guidance: patch.guidance?.slice(0, 1000), reason });
  }

  stop(runId: string): boolean {
    const ac = this.active.get(runId);
    if (!ac) return false;
    ac.abort();
    return true;
  }

  approve(runId: string, node: string, approved: boolean, by = 'user'): void {
    const s = this.store.state(runId);
    if (!s) throw new Error(`unknown run ${runId}`);
    if (s.nodes[node]?.status !== 'awaiting') throw new Error(`node "${node}" is not awaiting approval`);
    this.store.append(runId, { type: 'approval.resolved', node, approved, by });
  }

  // ------------------------------------------------------------------

  private launch(runId: string) {
    const ac = new AbortController();
    this.active.set(runId, ac);
    const p = this.execute(runId, ac.signal)
      .catch((err: unknown) => {
        this.store.append(runId, { type: 'run.finished', status: 'error', error: (err as Error).message });
      })
      .finally(() => {
        this.active.delete(runId);
        this.running.delete(runId);
      });
    this.running.set(runId, p);
  }

  private async execute(runId: string, signal: AbortSignal): Promise<void> {
    const wallStart = Date.now();
    let state = this.state(runId);
    const pipe = state.pipeline;
    const st = pipe.settings;

    // Defence in depth: preflight already refused this, but the engine is callable without it.
    if (pipe.mode !== 'pipeline') throw new Error(`mode "${pipe.mode}" has no scheduler in this build`);

    if (st.setup && !state.setupDone) {
      const t0 = Date.now();
      const r = await runProcess({ cmd: '/bin/sh', args: ['-c', st.setup], cwd: state.workdir, signal, env: { ...process.env, CI: '1' } });
      if (signal.aborted) return this.finish(runId, 'stopped');
      const ok = r.code === 0;
      const artifacts = ok ? entryPaths(await statusEntries(state.workdir)) : [];
      this.store.append(runId, { type: 'setup.result', ok, output: tail(r.stdout + r.stderr, 20_000), durationMs: Date.now() - t0, artifacts });
      if (!ok) return this.finish(runId, 'error', `setup command failed (exit ${r.code})`);
    }

    for (;;) {
      if (signal.aborted) return this.finish(runId, 'stopped');
      state = this.state(runId);

      if (st.wallClockMs !== undefined && Date.now() - wallStart > st.wallClockMs) {
        this.skipQueued(state, 'wall-clock limit reached');
        return this.finish(runId, 'error', 'wall-clock limit reached');
      }
      if (st.maxCostUsd !== undefined && state.costUsd >= st.maxCostUsd && this.hasQueued(state)) {
        this.skipQueued(state, 'budget exhausted');
        return this.finish(runId, 'error', `budget exhausted ($${state.costUsd.toFixed(4)} of $${st.maxCostUsd})`);
      }

      // A node whose upstream failed can never run.
      let propagated = false;
      for (const n of pipe.nodes) {
        if (state.nodes[n.id]?.status !== 'queued') continue;
        const bad = parentsOf(pipe, n.id).find((p) => ['error', 'skipped'].includes(state.nodes[p]?.status ?? ''));
        if (bad) {
          this.store.append(runId, { type: 'node.skipped', node: n.id, reason: `upstream "${bad}" did not succeed` });
          propagated = true;
        }
      }
      if (propagated) continue;

      const ready = pipe.nodes.filter(
        (n) =>
          state.nodes[n.id]?.status === 'queued' &&
          parentsOf(pipe, n.id).every((p) => state.nodes[p]?.status === 'done'),
      );
      if (!ready.length) break;

      for (const n of ready.filter((x) => x.kind === 'approval')) {
        this.store.append(runId, { type: 'approval.requested', node: n.id });
        if (state.autoApprove) this.store.append(runId, { type: 'approval.resolved', node: n.id, approved: true, by: 'auto' });
      }
      const work = ready.filter((x) => x.kind !== 'approval');
      // Read-only agents without a fix loop can't disturb each other: run those concurrently.
      const concurrent = work.filter((n) => n.kind === 'agent' && n.readOnly && !n.fixNode);
      const serial = work.filter((n) => !concurrent.includes(n));

      await pool(concurrent, st.parallel, (n) => this.runNode(runId, n, signal));
      if (signal.aborted) return this.finish(runId, 'stopped');
      for (const n of serial) {
        const out = await this.runNode(runId, n, signal);
        if (out.aborted || signal.aborted) return this.finish(runId, 'stopped');
      }
    }

    state = this.state(runId);
    const nodes = Object.values(state.nodes);
    if (nodes.some((n) => n.status === 'awaiting')) return this.finish(runId, 'paused');
    if (nodes.some((n) => n.status === 'error' || n.status === 'skipped')) {
      const failed = pipe.nodes.find((n) => state.nodes[n.id]?.status === 'error');
      return this.finish(runId, 'error', failed ? `node "${failed.id}" failed: ${state.nodes[failed.id]?.error ?? 'unknown error'}` : undefined);
    }
    return this.finish(runId, 'done');
  }

  private state(runId: string): RunState {
    const s = this.store.state(runId);
    if (!s) throw new Error(`unknown run ${runId}`);
    return s;
  }

  private hasQueued(s: RunState) {
    return Object.values(s.nodes).some((n) => n.status === 'queued');
  }

  private skipQueued(s: RunState, reason: string) {
    for (const [id, n] of Object.entries(s.nodes)) if (n.status === 'queued') this.store.append(s.id, { type: 'node.skipped', node: id, reason });
  }

  private async finish(runId: string, status: RunState['status'], error?: string): Promise<void> {
    const before = this.state(runId);
    const findings = computeCoach(before);
    if (findings.length && status !== 'stopped') this.store.append(runId, { type: 'run.coach', findings });
    this.store.append(runId, { type: 'run.finished', status, error });
    const vault = this.opts.vault;
    if (!vault) return;
    try {
      const s = this.state(runId);
      const files: Record<string, string[]> = {};
      for (const [id, ns] of Object.entries(s.nodes)) {
        if (ns.commit) files[id] = await commitFiles(s.workdir, ns.commit);
      }
      const written = await vault.recordRun(s, files);
      for (const p of written.slice(0, 60)) this.store.append(runId, { type: 'vault.note', path: p });
    } catch {
      /* a vault problem must never fail a run */
    }
  }

  // ------------------------------------------------------------------

  private async runNode(runId: string, node: PipelineNode, signal: AbortSignal): Promise<NodeOutcome> {
    try {
      if (node.kind === 'gate') return await this.runCheck(runId, node, signal);
      if (node.verdict) return await this.runCheck(runId, node, signal);
      const r = await this.runAgentOnce(runId, node, signal);
      return { ok: r.ok, aborted: r.aborted };
    } catch (err) {
      // an engine fault inside a node is that node's failure, not the run's crash
      const attempt = this.state(runId).nodes[node.id]?.attempts ?? 0;
      this.store.append(runId, {
        type: 'node.finished',
        node: node.id,
        status: 'error',
        output: '',
        error: `engine error: ${(err as Error).message}`,
        durationMs: 0,
        attempt,
      });
      return { ok: false };
    }
  }

  /** Gate or verdict node, with the fix loop: failure output goes back to `fixNode`. */
  private async runCheck(runId: string, node: PipelineNode, signal: AbortSignal): Promise<NodeOutcome> {
    const isGate = node.kind === 'gate';
    const max = node.maxLoops ?? 2;
    const t0 = Date.now();
    if (isGate) {
      const attempt = this.state(runId).nodes[node.id]!.attempts + 1;
      this.store.append(runId, { type: 'node.started', node: node.id, attempt });
    }
    const finishGate = (ok: boolean, output: string, error?: string) => {
      const attempt = this.state(runId).nodes[node.id]!.attempts;
      this.store.append(runId, {
        type: 'node.finished',
        node: node.id,
        status: ok ? 'done' : 'error',
        output: tail(output, MAX_OUTPUT),
        error,
        durationMs: Date.now() - t0,
        attempt,
      });
    };

    for (;;) {
      let ok: boolean;
      let failureText: string;
      if (isGate) {
        const g0 = Date.now();
        const r = await runProcess({
          cmd: '/bin/sh',
          args: ['-c', node.command!],
          cwd: this.state(runId).workdir,
          signal: AbortSignal.any([signal, AbortSignal.timeout(this.state(runId).pipeline.settings.nodeTimeoutMs)]),
          env: { ...process.env, CI: '1' },
        });
        if (signal.aborted) return { ok: false, aborted: true };
        const out = tail(`${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`.trim(), 20_000);
        ok = r.code === 0 && !r.spawnError;
        this.store.append(runId, { type: 'gate.result', node: node.id, ok, exitCode: r.code, output: out, durationMs: Date.now() - g0 });
        failureText = out || r.spawnError || `exit ${r.code}`;
      } else {
        const r = await this.runAgentOnce(runId, node, signal);
        if (r.aborted) return { ok: false, aborted: true };
        ok = r.ok;
        failureText = r.output || r.error || 'verdict: FAIL';
      }
      if (ok) {
        if (isGate) finishGate(true, this.state(runId).nodes[node.id]?.gate?.output ?? '');
        return { ok: true };
      }

      const loops = this.state(runId).nodes[node.id]!.loops;
      if (!node.fixNode || loops >= max) {
        if (isGate) finishGate(false, failureText, loops ? `gate still failing after ${loops} fix loop(s)` : 'gate failed');
        return { ok: false };
      }
      this.store.append(runId, { type: 'loop', check: node.id, fixNode: node.fixNode, n: loops + 1 });
      const fixNode = this.state(runId).pipeline.nodes.find((n) => n.id === node.fixNode)!;
      const fix = await this.runAgentOnce(runId, fixNode, signal, { check: node.title ?? node.role ?? node.id, output: failureText });
      if (fix.aborted) return { ok: false, aborted: true };
      if (!fix.ok) {
        if (isGate) finishGate(false, failureText, `fix node "${fixNode.id}" failed`);
        else this.store.append(runId, { type: 'node.finished', node: node.id, status: 'error', output: failureText, error: `fix node "${fixNode.id}" failed`, durationMs: 0, attempt: this.state(runId).nodes[node.id]!.attempts });
        return { ok: false };
      }
    }
  }

  /** Put one question to a finished step, read-only, and log it. Always yields an answer (even "no such step"). */
  private async consultStep(runId: string, asker: PipelineNode, ask: Ask, round: number, sig: AbortSignal): Promise<{ to: string; answer: string; cost: number }> {
    const st = this.state(runId);
    const target = resolveTarget(st, asker, ask.target);
    const done = (to: string, answer: string, cost = 0) => {
      this.store.append(runId, { type: 'consult', from: asker.id, to, question: ask.question, answer: answer.slice(0, 8000), round, costUsd: cost || undefined });
      return { to, answer, cost };
    };
    if (!target) {
      const names = askable(st, asker).map((n) => n.id).join(', ') || 'none yet';
      return done(ask.target, `There is no finished step called "${ask.target}". Steps that can be asked: ${names}.`);
    }
    const remaining = st.pipeline.settings.maxCostUsd !== undefined ? st.pipeline.settings.maxCostUsd - st.costUsd : undefined;
    if (remaining !== undefined && remaining <= 0) return done(target.id, 'The run is out of budget, so this question was not asked. Proceed on your best assumption.');
    const adapter = this.opts.registry.get(target.agent ?? 'claude');
    const tns = st.nodes[target.id]!;
    const resumed = adapter.supportsResume && !!tns.sessionId;
    const dirtyBefore = new Set(await statusEntries(st.workdir));
    let res: AgentResult;
    try {
      res = await adapter.run({
        runId,
        nodeId: `${target.id}.consult`,
        prompt: consultPrompt(st, asker, target, ask.question, resumed),
        cwd: st.workdir,
        model: target.model,
        readOnly: true,
        permissionMode: target.permissionMode,
        attempt: 1,
        timeoutMs: Math.min(st.pipeline.settings.nodeTimeoutMs, 300_000),
        budgetUsd: remaining,
        resumeSessionId: resumed ? tns.sessionId : undefined,
        signal: sig,
        mock: target.mock ? { output: `(${target.id}) answer to: ${ask.question.slice(0, 80)}`, costUsd: target.mock.costUsd ?? 0, delayMs: 50 } : undefined,
        onChunk: () => undefined,
        onSession: () => undefined,
      });
    } catch (err) {
      res = { output: '', exitCode: 1, error: (err as Error).message };
    }
    try {
      const touched = (await statusEntries(st.workdir)).filter((l) => !dirtyBefore.has(l));
      if (touched.length) await revertEntries(st.workdir, touched);
    } catch {
      /* best effort: a consult must not break the run */
    }
    const answer = res.exitCode === 0 && res.output.trim() ? res.output.trim() : `${target.id} could not answer (${res.error ?? 'no output'}). Proceed on your best assumption.`;
    return done(target.id, answer, res.costUsd ?? 0);
  }

  private async runAgentOnce(
    runId: string,
    node: PipelineNode,
    runSignal: AbortSignal,
    failure?: { check: string; output: string },
  ): Promise<{ ok: boolean; aborted?: boolean; output: string; error?: string }> {
    const state = this.state(runId);
    const ns = state.nodes[node.id]!;
    const attempt = ns.attempts + 1;
    const adapter = this.opts.registry.get(node.agent ?? 'claude');
    const abandoned = ns.output === undefined && !!ns.sessionId;

    this.store.append(runId, { type: 'node.started', node: node.id, attempt });

    let vaultContext: string | undefined;
    if (this.opts.vault && node.vault !== false) {
      try {
        vaultContext = await this.opts.vault.contextFor(`${state.task} ${node.role ?? ''} ${node.title ?? ''}`, {
          exclude: new Set(state.notes.concat(Vault.runNotePath(state))),
        });
      } catch {
        /* context is best-effort */
      }
    }
    const diff = node.includeDiff ? await diffAgainst(state.workdir, state.baseSha, state.setupArtifacts) : undefined;
    // What was already dirty when this node began (setup output, a gate's artifacts): not this node's doing.
    const dirtyBefore = new Set(await statusEntries(state.workdir));
    const prompt = buildPrompt({ pipeline: state.pipeline, node, state: this.state(runId), vaultContext, diff, failure, resumed: abandoned });

    let buf = '';
    let timer: NodeJS.Timeout | undefined;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (buf) this.store.append(runId, { type: 'node.chunk', node: node.id, text: buf });
      buf = '';
    };
    const onChunk = (t: string) => {
      buf += t;
      if (buf.length > 2000) flush();
      else timer ??= setTimeout(flush, 400);
    };

    const timeoutMs = state.pipeline.settings.nodeTimeoutMs;
    const sig = AbortSignal.any([runSignal, AbortSignal.timeout(timeoutMs)]);
    const budgetUsd =
      state.pipeline.settings.maxCostUsd !== undefined ? Math.max(0, state.pipeline.settings.maxCostUsd - state.costUsd) : undefined;
    const t0 = Date.now();

    const call = async (resumeSessionId?: string, promptText: string = prompt): Promise<AgentResult> => {
      try {
        return await adapter.run({
          runId,
          nodeId: node.id,
          prompt: promptText,
          cwd: state.workdir,
          model: node.model,
          readOnly: !!node.readOnly,
          permissionMode: node.permissionMode,
          attempt,
          timeoutMs,
          budgetUsd,
          resumeSessionId,
          signal: sig,
          mock: node.mock,
          verdictNode: node.verdict,
          onChunk,
          onSession: (id) => this.store.append(runId, { type: 'node.session', node: node.id, sessionId: id }),
        });
      } catch (err) {
        return { output: '', exitCode: 1, error: (err as Error).message };
      }
    };

    const resumeId = adapter.supportsResume ? ns.sessionId : undefined;
    let res = await call(resumeId);
    // A vendor session can expire; fall back to a fresh one rather than failing the node.
    if (resumeId && res.exitCode !== 0 && !res.output && !sig.aborted) res = await call(undefined);
    flush();

    // Bots asking bots: a question at the end of the answer goes to a finished step; the answer comes back and this step finishes.
    let extraCost = 0;
    const rounds = node.kind === 'agent' ? state.pipeline.settings.consult ?? 0 : 0;
    for (let round = 1; round <= rounds && res.exitCode === 0 && !sig.aborted && !runSignal.aborted; round++) {
      const asks = parseAsks(res.output).slice(0, 2);
      if (!asks.length) break;
      const answered: { to: string; question: string; answer: string }[] = [];
      for (const a of asks) {
        const r = await this.consultStep(runId, node, a, round, sig);
        extraCost += r.cost;
        answered.push({ to: r.to, question: a.question, answer: r.answer });
      }
      const live = this.state(runId).nodes[node.id]!;
      const canResume = adapter.supportsResume && !!live.sessionId;
      const follow = canResume ? answersBlock(answered) : `${prompt}\n\n# Your answer so far\n${stripAsks(res.output)}\n\n${answersBlock(answered)}`;
      const before = res;
      res = await call(canResume ? live.sessionId : undefined, follow);
      extraCost += before.costUsd ?? 0;
      flush();
    }
    if (rounds) res = { ...res, output: stripAsks(res.output), costUsd: res.costUsd !== undefined || extraCost ? (res.costUsd ?? 0) + extraCost : undefined };

    if (runSignal.aborted) return { ok: false, aborted: true, output: res.output };
    const timedOut = sig.aborted;

    let commit: string | undefined;
    let error = res.error;
    let status: 'done' | 'error' = res.exitCode === 0 && !timedOut ? 'done' : 'error';
    if (timedOut) error = `timed out after ${Math.round(timeoutMs / 1000)}s`;

    try {
      if (node.readOnly) {
        const touched = (await statusEntries(state.workdir)).filter((l) => !dirtyBefore.has(l));
        if (touched.length) {
          await revertEntries(state.workdir, touched);
          status = 'error';
          error = `read-only node modified files (${entryPaths(touched).slice(0, 3).join(', ')}); changes were reverted`;
        }
      } else {
        commit = await commitAll(state.workdir, `aorch: ${node.id} (${node.role ?? 'agent'}) attempt ${attempt}`, state.setupArtifacts);
      }
    } catch (err) {
      status = 'error';
      error = `git: ${(err as Error).message}`;
    }

    let verdict: 'PASS' | 'FAIL' | undefined;
    if (node.verdict && status === 'done') {
      const all = [...res.output.matchAll(/VERDICT:\s*(PASS|FAIL)/gi)];
      const last = all[all.length - 1]?.[1]?.toUpperCase();
      verdict = last === 'PASS' ? 'PASS' : 'FAIL';
      if (!last) error = 'no "VERDICT: PASS|FAIL" line in the reviewer output';
    }

    this.store.append(runId, {
      type: 'node.finished',
      node: node.id,
      status,
      output: tail(res.output, MAX_OUTPUT),
      error,
      costUsd: res.costUsd,
      durationMs: Date.now() - t0,
      commit,
      sessionId: res.sessionId,
      verdict,
      attempt,
    });
    return { ok: status === 'done' && verdict !== 'FAIL', output: res.output, error };
  }
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<unknown>): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < items.length) await fn(items[i++]!);
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
}
