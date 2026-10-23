import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type VaultGraph, type VaultNote } from './api';
import { Badge } from './components/arc/badge/badge';
import { Button } from './components/arc/button/button';
import { EmptyState } from './components/arc/empty-state/empty-state';
import { SearchField } from './components/arc/search-field/search-field';
import { H, W, layout } from './graphLayout';
import { cn } from './ui/cn';

const TYPES = ['run', 'pipeline', 'role', 'file', 'note'];

export function GraphView() {
  const [g, setG] = useState<VaultGraph>();
  const [sel, setSel] = useState<string>();
  const [note, setNote] = useState<VaultNote>();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Set<string>>(new Set());
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [err, setErr] = useState<string>();
  const svg = useRef<SVGSVGElement>(null);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | undefined>(undefined);

  const pos = useMemo(() => (g ? layout(g.nodes, g.edges) : new Map<string, { x: number; y: number }>()), [g]);
  const typeOf = (t?: string) => (t && TYPES.includes(t) ? t : 'note');
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of g?.nodes ?? []) c[typeOf(n.type)] = (c[typeOf(n.type)] ?? 0) + 1;
    return c;
  }, [g]);
  const neighbors = useMemo(() => {
    const set = new Set<string>();
    if (sel) for (const e of g?.edges ?? []) (e.from === sel && set.add(e.to), e.to === sel && set.add(e.from));
    return set;
  }, [g, sel]);

  async function load() {
    try {
      setErr(undefined);
      setG(await api<VaultGraph>('GET', '/api/vault/graph'));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function open(path: string) {
    setSel(path);
    try {
      setNote(await api<VaultNote>('GET', `/api/vault/note?path=${encodeURIComponent(path)}`));
    } catch {
      setNote(undefined);
    }
  }
  async function search() {
    if (!q.trim()) return setHits(new Set<string>());
    try {
      const r = await api<{ path: string }[]>('GET', `/api/vault/search?q=${encodeURIComponent(q)}`);
      setHits(new Set(r.map((x) => x.path)));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    const el = svg.current!;
    const toSvg = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return { x: ((cx - r.left) / r.width) * W, y: ((cy - r.top) / r.height) * H };
    };
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      setView((v) => {
        const k = Math.min(4, Math.max(0.4, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: p.x - ((p.x - v.x) / v.k) * k, y: p.y - ((p.y - v.y) / v.k) * k };
      });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const label = (id: string, deg: number) => deg >= 3 || sel === id || hits.has(id) || neighbors.has(id) || view.k > 1.6;

  return (
    <div className="graph-view">
      <div className="graph-main">
        <div className="toolbar">
          <SearchField
            label="Search the vault"
            value={q}
            onValueChange={(v) => {
              setQ(v);
              if (!v) setHits(new Set<string>());
            }}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
            placeholder="Search the vault…"
          />
          <Button variant="secondary" onClick={() => void search()}>
            Search
          </Button>
          <span className="spacer" />
          {TYPES.filter((t) => counts[t]).map((t) => (
            <span key={t} className="legend">
              <i className={`node-dot t-${t}`} /> {t} <Badge size="sm">{counts[t]}</Badge>
            </span>
          ))}
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
        {err ? <div className="alert error">{err}</div> : null}
        {g && g.nodes.length === 0 ? (
          <EmptyState title="The vault is empty" description="Finish a run and its notes appear here, linked to the pipeline, roles and files it touched." />
        ) : null}
        <svg
          ref={svg}
          className="graph-svg"
          viewBox={`0 0 ${W} ${H}`}
          onPointerDown={(e) => {
            if ((e.target as Element).closest('[data-gn]')) return;
            svg.current!.setPointerCapture(e.pointerId);
            pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
          }}
          onPointerMove={(e) => {
            const p = pan.current;
            if (!p) return;
            const r = svg.current!.getBoundingClientRect();
            const dx = ((e.clientX - p.sx) / r.width) * W, dy = ((e.clientY - p.sy) / r.height) * H;
            if (Math.abs(dx) + Math.abs(dy) > 2) p.moved = true;
            setView((v) => ({ ...v, x: p.vx + dx, y: p.vy + dy }));
          }}
          onPointerUp={() => {
            if (pan.current && !pan.current.moved) (setSel(undefined), setNote(undefined));
            pan.current = undefined;
          }}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {(g?.edges ?? []).map((e) => {
              const a = pos.get(e.from), b = pos.get(e.to);
              return a && b ? (
                <line key={`${e.from}→${e.to}`} className={cn('g-edge', { hot: sel === e.from || sel === e.to })} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              ) : null;
            })}
            {(g?.nodes ?? []).map((n) => {
              const p = pos.get(n.id);
              const r = 5 + Math.sqrt(n.degree) * 2.4;
              return p ? (
                <g
                  key={n.id}
                  data-gn
                  className={cn(`g-node t-${typeOf(n.type)}`, {
                    sel: sel === n.id,
                    hit: hits.has(n.id),
                    dim: (sel !== undefined && sel !== n.id && !neighbors.has(n.id)) || (hits.size > 0 && !hits.has(n.id)),
                  })}
                  transform={`translate(${p.x} ${p.y})`}
                  onClick={() => void open(n.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={n.title}
                  onKeyDown={(e) => e.key === 'Enter' && void open(n.id)}
                >
                  <circle r={r} />
                  {label(n.id, n.degree) ? (
                    <text y={r + 12} textAnchor="middle">
                      {n.title.length > 26 ? n.title.slice(0, 25) + '…' : n.title}
                    </text>
                  ) : null}
                </g>
              ) : null;
            })}
          </g>
        </svg>
        {g ? (
          <p className="muted small pad">
            {g.nodes.length} notes · {g.edges.length} links{g.unresolved ? ` · ${g.unresolved} unresolved` : ''} · scroll to zoom, drag to pan
          </p>
        ) : null}
      </div>

      <aside className="note-panel">
        {note ? (
          <>
            <h4>
              {note.title} <Badge size="sm">{note.type ?? 'note'}</Badge>
            </h4>
            <p className="muted small">
              <code>{note.path}</code>
            </p>
            <pre className="out note-body">{note.body.slice(0, 6000)}</pre>
            {note.backlinks.length ? (
              <>
                <h5>Linked from</h5>
                <ul className="links">
                  {note.backlinks.map((b) => (
                    <li key={b}>
                      <button className="link" onClick={() => void open(b)}>
                        {b.replace(/\.md$/, '')}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {note.links.length ? (
              <>
                <h5>Links to</h5>
                <ul className="links">
                  {[...new Set(note.links)].map((l) => (
                    <li key={l}>
                      <button className="link" onClick={() => void open(l.endsWith('.md') ? l : `${l}.md`)}>
                        {l}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : (
          <p className="muted pad">Select a note to read it and see what links to it.</p>
        )}
      </aside>
    </div>
  );
}
