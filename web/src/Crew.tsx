import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Badge } from './components/arc/badge/badge';
import { Button } from './components/arc/button/button';
import { Card } from './components/arc/card/card';
import { Checkbox } from './components/arc/checkbox/checkbox';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { Drawer, DrawerContent, useDrawerItem } from './components/arc/drawer/drawer';
import { Input } from './components/arc/input/input';
import { Select } from './components/arc/select/select';
import { Slider } from './components/arc/slider/slider';
import { Tabs, TabsList, TabsTrigger } from './components/arc/tabs/tabs';
import { Textarea } from './components/arc/textarea/textarea';
import { applyCrew, loadCrewDefs, type BotDef, type FaceLook } from './crewStore';
import { EvolvePanel } from './Evolve';
import { Face } from './Face';
import { NONE, fromNone } from './ui/cn';
import { ConfirmButton } from './ui/ConfirmButton';
import { useNotify } from './ui/notify';

interface Pack { id: string; name: string; blurb: string; bots: BotDef[] }
interface Ecc { ref: string; at: string }
interface Meta { kinds: { kind: string; blurb: string }[]; packs: Pack[]; ecc: Ecc | null; eccDefault: string }
interface ImportReply { ref: string; added: string[]; updated: string[]; removed: string[]; skipped: string[]; notes: string[]; skills: number; commands: number }
type Filter = 'all' | 'builtin' | 'custom' | 'ecc';
const isEcc = (b?: BotDef) => !!b?.source?.startsWith('ecc@');
const sourceOf = (b?: BotDef): Exclude<Filter, 'all'> => (isEcc(b) ? 'ecc' : b?.builtin ? 'builtin' : 'custom');
/** The hue the slider shows before it is moved; not saved until then. */
const DEFAULT_HUE = 200;
const SWATCH = ['#5b9dff', '#38c5d6', '#6ee7a8', '#f2c14e', '#ff8a5b', '#ff6b8a', '#b58bff', '#c9a46a'];
const blank = (): BotDef => ({ id: '', name: '', title: '', kind: 'agent', persona: '', look: { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: SWATCH[Math.floor(Math.random() * SWATCH.length)]!, accent: 'auto' } });
const slug = (n: string) => (n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 20) || 'bot');

interface AgentInfo { ok: boolean; version?: string; detail?: string; models: string[] }
interface Row { role: string; name: string; title: string; kind: string; binding: { agent: string; model?: string } | null }
type CrewReply = { bots: BotDef[]; packs: Pack[]; kinds: { kind: string; blurb: string }[]; evolve?: Record<string, { version: number; open: number }>; ecc?: Ecc | null; eccDefault?: string };

export function Crew() {
  const notify = useNotify();
  const [rows, setRows] = useState<Row[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentInfo>>({});
  const [draft, setDraft] = useState<Record<string, { agent: string; model: string }>>({});
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [meta, setMeta] = useState<Meta>({ kinds: [], packs: [], ecc: null, eccDefault: '' });
  const [defs, setDefs] = useState<BotDef[]>([]);
  const [edit, setEdit] = useState<BotDef | null>(null);
  const [isNew, setIsNew] = useState(false);
  // an imported bot's persona arrives truncated; once edited, the server must take the new one
  const [personaEdited, setPersonaEdited] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [importing, setImporting] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [evo, setEvo] = useState<Record<string, { version: number; open: number }>>({});
  const [evolving, setEvolving] = useState<Row | null>(null);
  // the drawers keep showing their last item while they slide out
  const shown = useDrawerItem(edit);
  const evolveShown = useDrawerItem(evolving);

  const patch = (p: Partial<BotDef>) => {
    if (!edit) return; // the drawer is sliding out
    setEdit({ ...edit, ...p });
  };
  const patchFace = (p: Partial<FaceLook>) => edit && patch({ look: { ...edit.look, face: { ...edit.look.face, ...p } } });
  const resetFace = () => {
    if (!edit) return;
    const { face: _drop, ...rest } = edit.look;
    patch({ look: rest });
  };
  const open = (b: BotDef, fresh = false) => {
    setEdit(JSON.parse(JSON.stringify(b)) as BotDef);
    setIsNew(fresh);
    setPersonaEdited(false);
  };

  const loadDefs = useCallback(async () => {
    const r = await api<CrewReply>('GET', '/api/crew');
    setEvo(r.evolve ?? {});
    applyCrew(r.bots);
    setDefs(r.bots);
    setMeta({ kinds: r.kinds, packs: r.packs, ecc: r.ecc ?? null, eccDefault: r.eccDefault ?? '' });
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

  async function importEcc() {
    if (importBusy) return;
    setImportBusy(true);
    try {
      const d = await api<ImportReply>('POST', '/api/crew/import', { source: 'ecc' });
      notify.ok(`ECC ${d.ref}: ${d.added.length} added, ${d.updated.length} updated, ${d.removed.length} removed`);
      setImporting(false);
      await Promise.all([load(), loadCrewDefs(true)]);
    } catch (e) {
      notify.fail(e);
    } finally {
      setImportBusy(false);
    }
  }
  async function removeEcc() {
    try {
      const d = await api<{ removed: string[] }>('DELETE', '/api/crew?source=ecc');
      notify.ok(`Removed ${d.removed.length} ECC bots`);
      await Promise.all([load(), loadCrewDefs(true)]);
    } catch (e) {
      notify.fail(e);
    }
  }
  async function saveEdit() {
    if (!edit) return;
    // an edited persona replaces the saved one; an untouched truncated one tells the server to keep its copy
    const { personaTruncated, ...rest } = edit;
    const b: BotDef = personaEdited || personaTruncated === undefined ? rest : { ...rest, personaTruncated };
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

  const counts: Record<Filter, number> = { all: rows.length, builtin: 0, custom: 0, ecc: 0 };
  for (const r of rows) counts[sourceOf(defs.find((d) => d.id === r.role))]++;
  const hasEcc = defs.some(isEcc);
  const view: Filter = filter === 'ecc' && !hasEcc ? 'all' : filter;
  const shownRows = view === 'all' ? rows : rows.filter((r) => sourceOf(defs.find((d) => d.id === r.role)) === view);
  return (
    <div className="crew-page">
      <div className="crew-head">
        <h2>Crew</h2>
        <p className="muted">
          Link each bot to an agent and model. A step with no agent of its own follows its bot; a step that names one keeps it.
          Changes apply to the next run you start. Click a bot's look to edit it, or add your own.
        </p>
        <div className="row">
          <Button variant="primary" onClick={() => open(blank(), true)}>+ New bot</Button>
          <Button variant="secondary" onClick={() => setImporting(true)}>{meta.ecc ? 'Update ECC…' : 'Import ECC…'}</Button>
          {meta.ecc ? <ConfirmButton label="Remove ECC" prompt="Remove every ECC bot and the vendored checkout?" confirmLabel="Remove" onConfirm={removeEcc} /> : null}
        </div>
      </div>
      <Dialog open={importing} onOpenChange={(o) => !importBusy && setImporting(o)}>
        <DialogContent
          title="Import ECC"
          description="Adds ECC's agents as crew bots and its skills and commands to the skills list. Hooks and rules are not imported. Source: github.com/affaan-m/ECC (MIT)."
        >
          <p className="small">{`Version ${meta.ecc?.ref ? `${meta.ecc.ref} → ` : ''}${meta.eccDefault}`}</p>
          <div className="row end">
            <Button variant="secondary" disabled={importBusy} onClick={() => setImporting(false)}>Cancel</Button>
            <Button variant="primary" loading={importBusy} onClick={() => void importEcc()}>Import</Button>
          </div>
        </DialogContent>
      </Dialog>
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
          <Tabs value={view} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList aria-label="Bot source">
              <TabsTrigger value="all">{`All ${counts.all}`}</TabsTrigger>
              <TabsTrigger value="builtin">{`Built-in ${counts.builtin}`}</TabsTrigger>
              <TabsTrigger value="custom">{`Custom ${counts.custom}`}</TabsTrigger>
              {hasEcc ? <TabsTrigger value="ecc">{`ECC ${counts.ecc}`}</TabsTrigger> : null}
            </TabsList>
          </Tabs>
          <div className="crew-grid">
            {shownRows.map((r) => {
              const def = defs.find((x) => x.id === r.role);
              const ev = evo[r.role];
              const agent = draft[r.role]?.agent ?? '';
              return (
                <div className="crew-card" key={r.role}>
                  <button className="sprite-btn" title="Edit this bot" aria-label={`Edit ${r.name}`} onClick={() => def && open(def)}>
                    <Face id={r.role} size={48} animate="hover" />
                  </button>
                  <div className="crew-main">
                    <h4>
                      {r.name} <span className="muted">{r.title}</span>
                      {isEcc(def) ? (
                        <>
                          {' '}
                          <Badge size="sm" title={def?.source}>ECC</Badge>
                        </>
                      ) : null}
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
                    {def?.whenToUse || def?.persona ? <p className="muted small persona">{def.whenToUse || def.persona}</p> : null}
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
                    <Face id={shown.id || 'new-bot'} face={shown.look.face ?? {}} size={120} animate="hover" label={`${shown.name || 'New bot'} preview`} />
                    <div className="muted small">{shown.name || 'New bot'}</div>
                    <Slider label="Hue" min={0} max={359} step={1} value={shown.look.face?.hue ?? DEFAULT_HUE} onValueChange={(v) => patchFace({ hue: v })} />
                    <Slider label="Tone" min={0} max={1} step={0.05} value={shown.look.face?.tone ?? 0.5} format={(v) => v.toFixed(2)} onValueChange={(v) => patchFace({ tone: v })} />
                    <Button variant="ghost" size="sm" disabled={!shown.look.face} onClick={resetFace}>Reset to generated</Button>
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
                    <Textarea
                      label="Persona (becomes this bot's instructions)"
                      rows={4}
                      maxLength={isEcc(shown) ? 24000 : 600}
                      value={shown.persona}
                      description={isEcc(shown) ? 'From ECC; an update replaces your edits' : undefined}
                      onChange={(e) => {
                        setPersonaEdited(true);
                        patch({ persona: e.target.value });
                      }}
                    />
                    {shown.kind === 'agent' && !shown.builtin ? (
                      <Checkbox label="read-only (may not edit files)" checked={!!shown.readOnly} onCheckedChange={(c) => patch({ readOnly: c === true })} />
                    ) : null}
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
                      <Face id={b.id} size={34} label={b.name} />
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
