import { For, Show, createSignal, onMount } from 'solid-js';
import { api } from './api';

/** Shapes from src/evolveops.ts (views are plain data; every string here is rendered as text, never as HTML). */
interface LessonRef { id: string; text?: string; polarity?: string; runs?: number; provenance?: string; status?: string }
interface EditView { n: number; field: string; op: string; before?: string; after?: string; roleNote?: true; lessons: LessonRef[]; probe?: 'kept' | 'dropped' | 'unprobed'; probeNote?: string }
interface ProposalView {
  id: string;
  bot: string;
  base: number;
  status: 'open' | 'accepted' | 'rejected';
  label: 'open' | 'accepted' | 'rejected' | 'superseded';
  note?: string;
  createdAt: string;
  picked?: number[];
  version?: number;
  costUsd?: number;
  stale: boolean;
  edits: EditView[];
  probe?: { spentUsd: number; budgetUsd: number; stoppedBy?: string; results: { task: string; edit?: number; verdict: string; baseline: string; candidate: string }[] };
  composed?: { kept: number[]; dropped: number[]; unprobed: number[] };
}
interface LessonView { id: string; text: string; polarity: string; provenance: string; status: string; runs: number; evidence: { run: string; node: string; signal: string }[] }
interface HarnessView { bot: string; evolvable: boolean; current: { version: number; persona: string; guidance: string[]; skills: string[]; note?: string }; versions: { version: number; at: string; note?: string; base?: number }[]; total: number }

const LABEL_TONE: Record<string, string> = { open: 's-running', accepted: 's-done', rejected: 's-error', superseded: 's-stopped' };

/** Harness, proposals and lessons of one bot. Review only: proposals are made with `aorch evolve <bot>` (a model call), never from here. */
export function EvolvePanel(props: { bot: string; name: string; onClose: () => void; onChange?: () => void }) {
  const [harness, setHarness] = createSignal<HarnessView | undefined>();
  const [proposals, setProposals] = createSignal<ProposalView[]>([]);
  const [lessons, setLessons] = createSignal<LessonView[]>([]);
  const [picks, setPicks] = createSignal<Record<string, number[]>>({});
  const [confirm, setConfirm] = createSignal('');
  const [msg, setMsg] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  async function load() {
    try {
      const [h, p, l] = await Promise.all([
        api<HarnessView>('GET', `/api/harness/${encodeURIComponent(props.bot)}`),
        api<{ proposals: ProposalView[] }>('GET', `/api/proposals?bot=${encodeURIComponent(props.bot)}`),
        api<{ lessons: LessonView[] }>('GET', `/api/lessons?bot=${encodeURIComponent(props.bot)}`),
      ]);
      setHarness(h);
      setProposals(p.proposals);
      setLessons(l.lessons);
      // start each open proposal with every edit picked (the person unticks what they do not want), except when the probe dropped some: then nothing is picked for them
      const next: Record<string, number[]> = {};
      for (const x of p.proposals) if (x.status === 'open') next[x.id] = picks()[x.id] ?? (x.composed?.dropped.length ? [] : x.edits.map((e) => e.n));
      setPicks(next);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  onMount(load);

  const toggle = (id: string, n: number) => {
    const cur = picks()[id] ?? [];
    setPicks({ ...picks(), [id]: cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((a, b) => a - b) });
  };
  async function run(what: () => Promise<string>) {
    setBusy(true);
    setConfirm('');
    try {
      setMsg(await what());
      await load();
      props.onChange?.();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const accept = (p: ProposalView) =>
    run(async () => {
      const r = await api<{ harness: { version: number } }>('POST', `/api/proposals/${encodeURIComponent(p.id)}/accept`, { pick: picks()[p.id] ?? [] });
      return `${props.name}'s harness is now v${r.harness.version}; the next run uses it`;
    });
  const reject = (p: ProposalView) =>
    run(async () => {
      await api('POST', `/api/proposals/${encodeURIComponent(p.id)}/reject`, {});
      return `rejected ${p.id}: its edits will not be proposed again`;
    });
  const rollback = (v: number) =>
    run(async () => {
      const r = await api<{ harness: { version: number } }>('POST', `/api/harness/${encodeURIComponent(props.bot)}/rollback`, { version: v });
      return `rolled back: v${r.harness.version} is a copy of v${v}`;
    });

  return (
    <div class="evolve-panel" role="region" aria-label={`Evolve ${props.name}`}>
      <div class="row">
        <h3>Evolve · {props.name}</h3>
        <button onClick={() => props.onClose()}>Close</button>
        <Show when={msg()}><span class="chip">{msg()}</span></Show>
      </div>
      <p class="muted small">
        Proposals are made from the command line with <code>aorch evolve {props.bot}</code> (one model call). Here you review them: tick the edits you want, accept or reject.
        Nothing changes until you accept, and any version can be rolled back.
      </p>

      <Show when={harness()}>
        {(h) => (
          <section>
            <h4>Harness v{h().current.version} <Show when={!h().evolvable}><span class="muted small">(not evolvable)</span></Show></h4>
            <p class="muted small persona">{h().current.persona}</p>
            <Show when={h().current.guidance.length} fallback={<p class="muted small">No guidance notes yet.</p>}>
              <ul class="small">
                <For each={h().current.guidance}>{(g) => <li>{g}</li>}</For>
              </ul>
            </Show>
            <details>
              <summary class="small">Versions ({h().total})</summary>
              <ul class="small versions">
                <For each={[...h().versions].reverse()}>
                  {(v) => (
                    <li>
                      <b>v{v.version}</b> <span class="muted">{v.at.slice(0, 16).replace('T', ' ')}{v.note ? ` · ${v.note}` : ''}</span>{' '}
                      <Show when={v.version !== h().current.version}>
                        <Show when={confirm() === `rb:${v.version}`} fallback={<button disabled={busy()} onClick={() => setConfirm(`rb:${v.version}`)}>Roll back to v{v.version}</button>}>
                          <span class="small">Make a new version that copies v{v.version}? </span>
                          <button class="primary" disabled={busy()} onClick={() => void rollback(v.version)}>Roll back</button>
                          <button onClick={() => setConfirm('')}>Cancel</button>
                        </Show>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </details>
          </section>
        )}
      </Show>

      <section>
        <h4>Proposals</h4>
        <Show when={proposals().length} fallback={<p class="muted small">No proposals yet.</p>}>
          <For each={proposals()}>
            {(p) => (
              <div class="proposal">
                <div class="row">
                  <b><code>{p.id}</code></b>
                  <span class={`badge ${LABEL_TONE[p.label] ?? ''}`}>{p.label}</span>
                  <Show when={p.stale}><span class="badge s-paused" title="Written for an older version">stale</span></Show>
                  <span class="muted small">based on v{p.base}{p.version !== undefined ? ` · made v${p.version}` : ''}{p.costUsd !== undefined ? ` · editor $${p.costUsd.toFixed(4)}` : ''}</span>
                </div>
                <Show when={p.note}><p class="muted small">{p.note}</p></Show>
                <Show when={p.stale}><p class="muted small">The harness moved on since this was written, so it cannot be accepted. Run <code>aorch evolve {p.bot}</code> again.</p></Show>
                <For each={p.edits}>
                  {(e) => (
                    <div class="edit">
                      <label class="check">
                        <Show when={p.status === 'open'} fallback={<span>{p.picked?.includes(e.n) ? '✔' : ''}</span>}>
                          <input type="checkbox" checked={(picks()[p.id] ?? []).includes(e.n)} disabled={p.stale} onChange={() => toggle(p.id, e.n)} />
                        </Show>
                        <b>{e.n}.</b> {e.roleNote ? 'role note' : `${e.field} ${e.op}`}
                        <Show when={e.roleNote}>
                          <span class="muted small"> added to the bot's role prompt; {e.before !== undefined ? 'replaces the earlier role note' : 'nothing is removed'}</span>
                        </Show>
                        <Show when={e.probe}>
                          <span class={`chip probe-${e.probe}`}>{e.probe === 'dropped' ? 'dropped by the probe' : e.probe === 'unprobed' ? `not probed${e.probeNote ? `: ${e.probeNote}` : ''}` : 'kept by the probe'}</span>
                        </Show>
                      </label>
                      <pre class="diff small"><Show when={e.before !== undefined}><span class="del">- {e.before}{'\n'}</span></Show><Show when={e.after !== undefined}><span class="add">+ {e.after}</span></Show></pre>
                      <For each={e.lessons}>
                        {(l) => <p class="muted small">because <code>{l.id}</code>{l.text !== undefined ? ` (${l.polarity}, ${l.runs} runs, ${l.provenance}): ${l.text}` : ' (lesson no longer stored)'}</p>}
                      </For>
                    </div>
                  )}
                </For>
                <Show when={p.probe}>
                  {(pr) => (
                    <div class="small">
                      <b>Probe</b> <span class="muted">spent ${pr().spentUsd.toFixed(4)} of ${pr().budgetUsd.toFixed(2)}{pr().stoppedBy ? ` · stopped by ${pr().stoppedBy}` : ''}</span>
                      <ul>
                        <For each={pr().results.slice(0, 10)}>{(r) => <li><b>{r.verdict}</b> edit {r.edit ?? 'all'} on "{r.task.slice(0, 60)}" <span class="muted">baseline: {r.baseline}; candidate: {r.candidate}</span></li>}</For>
                      </ul>
                    </div>
                  )}
                </Show>
                <Show when={p.status === 'open' && !p.stale}>
                  <div class="row">
                    <button class="primary" disabled={busy() || !(picks()[p.id] ?? []).length} onClick={() => void accept(p)}>
                      Accept {(picks()[p.id] ?? []).length === p.edits.length ? 'all' : `${(picks()[p.id] ?? []).length} of ${p.edits.length}`}
                    </button>
                    <Show when={p.composed}>
                      {(c) => <button disabled={busy() || !c().kept.length} onClick={() => setPicks({ ...picks(), [p.id]: [...c().kept] })}>Pick the kept edits</button>}
                    </Show>
                    <Show when={confirm() === `rj:${p.id}`} fallback={<button class="danger" disabled={busy()} onClick={() => setConfirm(`rj:${p.id}`)}>Reject</button>}>
                      <span class="small">Reject all {p.edits.length} edits? They will not be proposed again. </span>
                      <button class="danger" disabled={busy()} onClick={() => void reject(p)}>Reject</button>
                      <button onClick={() => setConfirm('')}>Cancel</button>
                    </Show>
                  </div>
                </Show>
                <Show when={p.status === 'open' && p.stale}>
                  <div class="row">
                    <Show when={confirm() === `rj:${p.id}`} fallback={<button class="danger" disabled={busy()} onClick={() => setConfirm(`rj:${p.id}`)}>Reject</button>}>
                      <button class="danger" disabled={busy()} onClick={() => void reject(p)}>Reject</button>
                      <button onClick={() => setConfirm('')}>Cancel</button>
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </section>

      <section>
        <h4>Lessons</h4>
        <p class="muted small">A lesson is tentative until at least 3 different runs support it without conflicting evidence; only confident lessons are proposed.</p>
        <Show when={lessons().length} fallback={<p class="muted small">No lessons yet: they come from runs with rework, handoff problems or your thumbs up / down.</p>}>
          <ul class="small">
            <For each={lessons()}>
              {(l) => (
                <li>
                  <span class={`badge ${l.status === 'confident' ? 's-done' : 's-queued'}`}>{l.status}</span> {l.text}{' '}
                  <span class="muted">{l.polarity} · {l.runs} run{l.runs === 1 ? '' : 's'} · from {l.provenance} · <code>{l.id}</code></span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  );
}
