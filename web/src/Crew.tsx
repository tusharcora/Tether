import { For, Show, createSignal, onMount } from 'solid-js';
import { api } from './api';
import { CREW, Pebble } from './bots';

interface AgentInfo { ok: boolean; version?: string; detail?: string; models: string[] }
interface Row { role: string; name: string; title: string; binding: { agent: string; model?: string } | null }

export function Crew() {
  const [rows, setRows] = createSignal<Row[]>([]);
  const [agents, setAgents] = createSignal<Record<string, AgentInfo>>({});
  const [draft, setDraft] = createSignal<Record<string, { agent: string; model: string }>>({});
  const [msg, setMsg] = createSignal('');
  const [loading, setLoading] = createSignal(true);

  async function load() {
    try {
      const r = await api<{ crew: Row[]; agents: Record<string, AgentInfo> }>('GET', '/api/bots');
      setRows(r.crew);
      setAgents(r.agents);
      setDraft(Object.fromEntries(r.crew.map((c) => [c.role, { agent: c.binding?.agent ?? '', model: c.binding?.model ?? '' }])));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  onMount(load);

  const set = (role: string, patch: Partial<{ agent: string; model: string }>) => setDraft({ ...draft(), [role]: { ...draft()[role]!, ...patch } });
  const dirty = (r: Row) => {
    const d = draft()[r.role];
    return !!d && (d.agent !== (r.binding?.agent ?? '') || d.model !== (r.binding?.model ?? ''));
  };

  async function save(r: Row) {
    const d = draft()[r.role]!;
    try {
      if (!d.agent) await api('DELETE', `/api/bots/${r.role}`);
      else await api('PUT', `/api/bots/${r.role}`, { agent: d.agent, model: d.model });
      setMsg(d.agent ? `${r.name} → ${d.agent}${d.model ? ' · ' + d.model : ''}` : `${r.name} unlinked`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div class="crew-page">
      <div class="crew-head">
        <h2>Crew</h2>
        <p class="muted">
          Link each bot to an agent and model. A step with no agent of its own follows its bot; a step that names one keeps it.
          Changes apply to the next run you start.
        </p>
        <Show when={msg()}><span class="chip">{msg()}</span></Show>
      </div>
      <Show when={!loading()} fallback={<p class="muted">Checking which agents are installed…</p>}>
        <div class="crew-grid">
          <For each={rows()}>
            {(r) => (
              <div class="crew-card">
                <Pebble role={r.role} size={48} />
                <div class="crew-main">
                  <h4>{r.name} <span class="muted">{r.title}</span></h4>
                  <Show
                    when={r.role !== 'approval'}
                    fallback={<p class="muted">A person signs off here. Nothing to link.</p>}
                  >
                    <label>
                      Agent
                      <select value={draft()[r.role]?.agent ?? ''} onChange={(e) => set(r.role, { agent: e.currentTarget.value, model: '' })}>
                        <option value="">default (claude)</option>
                        <For each={Object.keys(agents())}>
                          {(a) => <option value={a}>{a}{agents()[a]!.ok ? '' : ' (not available)'}</option>}
                        </For>
                      </select>
                    </label>
                    <label>
                      Model
                      <input
                        list={`models-${r.role}`}
                        value={draft()[r.role]?.model ?? ''}
                        placeholder="adapter default"
                        spellcheck={false}
                        onInput={(e) => set(r.role, { model: e.currentTarget.value })}
                      />
                      <datalist id={`models-${r.role}`}>
                        <For each={agents()[draft()[r.role]?.agent ?? '']?.models ?? []}>{(m) => <option value={m} />}</For>
                      </datalist>
                    </label>
                    <div class="row">
                      <button class="primary" disabled={!dirty(r)} onClick={() => void save(r)}>Save</button>
                      <Show when={r.binding}>
                        <button onClick={() => { set(r.role, { agent: '', model: '' }); void save({ ...r }); }}>Unlink</button>
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
        <p class="muted small">Local models (Ollama, LM Studio, llama.cpp) appear here when their server is running.</p>
      </Show>
    </div>
  );
}
