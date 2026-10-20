import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';
import { ago, api, describeEvent, fmtDur, fmtUsd, type RunRow, type RunView, type StoredEvent } from './api';
import { Canvas } from './Canvas';

function Diff(props: { text: string }) {
  const lines = () => props.text.split('\n').slice(0, 3000);
  const cls = (l: string) =>
    l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') ? 'dh' : l.startsWith('@@') ? 'dk' : l.startsWith('+') ? 'da' : l.startsWith('-') ? 'dd' : '';
  return (
    <pre class="diff">
      <For each={lines()}>{(l) => <span class={cls(l)}>{l + '\n'}</span>}</For>
      <Show when={props.text.split('\n').length > 3000}>
        <span class="dk">… diff truncated in the viewer; use git to see all of it …</span>
      </Show>
    </pre>
  );
}

export function Runs(props: { selected?: string; onSelect: (id: string) => void }) {
  const [runs, setRuns] = createSignal<RunRow[]>([]);
  const [run, setRun] = createSignal<RunView | undefined>();
  const [events, setEvents] = createSignal<StoredEvent[]>([]);
  const [selNode, setSelNode] = createSignal<string | undefined>();
  const [diff, setDiff] = createSignal<string | undefined>();
  const [pane, setPane] = createSignal<'node' | 'timeline' | 'branch'>('node');
  const [err, setErr] = createSignal<string | undefined>();

  async function refreshList() {
    try {
      setRuns(await api('GET', '/api/runs'));
    } catch {
      /* server briefly unavailable */
    }
  }
  onMount(() => {
    void refreshList();
    const t = setInterval(refreshList, 2000);
    onCleanup(() => clearInterval(t));
  });

  // follow the selected run: snapshot + live stream
  createEffect(
    on(
      () => props.selected,
      (id) => {
        setRun(undefined);
        setEvents([]);
        setSelNode(undefined);
        setDiff(undefined);
        setErr(undefined);
        if (!id) return;
        let closed = false;
        api<StoredEvent[]>('GET', `/api/runs/${id}/events`).then((e) => !closed && setEvents((cur) => (cur.length ? cur : e))).catch((e) => setErr((e as Error).message));
        const es = new EventSource(`/api/runs/${id}/stream`);
        es.addEventListener('state', (m) => setRun(JSON.parse((m as MessageEvent).data)));
        es.addEventListener('event', (m) => {
          const se = JSON.parse((m as MessageEvent).data) as StoredEvent;
          if (se.event.type === 'node.chunk') return;
          setEvents((cur) => (cur.some((x) => x.seq === se.seq) ? cur : [...cur, se]));
        });
        onCleanup(() => {
          closed = true;
          es.close();
        });
      },
    ),
  );

  // diff for the selected node's commit, or the whole branch
  createEffect(() => {
    const r = run();
    const id = props.selected;
    const n = selNode();
    const mode = pane();
    if (!r || !id) return;
    const commit = n ? r.nodes[n]?.commit : undefined;
    if (mode === 'branch') {
      api<{ diff: string }>('GET', `/api/runs/${id}/diff`).then((d) => setDiff(d.diff)).catch(() => setDiff(''));
    } else if (n && commit) {
      api<{ diff: string }>('GET', `/api/runs/${id}/diff?node=${encodeURIComponent(n)}`).then((d) => setDiff(d.diff)).catch(() => setDiff(''));
    } else setDiff(undefined);
  });

  const nameOf = (id: string) => {
    const n = run()?.pipeline.nodes.find((x) => x.id === id);
    return n ? `${n.title ?? n.role ?? n.kind} (${id})` : id;
  };
  const awaiting = () => (run() ? Object.entries(run()!.nodes).filter(([, n]) => n.status === 'awaiting').map(([id]) => id) : []);
  const node = () => (run() && selNode() ? run()!.nodes[selNode()!] : undefined);
  const pnode = () => run()?.pipeline.nodes.find((n) => n.id === selNode());

  async function act(path: string, body: unknown = {}) {
    try {
      setErr(undefined);
      setRun(await api('POST', `/api/runs/${props.selected}/${path}`, body));
      void refreshList();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div class="runs">
      <aside class="run-list">
        <h4>Runs</h4>
        <Show when={runs().length === 0}>
          <p class="muted small pad">No runs yet. Build a pipeline and press Run.</p>
        </Show>
        <For each={runs()}>
          {(r) => (
            <button class="run-item" classList={{ active: props.selected === r.id }} onClick={() => props.onSelect(r.id)}>
              <span class={`dot s-${r.status}`} classList={{ pulse: r.live && r.status === 'running' }} />
              <span class="run-main">
                <b>{r.pipeline}</b>
                <small>{r.task.split('\n')[0]!.slice(0, 60)}</small>
              </span>
              <span class="run-side">
                <small>{fmtUsd(r.costUsd)}</small>
                <small>{ago(r.startedAt)}</small>
              </span>
            </button>
          )}
        </For>
      </aside>

      <section class="run-detail">
        <Show when={run()} fallback={<div class="placeholder">{props.selected ? 'Loading run…' : 'Select a run to follow it live.'}</div>}>
          {(r) => (
            <>
              <header class="run-head">
                <div>
                  <h3>
                    {r().pipeline.name} <span class={`badge s-${r().status}`}>{r().status}</span>
                    <Show when={r().status === 'running' && !r().live}>
                      <span class="badge s-error" title="No process is driving this run. Resume it.">interrupted</span>
                    </Show>
                  </h3>
                  <p class="muted small">
                    {r().task.split('\n')[0]!.slice(0, 120)} · {fmtUsd(r().costUsd)}
                    {r().pipeline.settings.maxCostUsd ? ` of ${fmtUsd(r().pipeline.settings.maxCostUsd!)}` : ''} · <code>{r().branch}</code>
                    <Show when={r().notes.length}> · {r().notes.length} vault notes</Show>
                  </p>
                </div>
                <div class="row">
                  <Show when={r().live && r().status === 'running'}>
                    <button class="danger" onClick={() => act('stop')}>Stop</button>
                  </Show>
                  <Show when={!r().live && ['stopped', 'running', 'error'].includes(r().status)}>
                    <button class="primary" onClick={() => act('resume')}>{r().status === 'error' ? 'Retry failed' : 'Resume'}</button>
                  </Show>
                </div>
              </header>

              <Show when={err()}><div class="alert error">{err()}</div></Show>
              <Show when={r().error}><div class="alert error">{r().error}</div></Show>

              <For each={awaiting()}>
                {(id) => (
                  <div class="alert wait">
                    <div>
                      <b>Awaiting approval:</b> {nameOf(id)}
                      <span class="muted small"> — the run is paused and holds no process; approve to continue.</span>
                    </div>
                    <div class="row">
                      <button class="primary" onClick={() => act('approve', { node: id, approved: true })}>Approve</button>
                      <button class="danger" onClick={() => act('approve', { node: id, approved: false })}>Reject</button>
                    </div>
                  </div>
                )}
              </For>

              <Show when={r().coach?.length}>
                <div class="coach">
                  <b>Coach</b>
                  <For each={r().coach}>
                    {(f) => (
                      <div class="finding">
                        <b>{f.title}</b> <span class="muted">{f.detail}</span>
                        <div class="small">→ {f.action}</div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <div class="run-graph">
                <Canvas nodes={r().pipeline.nodes} edges={r().pipeline.edges} statuses={r().nodes} selected={selNode()} onSelect={(id) => (setSelNode(id), id && setPane('node'))} />
              </div>

              <div class="tabs sub">
                <button classList={{ active: pane() === 'node' }} onClick={() => setPane('node')}>Step</button>
                <button classList={{ active: pane() === 'branch' }} onClick={() => setPane('branch')}>Branch diff</button>
                <button classList={{ active: pane() === 'timeline' }} onClick={() => setPane('timeline')}>Timeline ({events().length})</button>
              </div>

              <div class="pane">
                <Show when={pane() === 'timeline'}>
                  <ol class="timeline">
                    <For each={events()}>
                      {(e) => {
                        const d = describeEvent(e.event, nameOf);
                        return (
                          <Show when={d}>
                            <li class={`t-${d!.tone}`}>
                              <time>{new Date(e.ts).toLocaleTimeString()}</time> {d!.text}
                            </li>
                          </Show>
                        );
                      }}
                    </For>
                  </ol>
                </Show>

                <Show when={pane() === 'branch'}>
                  <Show when={diff()} fallback={<p class="muted pad">No committed changes on this branch yet.</p>}>
                    <Diff text={diff()!} />
                  </Show>
                </Show>

                <Show when={pane() === 'node'}>
                  <Show when={node()} fallback={<p class="muted pad">Click a step in the graph to see its output, diff and gate results.</p>}>
                    {(n) => (
                      <div class="node-detail">
                        <h4>
                          {nameOf(selNode()!)} <span class={`badge s-${n().status}`}>{n().status}</span>
                        </h4>
                        <p class="muted small">
                          {n().attempts} attempt{n().attempts === 1 ? '' : 's'}
                          {n().loops ? ` · ${n().loops} fix loop${n().loops === 1 ? '' : 's'}` : ''}
                          {n().costUsd ? ` · ${fmtUsd(n().costUsd)}` : ''}
                          {n().startedAt && n().finishedAt ? ` · ${fmtDur(n().finishedAt! - n().startedAt!)}` : ''}
                          {n().verdict ? ` · VERDICT ${n().verdict}` : ''}
                          {n().commit ? ' · commit ' : ''}
                          <Show when={n().commit}><code>{n().commit!.slice(0, 7)}</code></Show>
                        </p>
                        <Show when={n().error}><div class="alert error">{n().error}</div></Show>
                        <Show when={n().live}>
                          <h5>Live output</h5>
                          <pre class="out live">{n().live}</pre>
                        </Show>
                        <Show when={pnode()?.kind === 'gate' && n().gate}>
                          <h5>Gate · {pnode()!.command} · {n().gate!.ok ? 'passed' : `failed (exit ${n().gate!.exitCode})`}</h5>
                          <pre class="out">{n().gate!.output || '(no output)'}</pre>
                        </Show>
                        <Show when={n().output && pnode()?.kind === 'agent'}>
                          <h5>Output</h5>
                          <pre class="out">{n().output}</pre>
                        </Show>
                        <Show when={diff()}>
                          <h5>Changes this step committed</h5>
                          <Diff text={diff()!} />
                        </Show>
                        <Show when={pnode()?.kind === 'agent' && !pnode()!.readOnly && n().status === 'done' && !n().commit}>
                          <p class="muted small">This step finished without changing any files.</p>
                        </Show>
                      </div>
                    )}
                  </Show>
                </Show>
              </div>
            </>
          )}
        </Show>
      </section>
    </div>
  );
}
