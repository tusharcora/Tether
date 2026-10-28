import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Button } from './components/beui/kit/Button';
import { Dialog, DialogContent } from './components/beui/kit/overlays';
import { Drawer, DrawerContent, useDrawerItem } from './components/beui/kit/overlays';
import { SearchField } from './components/beui/kit/fields';
import { Tabs, TabsList, TabsTrigger } from './components/beui/kit/controls';
import { Loading } from './components/Loading';
import { BotEditor } from './crew/BotEditor';
import { CrewCard } from './crew/CrewCard';
import { RunsOn } from './crew/RunsOn';
import { isEcc, sourceOf, type AgentInfo, type Binding, type CrewReply, type Filter, type ImportReply, type Meta, type Pack, type Row } from './crew/types';
import { applyCrew, loadCrewDefs, type BotDef, type FaceLook } from './crewStore';
import { EvolvePanel } from './Evolve';
import { Face } from './Face';
import { ConfirmButton } from './ui/ConfirmButton';
import { useNotify } from './ui/notify';
import { EmptyState } from './ui/studio/EmptyState';
import { InlineError } from './ui/studio/InlineError';
import { ScreenHeader } from './ui/studio/ScreenHeader';
import { SectionHeading } from './ui/studio/SectionHeading';
import { PHONE, useMediaQuery } from './ui/studio/useMediaQuery';
import './crew/crew.css';

/** Face colours for a new bot. Faces are identity art, exempt from the no-purple rule (see rules.test.ts). */
const SWATCH = ['#5b9dff', '#38c5d6', '#6ee7a8', '#f2c14e', '#ff8a5b', '#ff6b8a', '#b58bff', '#c9a46a'];
const blank = (): BotDef => ({ id: '', name: '', title: '', kind: 'agent', persona: '', look: { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: SWATCH[Math.floor(Math.random() * SWATCH.length)]!, accent: 'auto' } });
const slug = (n: string) => (n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 20) || 'bot');
const NO_BINDING: Binding = { agent: '', model: '', toolStyle: 'code', codeReads: false };
const bindingOf = (b: Row['binding']): Binding => ({ agent: b?.agent ?? '', model: b?.model ?? '', toolStyle: b?.toolStyle ?? 'code', codeReads: !!b?.codeReads });

export function Crew(props: { bot?: string; onBot?: (id?: string) => void }) {
  const notify = useNotify();
  const phone = useMediaQuery(PHONE);
  const [rows, setRows] = useState<Row[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentInfo>>({});
  const [draft, setDraft] = useState<Record<string, Binding>>({});
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  // after one good load a failed refresh keeps the board and shows a compact retry above it
  const [loaded, setLoaded] = useState(false);
  const gridRef = useRef<HTMLElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);
  const [refocus, setRefocus] = useState(0);
  const [meta, setMeta] = useState<Meta>({ kinds: [], packs: [], ecc: null, eccDefault: '' });
  const [defs, setDefs] = useState<BotDef[]>([]);
  const [edit, setEdit] = useState<BotDef | null>(null);
  const [isNew, setIsNew] = useState(false);
  // an imported bot's persona arrives truncated; once edited, the server must take the new one
  const [personaEdited, setPersonaEdited] = useState(false);
  // a truncated persona is replaced by the full one from GET /api/crew/:id; until then it cannot be edited
  const [personaLoad, setPersonaLoad] = useState<'ok' | 'loading' | 'failed'>('ok');
  const opening = useRef(0);
  /** The editor's draft as opened, to tell unsaved edits apart. */
  const base = useRef('');
  const [sel, setSel] = useState<string>();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [importing, setImporting] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [evo, setEvo] = useState<Record<string, { version: number; open: number }>>({});
  const [evolving, setEvolving] = useState<Row | null>(null);
  const [pending, setPending] = useState<null | (() => void)>(null);
  // the drawers keep showing their last item while they slide out
  const shown = useDrawerItem(edit);
  const evolveShown = useDrawerItem(evolving);
  const dirty = !!edit && JSON.stringify(edit) !== base.current;

  const patch = (p: Partial<BotDef>) => edit && setEdit({ ...edit, ...p });
  const patchFace = (p: Partial<FaceLook>) => edit && patch({ look: { ...edit.look, face: { ...edit.look.face, ...p } } });
  const resetFace = () => {
    if (!edit) return;
    const { face: _drop, ...rest } = edit.look;
    patch({ look: rest });
  };
  const open = (b: BotDef, fresh = false) => {
    const token = ++opening.current;
    const copy = JSON.parse(JSON.stringify(b)) as BotDef;
    base.current = JSON.stringify(copy);
    setEdit(copy);
    setIsNew(fresh);
    setPersonaEdited(false);
    setPersonaLoad(b.personaTruncated && b.id ? 'loading' : 'ok');
    if (!b.personaTruncated || !b.id) return;
    api<BotDef>('GET', `/api/crew/${b.id}`).then(
      (full) => {
        if (opening.current !== token) return; // another bot was opened meanwhile
        // only the persona comes from the full bot, so edits made while it loaded are kept
        const withFull = (x: BotDef): BotDef => {
          const { personaTruncated: _cut, ...rest } = x;
          return { ...rest, persona: full.persona };
        };
        base.current = JSON.stringify(withFull(JSON.parse(base.current) as BotDef));
        setEdit((cur) => (cur && cur.id === b.id ? withFull(cur) : cur));
        setPersonaLoad('ok');
      },
      () => opening.current === token && setPersonaLoad('failed'),
    );
  };

  const loadDefs = useCallback(async () => {
    const r = await api<CrewReply>('GET', '/api/crew');
    setEvo(r.evolve ?? {});
    applyCrew(r.bots);
    setDefs(r.bots);
    setMeta({ kinds: r.kinds, packs: r.packs, ecc: r.ecc ?? null, eccDefault: r.eccDefault ?? '' });
    return r.bots;
  }, []);

  const load = useCallback(async (): Promise<BotDef[] | undefined> => {
    try {
      const bots = await loadDefs();
      const r = await api<{ crew: Row[]; agents: Record<string, AgentInfo> }>('GET', '/api/bots');
      setRows(r.crew);
      setAgents(r.agents);
      setDraft(Object.fromEntries(r.crew.map((c) => [c.role, bindingOf(c.binding)])));
      setLoadErr('');
      setLoaded(true);
      return bots;
    } catch (e) {
      // a load failure shows inline with a retry; action failures are toasts
      setLoadErr((e as Error).message);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [loadDefs]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Run `fn` now, or after the person agrees to drop the editor's unsaved edits. */
  const guard = (fn: () => void) => (dirty ? setPending(() => fn) : fn());
  const pick = (role: string) => {
    if (role === sel && edit && !isNew) return;
    guard(() => {
      const d = defs.find((x) => x.id === role);
      if (!d) return;
      setSel(role);
      open(d);
      props.onBot?.(role);
    });
  };
  const newBot = () =>
    guard(() => {
      setSel(undefined);
      open(blank(), true);
      props.onBot?.(undefined);
    });
  const cancelEdit = () => {
    const d = !isNew && sel ? defs.find((x) => x.id === sel) : undefined;
    if (d) open(d);
    else setEdit(null);
  };
  const closeDrawer = () =>
    guard(() => {
      setEdit(null);
      setSel(undefined);
      props.onBot?.(undefined);
    });

  // the deep link (#/crew/<bot>) opens that bot once the crew has loaded; with unsaved edits (e.g. Back from another bot) it asks first
  useEffect(() => {
    if (!props.bot || loading || props.bot === sel) return;
    const d = defs.find((x) => x.id === props.bot);
    if (d)
      guard(() => {
        setSel(d.id);
        open(d);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bot, loading]);
  // Back/Forward to plain #/crew clears the selection (unless there are unsaved edits, or a new bot is open: newBot clears the hash itself)
  useEffect(() => {
    if (props.bot || dirty || isNew || !sel) return;
    setSel(undefined);
    setEdit(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bot]);
  // after Delete / Reset closes the editor, focus goes to the first card or the empty panel, not the page body
  useEffect(() => {
    if (!refocus) return;
    (gridRef.current?.querySelector<HTMLElement>('.cw-card') ?? emptyRef.current)?.focus();
  }, [refocus]);
  const missing = props.bot && !loading && loaded && !defs.some((d) => d.id === props.bot) ? props.bot : undefined;

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
      notify.ok(`${b.name} saved`);
      const fresh = await load();
      // a failed refresh keeps the editor on what was just saved (the save itself worked)
      const saved = fresh ? fresh.find((d) => d.id === use) : { ...b, id: use };
      if (saved) {
        setSel(use);
        open(saved);
        props.onBot?.(use);
      } else setEdit(null);
    } catch (e) {
      notify.fail(e);
    }
  }
  async function removeDef(b: BotDef) {
    try {
      await api('DELETE', `/api/crew/${b.id}`);
      setEdit(null);
      setSel(undefined);
      props.onBot?.(undefined);
      notify.ok(b.builtin ? `${b.name} reset to its original look` : `${b.name} removed`);
      await load();
      setRefocus((n) => n + 1);
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

  const setBinding = (role: string, p: Partial<Binding>) => setDraft((all) => ({ ...all, [role]: { ...(all[role] ?? NO_BINDING), ...p } }));
  const bindingDirty = (r: Row) => {
    const d = draft[r.role];
    const saved = bindingOf(r.binding);
    return !!d && (d.agent !== saved.agent || d.model !== saved.model || d.toolStyle !== saved.toolStyle || d.codeReads !== saved.codeReads);
  };
  async function saveBinding(r: Row, d = draft[r.role] ?? NO_BINDING) {
    try {
      // a tool style other than the default needs a link: the default agent is claude
      const custom = d.toolStyle === 'direct' || d.codeReads;
      if (!d.agent && !custom) await api('DELETE', `/api/bots/${r.role}`);
      else await api('PUT', `/api/bots/${r.role}`, { agent: d.agent || 'claude', model: d.model, toolStyle: d.toolStyle, ...(d.codeReads ? { codeReads: true } : {}) });
      notify.ok(d.agent ? `${r.name} → ${d.agent}${d.model ? ' · ' + d.model : ''}` : `${r.name} unlinked`);
      await load();
    } catch (e) {
      notify.fail(e);
    }
  }

  const defOf = (r: Row) => defs.find((d) => d.id === r.role);
  const counts: Record<Filter, number> = { all: rows.length, builtin: 0, custom: 0, ecc: 0 };
  for (const r of rows) counts[sourceOf(defOf(r))]++;
  const hasEcc = defs.some(isEcc);
  const view: Filter = filter === 'ecc' && !hasEcc ? 'all' : filter;
  const needle = q.trim().toLowerCase();
  const shownRows = rows
    .filter((r) => view === 'all' || sourceOf(defOf(r)) === view)
    .filter((r) => {
      if (!needle) return true;
      const d = defOf(r);
      return `${r.name} ${r.title} ${r.role} ${d?.whenToUse ?? ''} ${d?.persona ?? ''}`.toLowerCase().includes(needle);
    });
  const selRow = rows.find((r) => r.role === sel);
  const evolvable = !!selRow && (selRow.kind === 'agent' || selRow.kind === 'verdict');

  const editorFor = (b: BotDef) => (
    <>
      <BotEditor
        bot={b}
        isNew={isNew}
        kinds={meta.kinds}
        personaLoad={personaLoad}
        onPatch={patch}
        onFace={patchFace}
        onResetFace={resetFace}
        onPersona={(text) => {
          setPersonaEdited(true);
          patch({ persona: text });
        }}
        onSave={() => void saveEdit()}
        onCancel={cancelEdit}
        onRemove={() => void removeDef(b)}
      />
      {!isNew && selRow ? (
        <RunsOn
          row={selRow}
          agents={agents}
          draft={draft[selRow.role] ?? NO_BINDING}
          dirty={bindingDirty(selRow)}
          onChange={(p) => setBinding(selRow.role, p)}
          onSave={() => void saveBinding(selRow)}
          onUnlink={() => {
            setBinding(selRow.role, NO_BINDING);
            void saveBinding(selRow, NO_BINDING);
          }}
        />
      ) : null}
    </>
  );

  return (
    <div className="cw-page">
      <ScreenHeader
        meta={`crew · ${counts.builtin} built-in · ${counts.custom} yours${meta.ecc ? ` · ${counts.ecc} from ECC ${meta.ecc.ref}` : ''}`}
        title="Crew"
        summary="Each bot's look, persona and the agent it runs on. Changes apply to the next run you start."
        actions={
          <>
            <SearchField label="Find a bot" value={q} onValueChange={setQ} placeholder="Name or when to use" />
            <Button variant="secondary" onClick={() => document.getElementById('crew-packs')?.scrollIntoView({ block: 'start' })}>
              Crew packs
            </Button>
            <Button variant="secondary" disabled={!evolvable} title={evolvable ? 'Proposals, lessons and harness versions' : 'Select an agent or verdict bot'} onClick={() => selRow && setEvolving(selRow)}>
              Evolve
            </Button>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              {meta.ecc ? 'Update ECC…' : 'Import ECC…'}
            </Button>
            {meta.ecc ? <ConfirmButton label="Remove ECC" prompt="Remove every ECC bot and the vendored checkout?" confirmLabel="Remove" onConfirm={removeEcc} /> : null}
            <Button variant="primary" onClick={newBot}>
              + New bot
            </Button>
          </>
        }
      />
      {loadErr && !loaded ? <InlineError message={loadErr} onRetry={() => void load()} /> : null}
      <Loading loading={loading} lines={6} label="Checking which agents are installed">
        {loadErr && !loaded ? null : (
          <div className="cw-body">
            <div className="cw-main">
              <Tabs value={view} onValueChange={(v) => setFilter(v as Filter)}>
                <TabsList aria-label="Bot source">
                  <TabsTrigger value="all">{`All ${counts.all}`}</TabsTrigger>
                  <TabsTrigger value="builtin">{`Built-in ${counts.builtin}`}</TabsTrigger>
                  <TabsTrigger value="custom">{`Yours ${counts.custom}`}</TabsTrigger>
                  {hasEcc ? <TabsTrigger value="ecc">{`ECC ${counts.ecc}`}</TabsTrigger> : null}
                </TabsList>
              </Tabs>
              {loadErr ? <InlineError compact message={loadErr} onRetry={() => void load()} /> : null}
              {missing ? (
                <p className="sl-note" role="status">
                  No bot called “{missing}”.
                </p>
              ) : null}
              {shownRows.length ? (
                <section ref={gridRef} className="cw-grid" aria-label="Bots">
                  {shownRows.map((r) => {
                    const b = r.binding ? agents[r.binding.agent] : undefined;
                    return <CrewCard key={r.role} row={r} def={defOf(r)} evo={evo[r.role]} agentMissing={!!b && !b.ok} selected={sel === r.role} onPick={() => pick(r.role)} />;
                  })}
                </section>
              ) : (
                <EmptyState title="No bots match" description="Try another name, or another source." />
              )}
              <section id="crew-packs" className="cw-packs" aria-labelledby="crew-packs-h">
                <SectionHeading id="crew-packs-h" title="Crew packs" count={meta.packs.length} />
                <div className="cw-pack-grid">
                  {meta.packs.map((k) => (
                    <div key={k.id} className="sl-panel cw-pack">
                      <h3>{k.name}</h3>
                      <p className="sl-summary">{k.blurb}</p>
                      <div className="cw-pack-faces">
                        {k.bots.map((b) => (
                          <span key={b.id} title={`${b.name}: ${b.persona}`}>
                            <Face id={b.id} size={34} label={b.name} />
                          </span>
                        ))}
                      </div>
                      <p className="sl-meta">{k.bots.map((b) => b.name).join(' · ')}</p>
                      <div>
                        <Button variant="secondary" size="sm" onClick={() => void addPack(k)}>
                          Add to my crew
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <p className="sl-meta">Local models (Ollama, LM Studio, llama.cpp) appear here when their server is running.</p>
            </div>
            {phone ? null : (
              <aside className="cw-side" aria-label="Edit bot">
                {edit ? editorFor(edit) : <p ref={emptyRef} tabIndex={-1} className="cw-side-empty">Select a bot to change its look, persona and agent, or add a new one.</p>}
              </aside>
            )}
          </div>
        )}
      </Loading>

      {phone ? (
        <Drawer open={!!edit} onOpenChange={(o) => !o && closeDrawer()}>
          <DrawerContent side="right" title={isNew ? 'New bot' : `Edit ${shown?.name ?? ''}`}>
            {shown ? <div className="cw-side">{editorFor(shown)}</div> : null}
          </DrawerContent>
        </Drawer>
      ) : null}

      <Drawer open={!!evolving} onOpenChange={(o) => !o && setEvolving(null)}>
        <DrawerContent side="right" title={`Evolve ${evolveShown?.name ?? ''}`}>
          {evolveShown ? <EvolvePanel key={evolveShown.role} inDrawer bot={evolveShown.role} name={evolveShown.name} onClose={() => setEvolving(null)} onChange={() => void loadDefs().catch((e: unknown) => setLoadErr((e as Error).message))} /> : null}
        </DrawerContent>
      </Drawer>

      <Dialog open={importing} onOpenChange={(o) => !importBusy && setImporting(o)}>
        <DialogContent
          title="Import ECC"
          description="Adds ECC's agents as crew bots and its skills and commands to the skills list. Hooks and rules are not imported. Source: github.com/affaan-m/ECC (MIT)."
        >
          <p className="sl-meta">{`Version ${meta.ecc?.ref ? `${meta.ecc.ref} → ` : ''}${meta.eccDefault}`}</p>
          <div className="cw-actions">
            <Button variant="secondary" disabled={importBusy} onClick={() => setImporting(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={importBusy} onClick={() => void importEcc()}>
              Import
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent title={`Discard your changes to ${edit?.name || 'the new bot'}?`} description="They are not saved.">
          <div className="cw-actions">
            <Button variant="secondary" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const fn = pending;
                setPending(null);
                fn?.();
              }}
            >
              Discard
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
