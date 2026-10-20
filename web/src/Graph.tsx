import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { api, type VaultGraph, type VaultNote } from './api';

const W = 1000;
const H = 640;

/** Fruchterman–Reingold layout. Deterministic (seeded circle start) so the picture is stable between loads. */
export function layout(nodes: { id: string }[], edges: { from: string; to: string }[]): Map<string, { x: number; y: number }> {
  const n = nodes.length;
  const pos = new Map<string, { x: number; y: number }>();
  if (!n) return pos;
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const px = new Float64Array(n), py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 120 + ((i * 53) % 90);
    px[i] = W / 2 + Math.cos(a) * r;
    py[i] = H / 2 + Math.sin(a) * r;
  }
  const es = edges.map((e) => [idx.get(e.from), idx.get(e.to)] as const).filter((e): e is readonly [number, number] => e[0] !== undefined && e[1] !== undefined);
  const k = Math.sqrt((W * H) / n) * 0.65;
  const iters = n > 500 ? 90 : n > 200 ? 160 : 300;
  const dx = new Float64Array(n), dy = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        let ex = px[i]! - px[j]!, ey = py[i]! - py[j]!;
        let d = Math.hypot(ex, ey);
        if (d < 0.01) (ex = 0.1 * ((i % 3) - 1 || 1), ey = 0.1, (d = 0.15));
        const f = (k * k) / d / d;
        dx[i]! += ex * f; dy[i]! += ey * f;
        dx[j]! -= ex * f; dy[j]! -= ey * f;
      }
    for (const [a, b] of es) {
      const ex = px[a]! - px[b]!, ey = py[a]! - py[b]!;
      const d = Math.hypot(ex, ey) || 0.01;
      const f = d / k;
      dx[a]! -= ex * f; dy[a]! -= ey * f;
      dx[b]! += ex * f; dy[b]! += ey * f;
    }
    const t = (W / 8) * (1 - it / iters) + 1;
    for (let i = 0; i < n; i++) {
      dx[i]! += (W / 2 - px[i]!) * 0.012;
      dy[i]! += (H / 2 - py[i]!) * 0.012;
      const m = Math.hypot(dx[i]!, dy[i]!) || 1;
      const s = Math.min(m, t) / m;
      px[i]! += dx[i]! * s;
      py[i]! += dy[i]! * s;
    }
  }
  nodes.forEach((nd, i) => pos.set(nd.id, { x: px[i]!, y: py[i]! }));
  return pos;
}

const TYPES = ['run', 'pipeline', 'role', 'file', 'note'];

export function GraphView() {
  const [g, setG] = createSignal<VaultGraph>();
  const [sel, setSel] = createSignal<string>();
  const [note, setNote] = createSignal<VaultNote>();
  const [q, setQ] = createSignal('');
  const [hits, setHits] = createSignal<Set<string>>(new Set());
  const [view, setView] = createSignal({ x: 0, y: 0, k: 1 });
  const [err, setErr] = createSignal<string>();
  let svg!: SVGSVGElement;
  let pan: { sx: number; sy: number; vx: number; vy: number; moved: boolean } | undefined;

  const pos = createMemo(() => (g() ? layout(g()!.nodes, g()!.edges) : new Map()));
  const typeOf = (t?: string) => (t && TYPES.includes(t) ? t : 'note');
  const counts = createMemo(() => {
    const c: Record<string, number> = {};
    for (const n of g()?.nodes ?? []) c[typeOf(n.type)] = (c[typeOf(n.type)] ?? 0) + 1;
    return c;
  });
  const neighbors = createMemo(() => {
    const s = sel();
    const set = new Set<string>();
    if (s) for (const e of g()?.edges ?? []) (e.from === s && set.add(e.to), e.to === s && set.add(e.from));
    return set;
  });

  async function load() {
    try {
      setErr(undefined);
      setG(await api<VaultGraph>('GET', '/api/vault/graph'));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  onMount(load);

  async function open(path: string) {
    setSel(path);
    try {
      setNote(await api<VaultNote>('GET', `/api/vault/note?path=${encodeURIComponent(path)}`));
    } catch {
      setNote(undefined);
    }
  }
  async function search() {
    if (!q().trim()) return setHits(new Set<string>());
    try {
      const r = await api<{ path: string }[]>('GET', `/api/vault/search?q=${encodeURIComponent(q())}`);
      setHits(new Set(r.map((x) => x.path)));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const toSvg = (cx: number, cy: number) => {
    const r = svg.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * W, y: ((cy - r.top) / r.height) * H };
  };
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const v = view();
    const p = toSvg(e.clientX, e.clientY);
    const k = Math.min(4, Math.max(0.4, v.k * Math.exp(-e.deltaY * 0.0015)));
    setView({ k, x: p.x - ((p.x - v.x) / v.k) * k, y: p.y - ((p.y - v.y) / v.k) * k });
  }
  onMount(() => svg.addEventListener('wheel', onWheel, { passive: false }));

  const label = (id: string, deg: number, title: string) => deg >= 3 || sel() === id || hits().has(id) || neighbors().has(id) || view().k > 1.6;

  return (
    <div class="graph-view">
      <div class="graph-main">
        <div class="toolbar">
          <input class="search" placeholder="Search the vault…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
          <button onClick={search}>Search</button>
          <button onClick={() => (setQ(''), setHits(new Set<string>()))} disabled={!q() && hits().size === 0}>Clear</button>
          <span class="spacer" />
          <For each={TYPES.filter((t) => counts()[t])}>
            {(t) => (
              <span class="legend">
                <i class={`node-dot t-${t}`} /> {t} {counts()[t]}
              </span>
            )}
          </For>
          <button onClick={load}>Refresh</button>
        </div>
        <Show when={err()}><div class="alert error">{err()}</div></Show>
        <Show when={g() && g()!.nodes.length === 0}>
          <div class="placeholder">The vault is empty. Finish a run and its notes appear here, linked to the pipeline, roles and files it touched.</div>
        </Show>
        <svg
          ref={svg}
          class="graph-svg"
          viewBox={`0 0 ${W} ${H}`}
          onPointerDown={(e) => {
            if ((e.target as Element).closest('[data-gn]')) return;
            svg.setPointerCapture(e.pointerId);
            pan = { sx: e.clientX, sy: e.clientY, vx: view().x, vy: view().y, moved: false };
          }}
          onPointerMove={(e) => {
            if (!pan) return;
            const r = svg.getBoundingClientRect();
            const dx = ((e.clientX - pan.sx) / r.width) * W, dy = ((e.clientY - pan.sy) / r.height) * H;
            if (Math.abs(dx) + Math.abs(dy) > 2) pan.moved = true;
            setView({ ...view(), x: pan.vx + dx, y: pan.vy + dy });
          }}
          onPointerUp={() => {
            if (pan && !pan.moved) (setSel(undefined), setNote(undefined));
            pan = undefined;
          }}
        >
          <g transform={`translate(${view().x} ${view().y}) scale(${view().k})`}>
            <For each={g()?.edges ?? []}>
              {(e) => {
                const a = () => pos().get(e.from), b = () => pos().get(e.to);
                return (
                  <Show when={a() && b()}>
                    <line class="g-edge" classList={{ hot: sel() === e.from || sel() === e.to }} x1={a()!.x} y1={a()!.y} x2={b()!.x} y2={b()!.y} />
                  </Show>
                );
              }}
            </For>
            <For each={g()?.nodes ?? []}>
              {(n) => {
                const p = () => pos().get(n.id);
                const r = () => 5 + Math.sqrt(n.degree) * 2.4;
                return (
                  <Show when={p()}>
                    <g
                      data-gn
                      class={`g-node t-${typeOf(n.type)}`}
                      classList={{ sel: sel() === n.id, hit: hits().has(n.id), dim: (sel() !== undefined && sel() !== n.id && !neighbors().has(n.id)) || (hits().size > 0 && !hits().has(n.id)) }}
                      transform={`translate(${p()!.x} ${p()!.y})`}
                      onClick={() => open(n.id)}
                      tabindex="0"
                      role="button"
                      aria-label={n.title}
                      onKeyDown={(e) => e.key === 'Enter' && open(n.id)}
                    >
                      <circle r={r()} />
                      <Show when={label(n.id, n.degree, n.title)}>
                        <text y={r() + 12} text-anchor="middle">{n.title.length > 26 ? n.title.slice(0, 25) + '…' : n.title}</text>
                      </Show>
                    </g>
                  </Show>
                );
              }}
            </For>
          </g>
        </svg>
        <Show when={g()}>
          <p class="muted small pad">
            {g()!.nodes.length} notes · {g()!.edges.length} links{g()!.unresolved ? ` · ${g()!.unresolved} unresolved` : ''} · scroll to zoom, drag to pan
          </p>
        </Show>
      </div>

      <aside class="note-panel">
        <Show when={note()} fallback={<p class="muted pad">Select a note to read it and see what links to it.</p>}>
          {(n) => (
            <>
              <h4>
                {n().title} <span class="chip">{n().type ?? 'note'}</span>
              </h4>
              <p class="muted small">
                <code>{n().path}</code>
              </p>
              <pre class="out note-body">{n().body.slice(0, 6000)}</pre>
              <Show when={n().backlinks.length}>
                <h5>Linked from</h5>
                <ul class="links">
                  <For each={n().backlinks}>{(b) => <li><button class="link" onClick={() => open(b)}>{b.replace(/\.md$/, '')}</button></li>}</For>
                </ul>
              </Show>
              <Show when={n().links.length}>
                <h5>Links to</h5>
                <ul class="links">
                  <For each={[...new Set(n().links)]}>{(l) => <li><button class="link" onClick={() => open(l.endsWith('.md') ? l : `${l}.md`)}>{l}</button></li>}</For>
                </ul>
              </Show>
            </>
          )}
        </Show>
      </aside>
    </div>
  );
}
