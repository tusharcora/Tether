import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ago, api, ApiError, type VaultGraph, type VaultNote } from './api';
import { Button } from './components/arc/button/button';
import { SearchField } from './components/arc/search-field/search-field';
import { Loading, useReducedMotionPref } from './components/Loading';
import { GraphBoard, type BoardHandle } from './graph/GraphBoard';
import { adjacency, GLYPH, matchLocal, neighbourhood, TYPE_LABEL, TYPES, typeOf, type GraphType } from './graph/graphModel';
import { NoteList } from './graph/NoteList';
import { NoteReader, type ReaderLink } from './graph/NoteReader';
import { useVaultActivity } from './graph/useVaultActivity';
import { cn } from './ui/cn';
import { EmptyState } from './ui/studio/EmptyState';
import { InlineError } from './ui/studio/InlineError';
import { ScreenHeader } from './ui/studio/ScreenHeader';
import './graph/graph.css';

/** The server caches its vault scan for 5 s: a note a run just wrote is looked for again after that. */
export const VAULT_SCAN_MS = 5500;
type NoteState = 'idle' | 'loading' | 'missing' | 'failed';

/** The knowledge graph: a live board of vault notes, a reader and a list. `note` is the deep-linked path. */
export function GraphView(props: { note?: string; onNote?: (path?: string) => void; /** Open a file note's file in Code. */ onOpenFile?: (path: string) => void }) {
  const reduced = useReducedMotionPref();
  const activity = useVaultActivity();
  const board = useRef<BoardHandle>(null);
  const opened = useRef(0);
  const [g, setG] = useState<VaultGraph>();
  const [err, setErr] = useState<string>();
  const [sel, setSel] = useState<string>();
  const [note, setNote] = useState<VaultNote>();
  const [noteState, setNoteState] = useState<NoteState>('idle');
  const [hover, setHover] = useState<string>();
  const [depth, setDepth] = useState(1);
  const [hidden, setHidden] = useState<ReadonlySet<GraphType>>(() => new Set());
  const [q, setQ] = useState('');
  const [serverHits, setServerHits] = useState<ReadonlySet<string>>(() => new Set());
  const [searchFailed, setSearchFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setErr(undefined);
      setG(await api<VaultGraph>('GET', '/api/vault/graph'));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const ids = useMemo(() => new Set((g?.nodes ?? []).map((n) => n.id)), [g]);
  const byId = useMemo(() => new Map((g?.nodes ?? []).map((n) => [n.id, n])), [g]);
  const adj = useMemo(() => adjacency(g?.edges ?? []), [g]);
  const focus = hover ?? sel;
  const near = useMemo(() => neighbourhood(adj, focus && ids.has(focus) ? focus : undefined, depth), [adj, focus, ids, depth]);
  const local = useMemo(() => matchLocal(g?.nodes ?? [], q), [g, q]);
  const hits = useMemo(() => new Set([...local, ...[...serverHits].filter((h) => ids.has(h))]), [local, serverHits, ids]);
  /** While searching, the All notes list shows only the matches (by title, as the list sorts). */
  const matched = useMemo(() => (q.trim() ? (g?.nodes ?? []).filter((n) => hits.has(n.id)).sort((a, b) => a.title.localeCompare(b.title)) : undefined), [g, q, hits]);
  const fresh = useMemo(() => new Set([...activity.fresh].filter((p) => ids.has(p))), [activity.fresh, ids]);
  const counts = useMemo(() => {
    const c: Partial<Record<GraphType, number>> = {};
    for (const n of g?.nodes ?? []) c[typeOf(n.type)] = (c[typeOf(n.type)] ?? 0) + 1;
    return c;
  }, [g]);

  const open = useCallback(async (path: string) => {
    const token = ++opened.current;
    setSel(path);
    setNoteState('loading');
    try {
      const n = await api<VaultNote>('GET', `/api/vault/note?path=${encodeURIComponent(path)}`);
      if (opened.current !== token) return;
      setNote(n);
      setNoteState('idle');
    } catch (e) {
      if (opened.current !== token) return;
      setNote(undefined);
      setNoteState(e instanceof ApiError && e.status === 404 ? 'missing' : 'failed');
    }
  }, []);
  const clear = () => {
    opened.current++;
    setSel(undefined);
    setNote(undefined);
    setNoteState('idle');
  };
  const select = (path?: string) => {
    if (path === sel) return;
    props.onNote?.(path);
    if (path) void open(path);
    else clear();
  };
  /** Select a note and glide to it, turning its type back on if it was hidden. */
  const go = (path: string) => {
    const t = typeOf(byId.get(path)?.type);
    if (hidden.has(t))
      setHidden((h) => {
        const next = new Set(h);
        next.delete(t);
        return next;
      });
    select(path);
    board.current?.focus(path);
  };
  const toggleType = (t: GraphType) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  // the deep link: open the note it names; Back to #/graph clears the selection
  useEffect(() => {
    if (props.note && props.note !== sel) void open(props.note);
    else if (!props.note && sel && props.onNote) clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.note]);

  // search: title and tag matches at once, full-text hits shortly after; then fly to the first
  useEffect(() => {
    const query = q.trim();
    setSearchFailed(false);
    if (!query) {
      setServerHits(new Set());
      return;
    }
    let live = true;
    const h = setTimeout(async () => {
      let found: string[] = [];
      try {
        found = (await api<{ path: string }[]>('GET', `/api/vault/search?q=${encodeURIComponent(query)}`)).map((x) => x.path);
      } catch {
        if (live) setSearchFailed(true);
      }
      if (!live) return;
      setServerHits(new Set(found));
      const first = [...matchLocal(g?.nodes ?? [], query), ...found].find((x) => ids.has(x));
      if (first) board.current?.focus(first);
    }, 300);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [q, g, ids]);

  // a run wrote a note this graph does not have yet: look again once the server's scan cache has expired
  const latest = activity.latest;
  // (every fresh path counts, not only the newest: one poll can bring several writes)
  const unknown = g ? [...activity.fresh].filter((path) => !ids.has(path)).sort().join('\n') : '';
  useEffect(() => {
    if (!unknown) return;
    const h = setTimeout(() => void load(), VAULT_SCAN_MS);
    return () => clearTimeout(h);
  }, [unknown, load]);

  const links: ReaderLink[] =
    g && sel
      ? [...g.edges.filter((e) => e.from === sel).map((e) => ({ id: e.to, dir: '→' as const })), ...g.edges.filter((e) => e.to === sel).map((e) => ({ id: e.from, dir: '←' as const }))].flatMap((l) => {
          const n = byId.get(l.id);
          return n ? [{ ...l, title: n.title, type: typeOf(n.type) }] : [];
        })
      : [];

  return (
    <div className="gv-page">
      <ScreenHeader
        meta={g ? `vault · ${g.nodes.length} notes · ${g.edges.length} links${g.unresolved ? ` · ${g.unresolved} unresolved` : ''}` : 'vault'}
        title="Knowledge graph"
        actions={
          <>
            <div className="gv-search">
              <SearchField
                label="Search the vault"
                value={q}
                onValueChange={setQ}
                placeholder="Titles, tags and text"
                onKeyDown={(e) => {
                  const first = matched?.[0];
                  if (e.key === 'Enter' && first) go(first.id);
                }}
              />
              {q.trim() ? (
                <span className="gv-found" role="status">
                  {hits.size} found
                </span>
              ) : null}
            </div>
            {g ? (
              <div className="gv-types" role="group" aria-label="Show note types">
                {TYPES.filter((t) => counts[t]).map((t) => (
                  <button key={t} type="button" aria-pressed={!hidden.has(t)} onClick={() => toggleType(t)}>
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                      <path d={GLYPH[t]} className={cn('gv-glyph', { hollow: t === 'note' })} />
                    </svg>
                    {TYPE_LABEL[t]} <span className="gv-count">{counts[t]}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <Button variant="secondary" onClick={() => void load()}>
              Reload
            </Button>
          </>
        }
      />
      {err ? <InlineError message={err} onRetry={() => void load()} /> : null}
      {searchFailed ? (
        <p className="sl-note gv-search-note" role="status">
          Full-text search failed; showing title and tag matches.
        </p>
      ) : null}
      <Loading className="gv-load" loading={!g && !err} lines={8} label="Loading the vault">
        {g && g.nodes.length === 0 ? (
          <EmptyState title="The vault is empty" description="Finish a run and its notes appear here, linked to the pipeline, roles and files it touched." />
        ) : g ? (
          <div className="gv-body">
            <GraphBoard
              ref={board}
              graph={g}
              hiddenTypes={hidden}
              selected={sel}
              focus={focus}
              near={near}
              hits={hits}
              fresh={fresh}
              reduced={reduced}
              initialFocus={props.note}
              onHover={setHover}
              onSelect={select}
              onOpen={go}
            >
              <div className="gv-hops" role="group" aria-label="How far highlights reach">
                <span>{depth === 1 ? 'showing direct links' : `showing ${depth} hops`}</span>
                <button type="button" aria-label="Fewer hops" disabled={depth <= 1} onClick={() => setDepth(depth - 1)}>
                  −
                </button>
                <button type="button" aria-label="More hops" disabled={depth >= 3} onClick={() => setDepth(depth + 1)}>
                  +
                </button>
              </div>
              {latest ? (
                <div key={latest.id} className="gv-ticker" role="status">
                  <span className="gv-ticker-dot" aria-hidden="true" />
                  <span>
                    {latest.run} recorded {byId.get(latest.path)?.title ?? latest.path}
                  </span>
                  <span className="gv-ticker-age">{ago(latest.ts)}</span>
                </div>
              ) : null}
            </GraphBoard>
            <aside className="gv-side" aria-label="Note">
              <NoteReader
                path={sel}
                note={note}
                state={noteState}
                missing={!!sel && !ids.has(sel)}
                degree={sel ? byId.get(sel)?.degree : undefined}
                touch={sel ? activity.last.get(sel) : undefined}
                fresh={!!sel && fresh.has(sel)}
                links={links}
                onTag={(t) => setQ(`#${t}`)}
                onGo={go}
                onHover={setHover}
                onRetry={() => sel && void open(sel)}
                onOpenFile={props.onOpenFile}
              />
              <NoteList nodes={matched ?? g.nodes} selected={sel} hiddenTypes={hidden} onGo={go} />
            </aside>
          </div>
        ) : null}
      </Loading>
    </div>
  );
}
