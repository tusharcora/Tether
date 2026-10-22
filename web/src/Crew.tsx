import { For, Show, createSignal, onMount } from 'solid-js';
import { api } from './api';
import { EvolvePanel } from './Evolve';
import { MARK_STYLES, Mark, Pebble, Sprite, applyCrew, crewStyle, type BotDef, type Pixels } from './bots';

interface Pack { id: string; name: string; blurb: string; bots: BotDef[] }
interface Meta { parts: Record<string, string[]>; kinds: { kind: string; blurb: string }[]; packs: Pack[]; styles: { id: string; blurb: string }[] }
const PARTS = ['body', 'eyes', 'mouth', 'top', 'side', 'pattern'];
const SWATCH = ['#5b9dff', '#38c5d6', '#6ee7a8', '#f2c14e', '#ff8a5b', '#ff6b8a', '#b58bff', '#c9a46a'];
const blank = (): BotDef => ({ id: '', name: '', title: '', kind: 'agent', persona: '', look: { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: SWATCH[Math.floor(Math.random() * SWATCH.length)]!, accent: 'auto' } });
const slug = (n: string) => (n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 20) || 'bot');

interface AgentInfo { ok: boolean; version?: string; detail?: string; models: string[] }
interface Row { role: string; name: string; title: string; kind: string; binding: { agent: string; model?: string } | null }

export function Crew() {
  const [rows, setRows] = createSignal<Row[]>([]);
  const [agents, setAgents] = createSignal<Record<string, AgentInfo>>({});
  const [draft, setDraft] = createSignal<Record<string, { agent: string; model: string }>>({});
  const [msg, setMsg] = createSignal('');
  const [loading, setLoading] = createSignal(true);
  const [meta, setMeta] = createSignal<Meta>({ parts: {}, kinds: [], packs: [], styles: [] });
  const [defs, setDefs] = createSignal<BotDef[]>([]);
  const [edit, setEdit] = createSignal<BotDef | null>(null);
  const [isNew, setIsNew] = createSignal(false);
  const [preview, setPreview] = createSignal<Pixels | null>(null);
  const [evo, setEvo] = createSignal<Record<string, { version: number; open: number }>>({});
  const [evolving, setEvolving] = createSignal<Row | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const refreshPreview = (b: BotDef) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        setPreview(await api<Pixels>('POST', '/api/crew/preview', { look: b.look }));
      } catch {
        /* keep the last preview */
      }
    }, 120);
  };
  const patch = (p: Partial<BotDef>) => {
    const b = { ...edit()!, ...p };
    setEdit(b);
    refreshPreview(b);
  };
  const patchLook = (p: Partial<BotDef['look']>) => patch({ look: { ...edit()!.look, ...p } });
  const open = (b: BotDef, fresh = false) => {
    setEdit(JSON.parse(JSON.stringify(b)) as BotDef);
    setIsNew(fresh);
    setPreview(b.pixels ?? null);
    if (fresh) refreshPreview(b);
    setTimeout(() => document.querySelector('.bot-editor')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  async function loadDefs() {
    const r = await api<{ bots: BotDef[]; packs: Pack[]; parts: Record<string, string[]>; kinds: { kind: string; blurb: string }[]; style: string; styles: { id: string; blurb: string }[]; shapes: Record<string, string[]>; glyphs: Record<string, string[]>; evolve?: Record<string, { version: number; open: number }> }>('GET', '/api/crew');
    setEvo(r.evolve ?? {});
    applyCrew(r.bots, r);
    setDefs(r.bots);
    setMeta({ parts: r.parts, kinds: r.kinds, packs: r.packs, styles: r.styles });
  }
  async function pickStyle(id: string) {
    try {
      await api('PUT', '/api/crew/style', { style: id });
      await loadDefs();
      setMsg(`style: ${id}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  async function saveEdit() {
    const b = edit()!;
    const id = isNew() ? slug(b.name) : b.id;
    const taken = new Set(defs().map((d) => d.id));
    let use = id;
    if (isNew()) for (let i = 2; taken.has(use); i++) use = `${id.slice(0, 20)}${i}`;
    try {
      await api('PUT', `/api/crew/${use}`, { ...b, id: use });
      setEdit(null);
      setMsg(`${b.name} saved`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  async function removeDef(b: BotDef) {
    try {
      await api('DELETE', `/api/crew/${b.id}`);
      setEdit(null);
      setMsg(b.builtin ? `${b.name} reset to its original look` : `${b.name} removed`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  async function addPack(k: Pack) {
    try {
      const r = await api<{ added: string[] }>('POST', `/api/crew/packs/${k.id}`);
      setMsg(`${k.name}: added ${r.added.length} bots`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function load() {
    try {
      await loadDefs();
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
          Changes apply to the next run you start. Click a bot's look to edit it, or add your own.
        </p>
        <button class="primary" onClick={() => open(blank(), true)}>+ New bot</button>
        <Show when={msg()}><span class="chip">{msg()}</span></Show>
        <div class="style-pick" role="radiogroup" aria-label="Crew style">
          <For each={meta().styles}>
            {(s) => (
              <button role="radio" aria-checked={crewStyle() === s.id} classList={{ on: crewStyle() === s.id }} title={s.blurb} onClick={() => void pickStyle(s.id)}>
                {s.id}
              </button>
            )}
          </For>
        </div>
        <Show when={MARK_STYLES.includes(crewStyle())}>
          <p class="muted small">
            {meta().styles.find((s) => s.id === crewStyle())?.blurb}. The bot editor below still edits the pixel look, which the pebble style and the terminal's pebble style use.
          </p>
        </Show>
      </div>
      <Show when={!loading()} fallback={<p class="muted">Checking which agents are installed…</p>}>
        <div class="crew-grid">
          <For each={rows()}>
            {(r) => (
              <div class="crew-card">
                <button class="sprite-btn" title="Edit this bot" onClick={() => { const d = defs().find((x) => x.id === r.role); if (d) open(d); }}>
                  <Pebble role={r.role} size={48} />
                </button>
                <div class="crew-main">
                  <h4>
                    {r.name} <span class="muted">{r.title}</span>
                    <Show when={r.kind !== 'approval' && evo()[r.role]}>
                      <span class="chip" title="Harness version: persona, guidance and skills">v{evo()[r.role]!.version}</span>
                      <Show when={evo()[r.role]!.open}><span class="chip proposal-mark" title="A harness proposal waits for review">● proposal</span></Show>
                    </Show>
                  </h4>
                  <Show when={defs().find((x) => x.id === r.role)?.persona}>
                    <p class="muted small persona">{defs().find((x) => x.id === r.role)!.persona}</p>
                  </Show>
                  <Show
                    when={r.kind !== 'approval'}
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
                      <Show when={r.kind === 'agent' || r.kind === 'verdict'}>
                      <button title="Proposals, lessons and harness versions" onClick={() => { setEvolving(r); setTimeout(() => document.querySelector('.evolve-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}>Evolve</button>
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
        <Show when={evolving()} keyed>
          {(r) => <EvolvePanel bot={r.role} name={r.name} onClose={() => setEvolving(null)} onChange={() => void loadDefs()} />}
        </Show>
        <Show when={edit()}>
          {(_) => (
            <div class="bot-editor" role="dialog" aria-label="Edit bot">
              <div class="bot-preview">
                <Show when={preview()} fallback={<div class="muted small">…</div>}>
                  <Sprite pixels={preview()!} size={120} label={edit()!.name} />
                </Show>
                <div class="muted small">{edit()!.name || 'New bot'}</div>
              </div>
              <div class="bot-fields">
                <h3>{isNew() ? 'New bot' : `Edit ${edit()!.name}`}</h3>
                <div class="row">
                  <label>Name<input value={edit()!.name} maxLength={24} onInput={(e) => patch({ name: e.currentTarget.value })} /></label>
                  <label>Title<input value={edit()!.title} maxLength={28} placeholder="what it is" onInput={(e) => patch({ title: e.currentTarget.value })} /></label>
                </div>
                <label>Kind
                  <select value={edit()!.kind} disabled={!isNew() && !!edit()!.builtin} onChange={(e) => patch({ kind: e.currentTarget.value })}>
                    <For each={meta().kinds}>{(k) => <option value={k.kind}>{k.kind}: {k.blurb}</option>}</For>
                  </select>
                </label>
                <label>Persona (becomes this bot's instructions)
                  <textarea rows={4} maxLength={600} value={edit()!.persona} onInput={(e) => patch({ persona: e.currentTarget.value })} />
                </label>
                <Show when={edit()!.kind === 'agent' && !edit()!.builtin}>
                  <label class="check"><input type="checkbox" checked={!!edit()!.readOnly} onChange={(e) => patch({ readOnly: e.currentTarget.checked })} /> read-only (may not edit files)</label>
                </Show>
                <div class="look-grid">
                  <For each={PARTS}>
                    {(k) => (
                      <label>{k}
                        <select value={(edit()!.look as unknown as Record<string, string>)[k]} onChange={(e) => patchLook({ [k]: e.currentTarget.value })}>
                          <For each={meta().parts[k] ?? []}>{(o) => <option value={o}>{o}</option>}</For>
                        </select>
                      </label>
                    )}
                  </For>
                </div>
                <div class="row swatches">
                  <For each={SWATCH}>{(c) => <button class="swatch" style={{ background: c }} aria-label={`colour ${c}`} classList={{ on: edit()!.look.color === c }} onClick={() => patchLook({ color: c })} />}</For>
                  <input type="color" value={edit()!.look.color} onInput={(e) => patchLook({ color: e.currentTarget.value })} aria-label="custom colour" />
                  <label class="check"><input type="checkbox" checked={edit()!.look.accent === 'auto'} onChange={(e) => patchLook({ accent: e.currentTarget.checked ? 'auto' : '#ffffff' })} /> auto accent</label>
                  <Show when={edit()!.look.accent !== 'auto'}>
                    <input type="color" value={edit()!.look.accent} onInput={(e) => patchLook({ accent: e.currentTarget.value })} aria-label="accent colour" />
                  </Show>
                </div>
                <div class="row">
                  <button class="primary" disabled={!edit()!.name.trim()} onClick={() => void saveEdit()}>Save</button>
                  <button onClick={() => setEdit(null)}>Cancel</button>
                  <Show when={!isNew() && (!edit()!.builtin || edit()!.edited)}>
                    <button onClick={() => void removeDef(edit()!)}>{edit()!.builtin ? 'Reset to original' : 'Remove'}</button>
                  </Show>
                </div>
              </div>
            </div>
          )}
        </Show>
        <h3 class="packs-h">Crew packs</h3>
        <div class="crew-grid">
          <For each={meta().packs}>
            {(k) => (
              <div class="crew-card pack">
                <div class="crew-main">
                  <h4>{k.name} <span class="muted">{k.bots.length} bots</span></h4>
                  <p class="muted small">{k.blurb}</p>
                  <div class="row pack-sprites">
                    <For each={k.bots}>{(b) => <span title={`${b.name}: ${b.persona}`}>{MARK_STYLES.includes(crewStyle()) && b.mark ? <Mark style={crewStyle()} mark={b.mark} hue={b.look.color} size={34} label={b.name} /> : b.pixels ? <Sprite pixels={b.pixels} size={34} label={b.name} /> : null}</span>}</For>
                  </div>
                  <p class="muted small">{k.bots.map((b) => b.name).join(' · ')}</p>
                  <div class="row"><button onClick={() => void addPack(k)}>Add to my crew</button></div>
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
