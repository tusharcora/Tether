import { Ellipsis } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCreateIntent } from './ui/useCreateIntent';
import { api, type RunRow } from './api';
import { Button } from './components/beui/kit/Button';
import { Dialog, DialogContent, Drawer, DrawerContent, useDrawerItem } from './components/beui/kit/overlays';
import { Loading } from './components/Loading';
import { Bench } from './crew/Bench';
import { BotEditor } from './crew/BotEditor';
import { canPlay, playAs } from './crew/roles';
import { Slot } from './crew/Lineup';
import { RunsOn } from './crew/RunsOn';
import { AgentProfile } from './teams/AgentProfile';
import { SwapPicker } from './crew/SwapPicker';
import type { AgentInfo, Binding, CrewReply, Filter, ImportReply, Meta, Pack, Row } from './crew/types';
import { applyCrew, loadCrewDefs, type BotDef, type FaceLook } from './crewStore';
import { EvolvePanel } from './Evolve';
import { Face } from './Face';
import { busyBots } from './home/runText';
import { usePoll } from './hooks';
import { cn } from './ui/cn';
import { useNotify } from './ui/notify';
import { InlineError } from './ui/studio/InlineError';
import { Dock, FloatBar, MenuButton, ToolScreen, type MenuItem } from './ui/studio/ToolFrame';
import './crew/crew.css';

/** Face colours for a new bot. Faces are identity art, exempt from the no-purple rule (see rules.test.ts). */
const SWATCH = ['#5b9dff', '#38c5d6', '#6ee7a8', '#f2c14e', '#ff8a5b', '#ff6b8a', '#b58bff', '#c9a46a'];
const blank = (): BotDef => ({ id: '', name: '', title: '', kind: 'agent', persona: '', look: { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: SWATCH[Math.floor(Math.random() * SWATCH.length)]!, accent: 'auto' } });
const slug = (n: string) => (n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 20) || 'bot');
const NO_BINDING: Binding = { agent: '', model: '', toolStyle: 'code', codeReads: false };
/** Bots that can be team agents (spec Teams §6.1): those that call a model or run a command, not a person or Tether. */
const TEAM_KINDS = new Set(['agent', 'verdict', 'gate']);
const bindingOf = (b: Row['binding']): Binding => ({ agent: b?.agent ?? '', model: b?.model ?? '', toolStyle: b?.toolStyle ?? 'code', codeReads: !!b?.codeReads });

export function Crew(props: { bot?: string; onBot?: (id?: string) => void; /** The Create menu asked for a new bot (a counter). */ create?: number }) {
  const notify = useNotify();
  const [rows, setRows] = useState<Row[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentInfo>>({});
  const [draft, setDraft] = useState<Record<string, Binding>>({});
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  // after one good load a failed refresh keeps the board and shows a compact retry above it
  const [loaded, setLoaded] = useState(false);
  const gridRef = useRef<HTMLElement>(null);
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
  const [library, setLibrary] = useState(true);
  const [packsOpen, setPacksOpen] = useState(false);
  const [removingEcc, setRemovingEcc] = useState(false);
  /** The library bot being dragged, the role whose Swap… picker is open, and the "now plays" note with its Undo. */
  const [dragging, setDragging] = useState<string>();
  const [swapFor, setSwapFor] = useState<BotDef>();
  const [note, setNote] = useState<{ text: string; undo: () => Promise<void> }>();
  /** Who is working now: bots of running steps in live runs (read only, as Home's crew strip). */
  const runs = usePoll<RunRow[]>('/api/runs', 5000);
  // the Evolve drawer keeps showing its last bot while it slides out
  const evolveShown = useDrawerItem(evolving);
  const dirty = !!edit && JSON.stringify(edit) !== base.current;

  const cur = useRef({ sel, dirty });
  cur.current = { sel, dirty };
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
  useCreateIntent(props.create, !loading, newBot);
  const cancelEdit = () => {
    const d = !isNew && sel ? defs.find((x) => x.id === sel) : undefined;
    if (d) open(d);
    else setEdit(null);
  };
  const closeCard = () =>
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
  // after Delete / Reset closes the card, focus goes to the first role, not the page body
  useEffect(() => {
    if (refocus) gridRef.current?.querySelector<HTMLElement>('.cw-slot-main')?.focus();
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

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(undefined), 8000);
    return () => clearTimeout(t);
  }, [note]);
  /** After a role changes, the card shows the new identity if it is open on that role (and, for Undo, holds no new edits). */
  const reload = async (id: string, force: boolean) => {
    const [fresh] = await Promise.all([load(), loadCrewDefs(true)]);
    const d = fresh?.find((x) => x.id === id);
    if (d && cur.current.sel === id && (force || !cur.current.dirty)) open(d);
  };
  /**
   * A library bot plays a built-in role (§15.1): the role's existing identity override takes the bot's name, persona and look
   * (agent and model stay as linked). Undo puts the earlier override back, or deletes the new one when there was none.
   */
  async function play(slot: BotDef, bench: BotDef) {
    try {
      await api('PUT', `/api/crew/${slot.id}`, playAs(slot, bench));
    } catch (e) {
      return notify.fail(e);
    }
    const undo = async () => {
      setNote(undefined);
      try {
        if (slot.edited) await api('PUT', `/api/crew/${slot.id}`, slot);
        else await api('DELETE', `/api/crew/${slot.id}`);
      } catch (e) {
        notify.fail(e);
      }
      await reload(slot.id, false);
    };
    setNote({ text: `${bench.name} now plays ${slot.title}. Applies to the next run.`, undo });
    await reload(slot.id, true);
  }
  /** A drop or a Swap… pick: when the role is open with unsaved edits, ask first. */
  const link = (slot: BotDef, bench: BotDef) => (sel === slot.id ? guard : (f: () => void) => f())(() => void play(slot, bench));
  const dragged = defs.find((d) => d.id === dragging);

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

  const selRow = rows.find((r) => r.role === sel);
  const evolvable = !!selRow && (selRow.kind === 'agent' || selRow.kind === 'verdict');
  const builtins = defs.filter((d) => d.builtin);
  const bench = defs.filter((d) => !d.builtin);
  const busy = busyBots(runs.data ?? []);
  const working = builtins.filter((d) => busy.has(d.id)).length;
  const actions: (MenuItem | 'rule')[] = [
    { label: 'Crew packs…', onSelect: () => setPacksOpen(true) },
    { label: 'Evolve…', disabled: !evolvable, onSelect: () => selRow && setEvolving(selRow) },
    'rule',
    { label: meta.ecc ? 'Update ECC…' : 'Import ECC…', onSelect: () => setImporting(true) },
    ...(meta.ecc ? [{ label: 'Remove ECC…', danger: true, onSelect: () => setRemovingEcc(true) }] : []),
  ];

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
          readOnly={b.readOnly}
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
      {!isNew && selRow && TEAM_KINDS.has(b.kind) ? <AgentProfile key={selRow.role} bot={selRow.role} name={b.name} title={b.title} /> : null}
      {!isNew && evolvable ? (
        <div className="cw-actions">
          <Button variant="secondary" size="sm" onClick={() => setEvolving(selRow)}>
            {evo[selRow.role]?.open ? `Evolve · ${evo[selRow.role]!.open} open proposal${evo[selRow.role]!.open === 1 ? '' : 's'}` : 'Evolve'}
          </Button>
        </div>
      ) : null}
    </>
  );

  return (
    <ToolScreen className={cn('cw-screen', { docked: !!edit, lib: library })}>
      <Loading className="cw-load" loading={loading} lines={6} label="Checking which agents are installed">
        <div className="cw-lineup">
          {loadErr ? <InlineError compact={loaded} message={loadErr} onRetry={() => void load()} /> : null}
          {missing ? (
            <p className="sl-note" role="status">
              No bot called “{missing}”.
            </p>
          ) : null}
          {loadErr && !loaded ? null : (
            <section ref={gridRef} className="cw-slots" aria-label="Roles">
              {builtins.map((d) => {
                const row = rows.find((r) => r.role === d.id);
                const a = row?.binding ? agents[row.binding.agent] : undefined;
                return (
                  <Slot
                    key={d.id}
                    def={d}
                    row={row}
                    busy={busy.has(d.id)}
                    proposals={evo[d.id]?.open ?? 0}
                    agentMissing={!!a && !a.ok}
                    selected={sel === d.id}
                    fit={dragged ? (canPlay(dragged, d) ? 'ok' : 'no') : 'none'}
                    onPick={() => pick(d.id)}
                    onSwap={d.kind === 'approval' ? undefined : () => setSwapFor(d)}
                    onDrop={() => (setDragging(undefined), dragged && link(d, dragged))}
                  />
                );
              })}
            </section>
          )}
        </div>
      </Loading>

      <FloatBar at="left">
        <h1 className="cw-title">Crew</h1>
        <span className="cw-fact">{`${builtins.length} role${builtins.length === 1 ? '' : 's'} · ${working} working`}</span>
      </FloatBar>
      <FloatBar at="right">
        <Button variant="secondary" size="sm" aria-pressed={library} onClick={() => setLibrary(!library)}>
          Library <span className="cw-count">{bench.length}</span>
        </Button>
        <MenuButton title="More crew actions" align="end" label={<Ellipsis size={16} aria-hidden="true" />} items={actions} />
        <Button variant="primary" size="sm" onClick={newBot}>
          + New bot
        </Button>
      </FloatBar>
      {library && !loading && !(loadErr && !loaded) ? <Bench bots={bench} filter={filter} onFilter={setFilter} q={q} onQ={setQ} selected={sel} onPick={pick} onDrag={setDragging} /> : null}
      {note ? (
        <div className="cw-note" role="status">
          <span>{note.text}</span>
          <button type="button" onClick={() => void note.undo()}>
            Undo
          </button>
        </div>
      ) : null}
      <SwapPicker slot={swapFor} bots={bench} onClose={() => setSwapFor(undefined)} onPick={(b) => (setSwapFor(undefined), swapFor && link(swapFor, b))} />
      {edit ? (
        <Dock label="Bot card" onClose={closeCard}>
          {editorFor(edit)}
        </Dock>
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

      <Dialog open={packsOpen} onOpenChange={setPacksOpen}>
        <DialogContent title="Crew packs" description="Ready-made sets of bots to add to your crew.">
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
        </DialogContent>
      </Dialog>

      <Dialog open={removingEcc} onOpenChange={setRemovingEcc}>
        <DialogContent title="Remove ECC?" description="Remove every ECC bot and the vendored checkout?">
          <div className="cw-actions">
            <Button variant="secondary" onClick={() => setRemovingEcc(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => (setRemovingEcc(false), void removeEcc())}>
              Remove
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
    </ToolScreen>
  );
}
