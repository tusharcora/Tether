import { For, Show, createEffect, createSignal, on } from 'solid-js';
import { fmtUsd, type Answer, type Question, type RunView, type TeamMode } from './api';

/** One pick per card: an option id, or the person's own words. */
type Pick = { option?: string; text?: string };

const MODES: { id: TeamMode; label: string; hint: string }[] = [
  { id: 'live', label: 'Live', hint: 'Maestro reports as the team works and asks you questions' },
  { id: 'autonomous', label: 'Autonomous', hint: 'Maestro answers for you and reports at the end' },
];

export function ModeToggle(props: { mode: TeamMode; onPick: (m: TeamMode) => void; disabled?: boolean }) {
  return (
    <div class="seg" role="group" aria-label="Team mode">
      <For each={MODES}>
        {(m) => (
          <button type="button" classList={{ active: props.mode === m.id }} title={m.hint} disabled={props.disabled} aria-pressed={props.mode === m.id} onClick={() => props.mode !== m.id && props.onPick(m.id)}>
            {m.label}
          </button>
        )}
      </For>
    </div>
  );
}

function Card(props: { q: Question; index: number; total: number; pick: Pick | undefined; onPick: (p: Pick | undefined) => void; asker?: string }) {
  return (
    <div class="qcard">
      <div class="qhead">
        <b>{props.q.ask}</b>
        <Show when={props.total > 1}>
          <span class="muted small"> {props.index + 1} of {props.total}</span>
        </Show>
      </div>
      <Show when={props.asker}><p class="muted small">asked by {props.asker}</p></Show>
      <Show when={props.q.why}><p class="muted small">{props.q.why}</p></Show>
      <div class="qopts" role="radiogroup" aria-label={props.q.ask}>
        <For each={props.q.options}>
          {(o) => (
            <button type="button" role="radio" aria-checked={props.pick?.option === o.id} class="qopt" classList={{ chosen: props.pick?.option === o.id }} onClick={() => props.onPick({ option: o.id })}>
              <span class="qlabel">
                {o.label}
                <Show when={o.id === props.q.recommended}><span class="rec">recommended</span></Show>
              </span>
              <Show when={o.detail}><small class="muted">{o.detail}</small></Show>
            </button>
          )}
        </For>
      </div>
      <Show when={props.q.allowOther}>
        <label class="qother">
          <span class="muted small">Or in your own words</span>
          <textarea rows="2" maxLength={2000} value={props.pick?.text ?? ''} onInput={(e) => props.onPick(e.currentTarget.value ? { text: e.currentTarget.value } : undefined)} placeholder="Type your answer" />
        </label>
      </Show>
    </div>
  );
}

/**
 * Everything a team run needs from the person: the pending banner, the question cards, the finished plan and the
 * live/autonomous switch. `send` posts to the run (answers, plan, mode) and shows any error on the run page.
 */
export function TeamPanel(props: { run: RunView; send: (path: 'answers' | 'plan' | 'mode', body: unknown) => Promise<boolean> }) {
  const [picks, setPicks] = createSignal<Record<string, Pick>>({});
  const [busy, setBusy] = createSignal(false);
  const [rejecting, setRejecting] = createSignal(false);
  const r = () => props.run;
  const pending = () => (r().status === 'running' || r().status === 'paused' ? r().pending : []);
  const askerOf = (q: Question) => {
    const id = q.from;
    const n = id ? r().pipeline.nodes.find((x) => x.id === id) : undefined;
    return id ? (n?.title ?? n?.role ?? id) : undefined;
  };
  // picks belong to one run: another run may reuse the same question ids
  createEffect(on(() => r().id, () => (setPicks({}), setRejecting(false)), { defer: true }));
  const ready = () => pending().length > 0 && pending().every((q) => !!(picks()[q.id]?.option || picks()[q.id]?.text?.trim()));
  const planReady = () => r().status === 'running' && !r().planning && !!r().plan && r().pipeline.nodes.length === 0 && pending().length === 0;
  const active = () => r().status === 'running' || r().status === 'paused';

  const setPick = (id: string, p: Pick | undefined) =>
    setPicks((cur) => {
      const next = { ...cur };
      if (p) next[id] = p;
      else delete next[id];
      return next;
    });

  async function submit(list: { question: string; option?: string; text?: string }[]) {
    if (busy() || !list.length) return;
    setBusy(true);
    try {
      // planning cards go in one batch; a worker's question is answered on its own
      const asks = new Set((r().userAsks ?? []).map((a) => a.question.id));
      const plan = list.filter((a) => !asks.has(a.question));
      const sent: string[] = [];
      let ok = true;
      if (plan.length) {
        ok = await props.send('answers', { answers: plan });
        if (ok) sent.push(...plan.map((a) => a.question));
      }
      // stop at the first failure: what was sent is cleared, what was not stays for another try
      for (const a of list.filter((x) => asks.has(x.question))) {
        if (!ok) break;
        ok = await props.send('answers', { answers: [a] });
        if (ok) sent.push(a.question);
      }
      setPicks((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => !sent.includes(id))));
    } finally {
      setBusy(false);
    }
  }
  const mine = (): { question: string; option?: string; text?: string }[] => pending().map((q) => ({ question: q.id, ...picks()[q.id]! }));
  const recommendations = () => pending().map((q) => ({ question: q.id, option: q.recommended }));

  return (
    <>
      <Show when={active()}>
        <div class="team-bar">
          <span class="badge s-team">Team</span>
          <ModeToggle mode={r().mode} disabled={busy()} onPick={(m) => void props.send('mode', { mode: m })} />
          <span class="muted small">{MODES.find((m) => m.id === r().mode)!.hint}</span>
        </div>
      </Show>

      <Show when={pending().length > 0}>
        <div class="alert wait" role="status">
          <div>
            <b>{pending().length === 1 ? 'The team has a question for you.' : `The team has ${pending().length} questions for you.`}</b>
            <span class="muted small"> {r().planning ? 'Planning continues once you answer.' : 'The asking step is paused until you answer.'}</span>
          </div>
        </div>
        <section class="qpanel" aria-label="Questions from the team">
          <For each={pending()}>
            {(q, i) => <Card q={q} index={i()} total={pending().length} asker={askerOf(q)} pick={picks()[q.id]} onPick={(p) => setPick(q.id, p)} />}
          </For>
          <div class="row end">
            <button type="button" disabled={busy()} onClick={() => void submit(recommendations())} title="Answer every question with the option marked recommended">
              Use recommendations
            </button>
            <button type="button" class="primary" disabled={busy() || !ready()} onClick={() => void submit(mine())}>
              {busy() ? 'Sending…' : 'Send answers'}
            </button>
          </div>
        </section>
      </Show>

      <Show when={planReady()}>
        <section class="qpanel plan" aria-label="The team's plan">
          <h4>Plan ready for your approval</h4>
          <p>{r().plan!.goal}</p>
          <Show when={r().plan!.success.length}>
            <h5>Done when</h5>
            <ul>
              <For each={r().plan!.success}>{(s) => <li>{s}</li>}</For>
            </ul>
          </Show>
          <h5>Who does what</h5>
          <ul class="assign">
            <For each={r().plan!.assignments}>
              {(a) => (
                <li>
                  <b>{a.bot}</b> <span class="badge s-queued">{a.mode === 'write' ? 'can edit files' : 'read only'}</span> {a.goal}
                  <Show when={a.expected}><small class="muted"> — expects: {a.expected}</small></Show>
                </li>
              )}
            </For>
          </ul>
          <p class="muted small">
            Writes {r().plan!.limits.allowWrites ? 'allowed' : 'off'}
            {r().plan!.limits.maxCostUsd ? ` · budget ${fmtUsd(r().plan!.limits.maxCostUsd!)} in all` : ''}
            {r().plan!.limits.maxCostUsd && r().costUsd > 0 ? ` (planning spent ${fmtUsd(r().costUsd)}, ${fmtUsd(Math.max(0, r().plan!.limits.maxCostUsd! - r().costUsd))} left)` : ''}
            {r().plan!.limits.wallClockMs ? ` · ${Math.round(r().plan!.limits.wallClockMs! / 60_000)} min limit` : ''}
          </p>
          <div class="row end">
            <Show when={!rejecting()} fallback={
              <>
                <span class="muted small">Cancel this run?</span>
                <button type="button" onClick={() => setRejecting(false)}>Keep plan</button>
                <button type="button" class="danger" disabled={busy()} onClick={async () => { setBusy(true); try { await props.send('plan', { approved: false }); } finally { setBusy(false); setRejecting(false); } }}>Yes, reject</button>
              </>
            }>
              <button type="button" class="danger" onClick={() => setRejecting(true)}>Reject</button>
              <button type="button" class="primary" disabled={busy()} onClick={async () => { setBusy(true); try { await props.send('plan', { approved: true }); } finally { setBusy(false); } }}>Approve and start</button>
            </Show>
          </div>
        </section>
      </Show>

      <Show when={(r().cards?.length ?? 0) > 0 && r().answers.length > 0}>
        <details class="dialogue">
          <summary>Dialogue so far ({r().answers.length} answer{r().answers.length === 1 ? '' : 's'})</summary>
          <For each={r().answers}>
            {(a: Answer) => {
              const q = () => r().cards?.find((c) => c.id === a.question);
              return (
                <p class="small">
                  <b>{q()?.ask ?? a.question}</b>
                  <br />
                  {a.text ?? q()?.options.find((o) => o.id === a.option)?.label ?? a.option} <span class="muted">({a.by})</span>
                </p>
              );
            }}
          </For>
        </details>
      </Show>
    </>
  );
}
