import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Badge } from './components/arc/badge/badge';
import { Button } from './components/arc/button/button';
import { Card } from './components/arc/card/card';
import { Checkbox } from './components/arc/checkbox/checkbox';
import { Drawer, DrawerContent, useDrawerItem } from './components/arc/drawer/drawer';
import { Input } from './components/arc/input/input';
import SegmentedControl from './components/arc/segmented-control/segmented-control';
import { Select } from './components/arc/select/select';
import { Textarea } from './components/arc/textarea/textarea';
import { MARK_STYLES, applyCrew, useCrew, type BotDef, type Pixels } from './crewStore';
import { EvolvePanel } from './Evolve';
import { Face, Mark, Sprite } from './Face';
import { NONE, cn, fromNone } from './ui/cn';
import { useNotify } from './ui/notify';

interface Pack { id: string; name: string; blurb: string; bots: BotDef[] }
interface Meta { parts: Record<string, string[]>; kinds: { kind: string; blurb: string }[]; packs: Pack[]; styles: { id: string; blurb: string }[] }
const PARTS = ['body', 'eyes', 'mouth', 'top', 'side', 'pattern'];
const SWATCH = ['#5b9dff', '#38c5d6', '#6ee7a8', '#f2c14e', '#ff8a5b', '#ff6b8a', '#b58bff', '#c9a46a'];
const blank = (): BotDef => ({ id: '', name: '', title: '', kind: 'agent', persona: '', look: { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: SWATCH[Math.floor(Math.random() * SWATCH.length)]!, accent: 'auto' } });
const slug = (n: string) => (n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 20) || 'bot');

interface AgentInfo { ok: boolean; version?: string; detail?: string; models: string[] }
interface Row { role: string; name: string; title: string; kind: string; binding: { agent: string; model?: string } | null }
type CrewReply = { bots: BotDef[]; packs: Pack[]; parts: Record<string, string[]>; kinds: { kind: string; blurb: string }[]; style: string; styles: { id: string; blurb: string }[]; shapes: Record<string, string[]>; glyphs: Record<string, string[]>; evolve?: Record<string, { version: number; open: number }> };

export function Crew() {
  const notify = useNotify();
  const { style } = useCrew();
  const [rows, setRows] = useState<Row[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentInfo>>({});
  const [draft, setDraft] = useState<Record<string, { agent: string; model: string }>>({});
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [meta, setMeta] = useState<Meta>({ parts: {}, kinds: [], packs: [], styles: [] });
  const [defs, setDefs] = useState<BotDef[]>([]);
  const [edit, setEdit] = useState<BotDef | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [preview, setPreview] = useState<Pixels | null>(null);
  const [evo, setEvo] = useState<Record<string, { version: number; open: number }>>({});
  const [evolving, setEvolving] = useState<Row | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // the drawers keep showing their last item while they slide out
  const shown = useDrawerItem(edit);
  const evolveShown = useDrawerItem(evolving);

  const refreshPreview = (b: BotDef) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        setPreview(await api<Pixels>('POST', '/api/crew/preview', { look: b.look }));
      } catch {
        /* keep the last preview */
      }
    }, 120);
  };
  const patch = (p: Partial<BotDef>) => {
    if (!edit) return; // the drawer is sliding out
    const b = { ...edit, ...p };
    setEdit(b);
    refreshPreview(b);
  };
  const patchLook = (p: Partial<BotDef['look']>) => edit && patch({ look: { ...edit.look, ...p } });
  const open = (b: BotDef, fresh = false) => {
    setEdit(JSON.parse(JSON.stringify(b)) as BotDef);
    setIsNew(fresh);
    setPreview(b.pixels ?? null);
    if (fresh) refreshPreview(b);
  };

  const loadDefs = useCallback(async () => {
    const r = await api<CrewReply>('GET', '/api/crew');
    setEvo(r.evolve ?? {});
    applyCrew(r.bots, r);
    setDefs(r.bots);
    setMeta({ parts: r.parts, kinds: r.kinds, packs: r.packs, styles: r.styles });
  }, []);

  const load = useCallback(async () => {
    try {
      await loadDefs();
      const r = await api<{ crew: Row[]; agents: Record<string, AgentInfo> }>('GET', '/api/bots');
      setRows(r.crew);
      setAgents(r.agents);
      setDraft(Object.fromEntries(r.crew.map((c) => [c.role, { agent: c.binding?.agent ?? '', model: c.binding?.model ?? '' }])));
      setLoadErr('');
    } catch (e) {
      // a load failure shows inline with a retry; action failures are toasts
      setLoadErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadDefs]);
  useEffect(() => {
    void load();
  }, [load]);

  async function pickStyle(id: string) {
    try {
      await api('PUT', '/api/crew/style', { style: id });
      await loadDefs();
      notify.ok(`style: ${id}`);
    } catch (e) {
      notify.fail(e);
    }
  }
  async function saveEdit() {
    if (!edit) return;
    const b = edit;
    const id = isNew ? slug(b.name) : b.id;
    const taken = new Set(defs.map((d) => d.id));
    let use = id;
    if (isNew) for (let i = 2; taken.has(use); i++) use = `${id.slice(0, 20)}${i}`;
    try {
      await api('PUT', `/api/crew/${use}`, { ...b, id: use });
      setEdit(null);
      notify.ok(`${b.name} saved`);
      await load();
    } catch (e) {
      notify.fail(e);
    }
  }
  async function removeDef(b: BotDef) {
    if (!edit) return;
    try {
      await api('DELETE', `/api/crew/${b.id}`);
      setEdit(null);
      notify.ok(b.builtin ? `${b.name} reset to its original look` : `${b.name} removed`);
      await load();
    } catch (e) {
      notify.fail(e);
    }
  }
  async function addPack(k: Pack) {
    try {
      const r = await api<{ added: string[] }>('POST', `/api/crew/packs/${k.id}`);
      notify.ok(`${k.name}: added ${r.added.length} bots`);
      await load();
    } catch (e) {
      notify.fail(e);
    }
  }

  const set = (role: string, p: Partial<{ agent: string; model: string }>) => setDraft((all) => ({ ...all, [role]: { ...all[role]!, ...p } }));
  const dirty = (r: Row) => {
    const d = draft[r.role];
    return !!d && (d.agent !== (r.binding?.agent ?? '') || d.model !== (r.binding?.model ?? ''));
  };

  async function save(r: Row, d = draft[r.role]!) {
    try {
      if (!d.agent) await api('DELETE', `/api/bots/${r.role}`);
      else await api('PUT', `/api/bots/${r.role}`, { agent: d.agent, model: d.model });
      notify.ok(d.agent ? `${r.name} → ${d.agent}${d.model ? ' · ' + d.model : ''}` : `${r.name} unlinked`);
      await load();
    } catch (e) {
      notify.fail(e);
    }
  }

  const look = (b: BotDef) => b.look as unknown as Record<string, string>;
  return (
    <div className="crew-page">
      <div className="crew-head">
        <h2>Crew</h2>
        <p className="muted">
          Link each bot to an agent and model. A step with no agent of its own follows its bot; a step that names one keeps it.
          Changes apply to the next run you start. Click a bot's look to edit it, or add your own.
        </p>
        <Button variant="primary" onClick={() => open(blank(), true)}>+ New bot</Button>
        <SegmentedControl label="Crew style" options={meta.styles.map((s) => ({ value: s.id, label: s.id }))} value={style} onValueChange={(v) => void pickStyle(v)} />
        {MARK_STYLES.includes(style) ? (
          <p className="muted small">
            {meta.styles.find((s) => s.id === style)?.blurb}. The bot editor below still edits the pixel look, which the pebble style and the terminal's pebble style use.
          </p>
        ) : null}
      </div>
      {loadErr ? (
        <div className="alert error" role="alert">
          {loadErr}{' '}
          <Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button>
        </div>
      ) : null}
      {loading ? (
        <p className="muted">Checking which agents are installed…</p>
      ) : (
        <>
          <div className="crew-grid">
            {rows.map((r) => {
              const def = defs.find((x) => x.id === r.role);
              const ev = evo[r.role];
              const agent = draft[r.role]?.agent ?? '';
              return (
                <div className="crew-card" key={r.role}>
                  <button className="sprite-btn" title="Edit this bot" onClick={() => def && open(def)}>
                    <Face role={r.role} size={48} />
                  </button>
                  <div className="crew-main">
                    <h4>
                      {r.name} <span className="muted">{r.title}</span>
                      {r.kind !== 'approval' && ev ? (
                        <>
                          {' '}
                          <Badge size="sm" title="Harness version: persona, guidance and skills">v{ev.version}</Badge>
                          {ev.open ? (
                            <>
                              {' '}
                              <Badge size="sm" tone="info" className="proposal-mark" title="A harness proposal waits for review">● proposal</Badge>
                            </>
                          ) : null}
                        </>
                      ) : null}
                    </h4>
                    {def?.persona ? <p className="muted small persona">{def.persona}</p> : null}
                    {r.kind !== 'approval' ? (
                      <>
                        <Select
                          label="Agent"
                          options={[{ value: NONE, label: 'default (claude)' }, ...Object.keys(agents).map((a) => ({ value: a, label: a + (agents[a]!.ok ? '' : ' (not available)') }))]}
                          value={agent || NONE}
                          onValueChange={(v) => set(r.role, { agent: fromNone(v), model: '' })}
                        />
                        <Input
                          label="Model"
                          list={`models-${r.role}`}
                          value={draft[r.role]?.model ?? ''}
                          placeholder="adapter default"
                          spellCheck={false}
                          onChange={(e) => set(r.role, { model: e.target.value })}
                        />
                        <datalist id={`models-${r.role}`}>
                          {(agents[agent]?.models ?? []).map((m) => <option key={m} value={m} />)}
                        </datalist>
                        <div className="row">
                          <Button variant="primary" size="sm" disabled={!dirty(r)} onClick={() => void save(r)}>Save</Button>
                          {r.binding ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                const cleared = { agent: '', model: '' };
                                set(r.role, cleared);
                                void save(r, cleared);
                              }}
                            >
                              Unlink
                            </Button>
                          ) : null}
                          {r.kind === 'agent' || r.kind === 'verdict' ? (
                            <Button variant="secondary" size="sm" title="Proposals, lessons and harness versions" onClick={() => setEvolving(r)}>Evolve</Button>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <p className="muted">A person signs off here. Nothing to link.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <Drawer open={!!evolving} onOpenChange={(o) => !o && setEvolving(null)}>
            <DrawerContent side="right" title={`Evolve ${evolveShown?.name ?? ''}`}>
              {evolveShown ? (
                <EvolvePanel key={evolveShown.role} inDrawer bot={evolveShown.role} name={evolveShown.name} onClose={() => setEvolving(null)} onChange={() => void loadDefs()} />
              ) : null}
            </DrawerContent>
          </Drawer>

          <Drawer open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
            <DrawerContent side="right" title={isNew ? 'New bot' : `Edit ${shown?.name ?? ''}`}>
              {shown ? (
                <div className="bot-editor in-drawer" aria-label="Edit bot">
                  <div className="bot-preview">
                    {preview ? <Sprite pixels={preview} size={120} label={shown.name} /> : <div className="muted small">…</div>}
                    <div className="muted small">{shown.name || 'New bot'}</div>
                  </div>
                  <div className="bot-fields">
                    <div className="row">
                      <Input label="Name" value={shown.name} maxLength={24} onChange={(e) => patch({ name: e.target.value })} />
                      <Input label="Title" value={shown.title} maxLength={28} placeholder="what it is" onChange={(e) => patch({ title: e.target.value })} />
                    </div>
                    <Select
                      label="Kind"
                      options={meta.kinds.map((k) => ({ value: k.kind, label: `${k.kind}: ${k.blurb}` }))}
                      value={shown.kind}
                      disabled={!isNew && !!shown.builtin}
                      onValueChange={(v) => patch({ kind: v })}
                    />
                    <Textarea label="Persona (becomes this bot's instructions)" rows={4} maxLength={600} value={shown.persona} onChange={(e) => patch({ persona: e.target.value })} />
                    {shown.kind === 'agent' && !shown.builtin ? (
                      <Checkbox label="read-only (may not edit files)" checked={!!shown.readOnly} onCheckedChange={(c) => patch({ readOnly: c === true })} />
                    ) : null}
                    <div className="look-grid">
                      {PARTS.map((k) => (
                        <Select key={k} label={k} options={(meta.parts[k] ?? []).map((o) => ({ value: o, label: o }))} value={look(shown)[k]} onValueChange={(v) => patchLook({ [k]: v })} />
                      ))}
                    </div>
                    <div className="row swatches">
                      {SWATCH.map((c) => (
                        <button key={c} className={cn('swatch', { on: shown.look.color === c })} style={{ background: c }} aria-label={`colour ${c}`} onClick={() => patchLook({ color: c })} />
                      ))}
                      <input type="color" value={shown.look.color} onChange={(e) => patchLook({ color: e.target.value })} aria-label="custom colour" />
                      <Checkbox label="auto accent" checked={shown.look.accent === 'auto'} onCheckedChange={(c) => patchLook({ accent: c === true ? 'auto' : '#ffffff' })} />
                      {shown.look.accent !== 'auto' ? (
                        <input type="color" value={shown.look.accent} onChange={(e) => patchLook({ accent: e.target.value })} aria-label="accent colour" />
                      ) : null}
                    </div>
                    <div className="row">
                      <Button variant="primary" disabled={!shown.name.trim()} onClick={() => void saveEdit()}>Save</Button>
                      <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
                      {!isNew && (!shown.builtin || shown.edited) ? (
                        <Button variant="secondary" onClick={() => void removeDef(shown)}>{shown.builtin ? 'Reset to original' : 'Remove'}</Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </DrawerContent>
          </Drawer>

          <h3 className="packs-h">Crew packs</h3>
          <div className="crew-grid">
            {meta.packs.map((k) => (
              <Card
                key={k.id}
                className="pack"
                title={k.name}
                description={k.blurb}
                meta={`${k.bots.length} bots`}
                action={<Button variant="secondary" size="sm" onClick={() => void addPack(k)}>Add to my crew</Button>}
              >
                <div className="row pack-sprites">
                  {k.bots.map((b) => (
                    <span key={b.id} title={`${b.name}: ${b.persona}`}>
                      {MARK_STYLES.includes(style) && b.mark ? <Mark style={style} mark={b.mark} hue={b.look.color} size={34} label={b.name} /> : b.pixels ? <Sprite pixels={b.pixels} size={34} label={b.name} /> : null}
                    </span>
                  ))}
                </div>
                <p className="muted small">{k.bots.map((b) => b.name).join(' · ')}</p>
              </Card>
            ))}
          </div>
          <p className="muted small">Local models (Ollama, LM Studio, llama.cpp) appear here when their server is running.</p>
        </>
      )}
    </div>
  );
}
