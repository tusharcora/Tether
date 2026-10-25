# Studio Live Restyle, Plan A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Studio Live the app-wide look of the aorch dashboard (root tokens, theme following the OS, on-rule parity for the screens not yet rebuilt), replace the tab strip with the rail shell, add the Home dashboard with its four read-only endpoints, and rebuild Runs on the shared Studio parts.

**Architecture:** One global switch: the Studio tokens and the Arc/aorch bridge move from `.studio` to the document root (winning by specificity, not file order), and a parity pass keeps Builder, Graph, Crew, Triggers, the Evolve drawer and the Team panel legible and on-rule. A small set of shared parts in `web/src/ui/studio/` builds the shell, Home (`web/src/home/*`) and Runs (`web/src/runs/*`). The server gains pure read-model modules (`src/runRows.ts`, `src/attention.ts`, `src/activity.ts`, `src/rosterPreview.ts`) wired into `src/server.ts` behind the existing Host/Origin checks.

**Tech Stack:** React 19, TypeScript, Vite, vendored Arc components (Radix + motion), lucide-react, ascii-reveal, blobatar, Node 22 `node:http` + `node:sqlite`, Vitest (projects `node` and `web`, jsdom).

**Spec:** `docs/superpowers/specs/2026-10-25-studio-live-restyle-design.md` (Plan A = §9 phases 1–4: Foundation and parity pass, Shell, Home with its server changes, Runs). Plan B (Builder, Graph, Crew + Evolve, Triggers, Team-panel parity with its board, deleting `.studio`) is out of scope.

## Global Constraints

Copied from the spec; every task's requirements implicitly include these.

- Standing rules: no purple or indigo, no glow or gradient decoration, primary actions are ink, colour carries meaning only (blue live/working, amber needs you, green done/pass, red failed), loading via ascii-reveal.
- Themes follow the OS setting; dark and light are both first-class and polished. A manual override stays available.
- Token values are exactly those of the spec's §1 table (unchanged from `web/src/studio.css`). Shared in both themes: `--font-ui: 'Geist', ui-sans-serif, system-ui, sans-serif`; `--font-code: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace`; `--ease: cubic-bezier(.2, .8, .2, 1)`; `--t-fast: 150ms`, `--t-med: 200ms`, `--t-slow: 280ms`; radii 8 px (control), 10 px (panel), 12 px (surface).
- `--acc` is a fill and stroke colour only; every accent-coloured *text* uses `--accInk` in both themes.
- "No gradient decoration" means no gradient as a visible fill, border or text colour. Arc's functional mask-image fades and scroll-edge shadows are allowed (`tabs.module.css`, `segmented-control.module.css`, `timeline.module.css`, `json-viewer.module.css`, `sortable-data-table.module.css`).
- Motion: 150–280 ms with `--ease`. Loops only for live state (working step, breathing face, live clock, streaming caret, a live run's moving border). The reduced-motion rule moves from `.studio` to `:root` and stops every loop and transition; Blobatar's own `motion.css` rule stays.
- Type: Geist and Geist Mono (already self-hosted) apply app-wide; numbers use tabular figures.
- Every loading state goes through `web/src/components/Loading.tsx` (AsciiSkeleton + AsciiReveal); no spinners-as-placeholders and no grey skeletons. Inline button busy states may keep Arc's button `loading` prop.
- Both themes pass WCAG AA: 4.5:1 for text, 3:1 for UI glyphs and shapes.
- Faces are exempt from the no-purple rule: `Face.tsx`, the face editor swatches/slider in `Crew.tsx` and the built-in looks in `src/crew.ts` keep their colours.
- Breakpoints: 1200 px and wider for full layouts; 900–1199 px for the mid layouts; under 900 px for the bottom bar and stacked layouts. Layouts reflow at 200% zoom and at 320 CSS px without horizontal scroll (WCAG 1.4.10).
- Server changes for Home: all read-only; all follow the existing loopback, Host and Origin checks and return JSON errors like the other routes; Evolve probe runs never appear in any of them.
- The activity feed carries no free text: only ids, bot names, step titles, statuses, counts, costs and durations; never task text, prompts, outputs, gate output, questions, goals or error messages.
- Home opens no EventSource. At most one EventSource (the selected run's stream) is open in the app.
- Every data panel shows its own inline error (`role="alert"`) with a retry, never a silent empty list (the roster preview is the one exception: it hides). Actions on Home and Runs show toasts on failure and leave the row unchanged.
- Non-goals: no new run kinds (Home starts only the runs `POST /api/runs` already supports); no changes to the TUI, CLI output, engine behaviour or run semantics; no component library rewrite (vendored Arc components stay and are restyled through tokens).
- Repo rules for this plan: no new dependencies. Commits use a conventional prefix, carry no `Co-Authored-By` trailer and never mention Claude or AI. Do not push.
- Verification commands: `npx vitest run --project web <file>`, `npx vitest run --project node <file>`, `npm run typecheck`, `npm run build`. Three pre-existing node failures in the triggers tests (`/private/var` vs `/var`) are ignored; tests that are flaky under load (engine retryFailed, handoff depth limit, team-final cap, evolve `--json`) pass when run alone.

## Review Focus

The five uncovered inputs most likely to bite a person, each pinned by a test in its owning task:

1. **Double-clicking Start on Home** must start one run, not two: Start stays disabled while `POST /api/runs` is in flight (Task 14, test "starts one run when Start is clicked twice").
2. **A stale `localStorage['aorch.api.ws']`** (the workspace was removed) must fall back to the default workspace for Start a run and Saved requests instead of posting to a missing workspace (Task 14 "falls back to the default workspace when the stored one is gone"; Task 16 "reads the default workspace's requests when the stored id is stale").
3. **A stale step deep link** `#/runs/<id>/<node that is not in the run>` must show a hint, not crash or show another step (Task 19, test "says so when the linked step is not in the run").
4. **An activity cursor whose run was deleted** (`aorch` cleanup between polls) must still answer with the newer lines instead of erroring or replaying everything (Task 12, test "keeps paging after the cursor's run is deleted").
5. **Opening Settings from a dirty API tab** must keep the API tab mounted (no remount, no lost draft, no leave dialog) and closing Settings returns to it (Task 9, test "opens Settings over a dirty API tab without asking and without remounting it").

## Interpretations recorded in this plan

These are places where the spec is silent or self-contradictory; each task follows the choice below.

- **`--line2` cannot reach 3:1.** The exact token values give `--line2` about 1.4:1 against `--bg`/`--s1` in both themes, so the contrast test checks every other pair in §1 and records `--line2` as a decorative hairline (WCAG 1.4.11 exempts borders not needed to identify a control). Faces still get the `--line2` hairline the spec asks for. Owner decision needed if a 3:1 edge is required (that means changing a token value).
- **Bridge selector.** Token blocks use `:root:root` / `:root:root[data-theme="dark"]` as specified; the shared Arc/aorch bridge block uses `:root:root:root` (0,3,0) so it outranks `foundation.css`'s `:root[data-theme="dark"]` in dark without relying on file order. The token test loads `studio.css` *before* `foundation.css` to prove it.
- **Purple in vendored files.** The scan covers `foundation.css` and all `web/src/**/*.css`, so the violet accent rules, the lavender gradient stops, the purple series fallbacks (`foundation.css`) and the hue-285 keyword colour (`code-block.module.css`) are edited in place (colour values only); the Studio override file additionally re-declares the chart series. Test files are excluded from the scan (they hold violet literals to assert their absence).
- **Canvas dot grid.** The dot grid was a `radial-gradient` background, which the gradient rule bans; it becomes a `mask-image` dot pattern on `.canvas::before` painted with `--grid`, positioned through CSS variables set by `Canvas.tsx`.
- **Additive fields beyond the spec's shapes** (all optional or derivable, all free of free text): run rows' `steps[].bot` (the crew bot id, needed for faces and for "busy" crew), attention items' `node` (needed for the approve body and step links), activity lines' `bot` (the face to draw). `ApiError.status` is added to `web/src/api.ts` so Saved requests can tell a `409` apart.
- **Activity paging.** With `since`, the query pages *forward* (oldest first after the cursor, `LIMIT n`) and the response is reversed to newest first, so a gap larger than `limit` is filled over successive polls instead of skipped; without `since` it returns the newest lines (spec's query). `run.finished` with status `paused` renders "run paused" (`info`).
- **Connection status.** `connected` when the latest health poll succeeded (or failed fewer than 3 times in a row after having connected); `reconnecting` after 3 failures in a row once it had connected (usePoll's backoff threshold); `offline` when it has never connected in this session.
- **Home layout between 900 and 1199 px** is the one-column order (the spec gives two columns only at 1200 px and wider). The Crew strip shows built-in and your own bots plus any imported bot that is busy (an ECC import can hold 100+ bots).
- **Approval banner narrowing.** The spec shows an approval banner only for `awaiting` nodes of kind `approval`; the existing Runs test used an awaiting gate as its fixture, so its fixture gains an approval node (same assertions).
- **Phase order.** The Shell phase mounts a Home frame (header and section grid); Home's sections land in the Home phase.

## File Structure

Created:
- `web/src/studio-arc.css` — Studio overrides for vendored Arc parts (chart series, accent-coloured text).
- `web/src/rules.test.ts` — no-purple scan, gradient/glow rules, contrast pairs, parity assertions on `styles.css`.
- `web/src/theme.test.tsx` — theme selection.
- `web/src/ui/studio/parts.css` — styles for the shared parts.
- `web/src/ui/studio/{ScreenHeader,SectionHeading,Panel,EmptyState,Kbd,StatusChip,ListRow,FaceStack,StepTrack,InlineError}.tsx` + one test each; `steps.ts` (segment model).
- `web/src/ui/studio/{Rail,BottomBar,SettingsDrawer}.tsx`, `nav.ts`, `useMediaQuery.ts`, `connection.ts`, `shell.css` + tests.
- `web/src/CommandMenu.test.tsx`.
- `web/src/home/{Home,StartRun,NeedsYou,Running,Recent,ActivityFeed,SavedRequests,CrewStrip,Elapsed}.tsx`, `useRosterPreview.ts`, `workspaces.ts`, `runText.ts`, `home.css` + tests.
- `web/src/runs/{RunList,ProgressRing,RunHeader,RunBanners,RunCentre,Inspector,StepPane,FileBars}.tsx`, `fileStats.ts`, `runs.css` + tests.
- `src/runRows.ts`, `src/attention.ts`, `src/activity.ts`, `src/rosterPreview.ts`.
- `test/home-helpers.ts`, `test/run-rows.test.ts`, `test/attention.test.ts`, `test/activity.test.ts`, `test/roster-preview.test.ts`.

Modified:
- `web/src/studio.css` (root tokens, bridge, root reduced motion), `web/src/studio.test.ts` (rewritten), `web/src/main.tsx`, `web/src/theme.ts`, `web/src/styles.css`, `web/src/components/arc/foundation.css`, `web/src/components/arc/code-block/code-block.module.css`, `web/src/Canvas.tsx`, `web/src/Crew.tsx`, `web/src/Triggers.tsx`, `web/src/Runs.tsx`, `web/src/Runs.test.tsx`, `web/src/hooks.ts`, `web/src/hooks.test.tsx`, `web/src/App.tsx`, `web/src/App.test.tsx`, `web/src/CommandMenu.tsx`, `web/src/api.ts`, `web/src/test/fixtures.ts`, `web/src/Crew.test.tsx`, `web/src/Triggers.test.tsx`, `web/src/Canvas.test.tsx`.
- `src/types.ts` (read-model types), `src/store.ts` (`feed`, `feedQuery`), `src/roster.ts` (export `DOMAIN`, `baseName`; optional `langs`), `src/server.ts` (four GET routes, `/api/runs` rows).

Deleted: `web/src/theme.css`.

---

## Phase 1 — Foundation and parity pass

### Task 1: Root tokens, cascade and Arc bridge

**Files:**
- Modify: `web/src/studio.css` (full rewrite)
- Create: `web/src/studio-arc.css`
- Delete: `web/src/theme.css`
- Modify: `web/src/main.tsx`
- Modify: `web/src/styles.css:176` (remove the old reduced-motion line)
- Test: `web/src/studio.test.ts` (full rewrite)

**Interfaces:**
- Consumes: nothing.
- Produces: root-level CSS custom properties used by every later task: Studio tokens (`--bg --s1 --s2 --s3 --line --line2 --ink --mut --acc --accInk --accBg --ok --okBg --warn --warnBg --bad --badBg`), shared (`--font-ui --font-code --ease --t-fast --t-med --t-slow`), Arc bridge (`--background --surface --foreground --accent --accent-strong --control-on …`) and aorch names (`--panel --panel-2 --text --muted --done --run --wait --err --queued --skip --grid --sans --mono`). The `.studio` class remains as a base-look alias.

- [ ] **Step 1: Write the failing test** — replace `web/src/studio.test.ts` with:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// Files are read from disk: vitest blanks CSS imports (?raw included), and Vite rewrites a literal
// `new URL('./x', import.meta.url)` into a served asset URL, so the base goes through a variable.
const here = import.meta.url;
const file = (p: string) => new URL(p, here);
const read = (p: string) => readFileSync(file(p), 'utf8');
const studio = read('./studio.css');

const LIGHT: Record<string, string> = {
  '--bg': '#fbfbfa', '--s1': '#ffffff', '--s2': '#f4f4f5', '--s3': '#e4e4e7',
  '--line': 'rgba(9, 9, 11, .08)', '--line2': 'rgba(9, 9, 11, .16)',
  '--ink': '#09090b', '--mut': '#52525b',
  '--acc': '#2563eb', '--accInk': '#1d4ed8', '--accBg': '#eff6ff',
  '--ok': '#047857', '--okBg': '#ecfdf5', '--warn': '#a16207', '--warnBg': '#fefce8', '--bad': '#b91c1c', '--badBg': '#fef2f2',
};
const DARK: Record<string, string> = {
  '--bg': '#0a0a0b', '--s1': '#111113', '--s2': '#18181b', '--s3': '#26262b',
  '--line': 'rgba(255, 255, 255, .07)', '--line2': 'rgba(255, 255, 255, .14)',
  '--ink': '#f4f4f5', '--mut': '#a1a1aa',
  '--acc': '#2563eb', '--accInk': '#93c5fd', '--accBg': 'rgba(59, 130, 246, .15)',
  '--ok': '#34d399', '--okBg': 'rgba(52, 211, 153, .12)', '--warn': '#fbbf24', '--warnBg': 'rgba(251, 191, 36, .12)', '--bad': '#f87171', '--badBg': 'rgba(248, 113, 113, .12)',
};
const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

/** A root custom property with var() chains resolved (jsdom cascades by specificity but leaves var() as written). */
function token(name: string, depth = 0): string {
  const raw = norm(getComputedStyle(document.documentElement).getPropertyValue(name));
  const m = /^var\((--[\w-]+)\)$/.exec(raw);
  return m && depth < 10 ? token(m[1]!, depth + 1) : raw;
}
const setTheme = (t: 'light' | 'dark') => {
  if (t === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
};

beforeAll(() => {
  // studio.css goes in FIRST: its blocks must win by specificity, not by coming after foundation.css
  for (const css of [studio, read('./studio-arc.css'), read('./components/arc/foundation.css')]) {
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }
});
afterEach(() => setTheme('light'));

describe('Studio Live tokens at the root', () => {
  it.each([['light', LIGHT], ['dark', DARK]] as const)('declares the exact %s values', (theme, want) => {
    setTheme(theme);
    for (const [k, v] of Object.entries(want)) expect(token(k), k).toBe(norm(v));
  });

  it.each([['light', LIGHT], ['dark', DARK]] as const)('bridges Arc and aorch names to the Studio values in %s', (theme, T) => {
    setTheme(theme);
    expect(token('--accent')).toBe(T['--acc']);
    expect(token('--accent-strong')).toBe(T['--accInk']);
    expect(token('--foreground')).toBe(T['--ink']);
    expect(token('--control-on')).toBe(T['--ink']);
    expect(token('--text')).toBe(T['--ink']);
    expect(token('--background')).toBe(T['--bg']);
    expect(token('--surface')).toBe(T['--s1']);
    expect(token('--muted')).toBe(T['--mut']);
    expect(token('--run')).toBe(T['--acc']);
    expect(token('--skip')).toBe(norm(T['--line2']!));
    expect(token('--series-2')).toBe(T['--ok']);
    expect(token('--arc-gradient')).not.toMatch(/gradient\(/);
  });

  it('shares type, motion and radii in both themes', () => {
    for (const t of ['light', 'dark'] as const) {
      setTheme(t);
      expect(token('--font-ui')).toBe("'Geist', ui-sans-serif, system-ui, sans-serif");
      expect(token('--font-code')).toBe("'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace");
      expect(token('--ease')).toBe('cubic-bezier(.2, .8, .2, 1)');
      expect([token('--t-fast'), token('--t-med'), token('--t-slow')]).toEqual(['150ms', '200ms', '280ms']);
      expect([token('--radius-control'), token('--radius-panel'), token('--radius-surface')]).toEqual(['8px', '10px', '12px']);
    }
  });

  it('re-points accent-coloured text in Arc parts to the text-safe accent', () => {
    const arc = read('./studio-arc.css');
    expect(arc).toMatch(/\[class\*="value"\]\[data-type="number"\]\s*{\s*color: var\(--accent-strong\)/);
    expect(arc).toMatch(/\[class\*="icon"\]\[data-type="info"\]\s*{\s*color: var\(--accent-strong\)/);
  });

  it('stops every loop and transition for reduced motion at the root, in one place', () => {
    expect(studio).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*:root \*, :root \*::before, :root \*::after/);
    expect(read('./styles.css')).not.toMatch(/prefers-reduced-motion/);
  });

  it('drops the old aliases and keeps .studio only as a base-look alias', () => {
    expect(existsSync(file('./theme.css'))).toBe(false);
    expect(studio).not.toContain('.studio.studio');
    expect(studio).not.toMatch(/\[data-theme="dark"\] \.studio/);
    expect(studio).toMatch(/\.studio\s*{[^}]*background: var\(--bg\)/);
    expect(read('./main.tsx')).not.toContain('theme.css');
    expect(read('./main.tsx')).toContain("import './studio-arc.css'");
  });

  it('self-hosts Geist and Geist Mono', () => {
    expect(studio).toContain("url('./assets/fonts/Geist-Variable.woff2')");
    expect(studio).toContain("url('./assets/fonts/GeistMono-Variable.woff2')");
    expect(studio).not.toContain('fonts.googleapis');
    expect(existsSync(file('./assets/fonts/Geist-Variable.woff2'))).toBe(true);
    expect(existsSync(file('./assets/fonts/GeistMono-Variable.woff2'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project web web/src/studio.test.ts`
Expected: FAIL — `studio-arc.css` does not exist (ENOENT), and `--bg` resolves to `var(--background)`-style aliases.

- [ ] **Step 3: Write the implementation**

Replace `web/src/studio.css` with:

```css
/* Studio Live: the app-wide look. Tokens sit on the document root for both themes (theme.ts sets data-theme).
   They win over Arc's foundation.css by specificity, not file order: the token blocks are (0,2,0) and (0,3,0) and the
   shared Arc/aorch bridge is (0,3,0), above every foundation.css rule that still matches (:root, :root[data-theme="dark"]). */
@font-face { font-family: 'Geist'; src: url('./assets/fonts/Geist-Variable.woff2') format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; }
@font-face { font-family: 'Geist Mono'; src: url('./assets/fonts/GeistMono-Variable.woff2') format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; }

:root:root {
  --bg: #fbfbfa; --s1: #ffffff; --s2: #f4f4f5; --s3: #e4e4e7;
  --line: rgba(9, 9, 11, .08); --line2: rgba(9, 9, 11, .16);
  --ink: #09090b; --mut: #52525b;
  --acc: #2563eb; --accInk: #1d4ed8; --accBg: #eff6ff;
  --ok: #047857; --okBg: #ecfdf5;
  --warn: #a16207; --warnBg: #fefce8;
  --bad: #b91c1c; --badBg: #fef2f2;
}
:root:root[data-theme="dark"] {
  --bg: #0a0a0b; --s1: #111113; --s2: #18181b; --s3: #26262b;
  --line: rgba(255, 255, 255, .07); --line2: rgba(255, 255, 255, .14);
  --ink: #f4f4f5; --mut: #a1a1aa;
  --acc: #2563eb; --accInk: #93c5fd; --accBg: rgba(59, 130, 246, .15);
  --ok: #34d399; --okBg: rgba(52, 211, 153, .12);
  --warn: #fbbf24; --warnBg: rgba(251, 191, 36, .12);
  --bad: #f87171; --badBg: rgba(248, 113, 113, .12);
}
:root:root:root {
  --font-ui: 'Geist', ui-sans-serif, system-ui, sans-serif;
  --font-code: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  --ease: cubic-bezier(.2, .8, .2, 1);
  --t-fast: 150ms; --t-med: 200ms; --t-slow: 280ms;

  /* Arc's tokens, bridged. Arc's primary button paints --foreground, so it is ink. --acc is a fill; accent TEXT is --accent-strong (--accInk). */
  --background: var(--bg); --surface: var(--s1); --surface-raised: var(--s1); --surface-muted: var(--s2);
  --foreground: var(--ink); --text-secondary: var(--mut); --text-muted: var(--mut);
  --border: var(--line); --border-subtle: var(--line); --border-strong: var(--line2);
  --accent: var(--acc); --accent-strong: var(--accInk); --accent-subtle: var(--accBg); --accent-foreground: #ffffff;
  --control-on: var(--ink); --control-glyph: var(--bg); --control-fill: var(--ink); --control-thumb-on: var(--bg);
  --success: var(--ok); --warning: var(--warn); --danger: var(--bad);
  --shadow-resting: none; --shadow-raised: none; --shadow-floating: 0 0 0 1px var(--line2);
  --arc-gradient: var(--s2); --arc-gradient-soft: var(--s1); --arc-gradient-line: var(--line2); --arc-gradient-ink: var(--ink); --arc-gradient-foreground: var(--ink);
  --radius-control: 8px; --radius-panel: 10px; --radius-surface: 12px;
  --font-body: var(--font-ui); --font-display: var(--font-ui);
  --ease-enter: var(--ease); --ease-standard: var(--ease);
  --duration-instant: var(--t-fast); --duration-fast: var(--t-fast); --duration-standard: var(--t-slow);
  --focus-outline: var(--acc);

  /* aorch's own names, pointing straight at Studio tokens (a variable is resolved where it is declared) */
  --panel: var(--s1); --panel-2: var(--s2); --text: var(--ink); --muted: var(--mut); --accent-fg: #ffffff;
  --done: var(--ok); --run: var(--acc); --wait: var(--warn); --err: var(--bad); --queued: var(--mut); --skip: var(--line2);
  --grid: var(--line); --shadow: none;
  --sans: var(--font-ui); --mono: var(--font-code);
}

html, body { background: var(--bg); color: var(--ink); font-family: var(--font-ui); font-variant-numeric: tabular-nums; }
code, pre, kbd, .mono { font-family: var(--font-code); }

/* Kept while screens move over (deleted at the end of Plan B): the class no longer carries tokens, only the base look. */
.studio { background: var(--bg); color: var(--ink); font-family: var(--font-ui); font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  :root *, :root *::before, :root *::after {
    animation-duration: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
  }
}
```

Create `web/src/studio-arc.css`:

```css
/* Studio overrides for vendored Arc parts whose colours the bridge cannot reach. */
:root:root:root {
  /* chart series from the Studio palette (status hues only) */
  --series-1: var(--acc);
  --series-2: var(--ok);
  --series-3: var(--warn);
  --series-4: var(--mut);
}
/* --acc is a fill colour (3.8:1 on dark): accent-coloured TEXT uses --accent-strong (--accInk). */
:root [class*="value"][data-type="number"] { color: var(--accent-strong); }
:root [class*="icon"][data-type="info"] { color: var(--accent-strong); }
```

Delete `web/src/theme.css` (`git rm web/src/theme.css`).

In `web/src/main.tsx`, replace the stylesheet imports so they read:

```ts
import './components/arc/foundation.css';
import 'blobatar/motion.css';
import './styles.css';
import './studio.css';
import './studio-arc.css';
```

In `web/src/styles.css`, delete line 176:

```css
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project web web/src/studio.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the web suite, typecheck and build**

Run: `npx vitest run --project web && npm run typecheck && npm run build`
Expected: all green (no test reads `theme.css`).

- [ ] **Step 6: Commit**

```bash
git add web/src/studio.css web/src/studio-arc.css web/src/main.tsx web/src/styles.css web/src/studio.test.ts
git rm web/src/theme.css
git commit -m "feat(web): Studio Live tokens and Arc bridge at the document root"
```

---

### Task 2: Theme selection (system / light / dark)

**Files:**
- Modify: `web/src/theme.ts` (full rewrite)
- Modify: `web/src/App.tsx` (theme switch call site only)
- Test: `web/src/theme.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces (from `web/src/theme.ts`):
  - `type ThemeChoice = 'system' | 'light' | 'dark'`, `type Theme = 'light' | 'dark'`
  - `storedChoice(): ThemeChoice`, `systemTheme(): Theme`, `resolveTheme(c: ThemeChoice): Theme`
  - `initialTheme(): Theme` (used by `main.tsx`), `applyTheme(t: Theme): void`
  - `useTheme(): { choice: ThemeChoice; theme: Theme; setChoice: (c: ThemeChoice) => void }`
  - `THEME_LABEL: Record<ThemeChoice, string>` = `{ light: 'Light', dark: 'Dark', system: 'Match system' }`

- [ ] **Step 1: Write the failing test** — create `web/src/theme.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, initialTheme, storedChoice, useTheme } from './theme';

/** A controllable prefers-color-scheme: dark query. */
function fakeOs(dark: boolean) {
  const state = { dark };
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    get matches() { return state.dark; },
    media: '(prefers-color-scheme: dark)', onchange: null,
    addEventListener: (_: string, f: (e: { matches: boolean }) => void) => listeners.add(f),
    removeEventListener: (_: string, f: (e: { matches: boolean }) => void) => listeners.delete(f),
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  };
  vi.stubGlobal('matchMedia', (q: string) => (q === '(prefers-color-scheme: dark)' ? mql : { ...mql, matches: false, media: q }));
  return {
    set(d: boolean) { state.dark = d; for (const f of listeners) f({ matches: d }); },
    listeners: () => listeners.size,
  };
}
const root = () => document.documentElement;

beforeEach(() => localStorage.clear());
afterEach(() => { delete root().dataset.theme; delete root().dataset.accent; });

describe('theme selection', () => {
  it('defaults to Match system and follows OS changes live', () => {
    const os = fakeOs(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe('system');
    expect(root().dataset.theme).toBe('light');
    act(() => os.set(true));
    expect(root().dataset.theme).toBe('dark');
    expect(result.current.theme).toBe('dark');
  });

  it('ignores OS changes under a manual pick and stores it', () => {
    const os = fakeOs(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setChoice('dark'));
    expect(localStorage.getItem('aorch.theme')).toBe('dark');
    act(() => os.set(false));
    expect(root().dataset.theme).toBe('dark');
    expect(os.listeners()).toBe(0);
    act(() => result.current.setChoice('system'));
    expect(root().dataset.theme).toBe('light');
  });

  it('keeps an old two-state value as the manual choice', () => {
    fakeOs(true);
    localStorage.setItem('aorch.theme', 'light');
    expect(storedChoice()).toBe('light');
    expect(initialTheme()).toBe('light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe('light');
  });

  it('treats unknown stored values as Match system', () => {
    fakeOs(true);
    localStorage.setItem('aorch.theme', 'violet');
    expect(storedChoice()).toBe('system');
    expect(initialTheme()).toBe('dark');
  });

  it('works when storage is unavailable', () => {
    fakeOs(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe('system');
    expect(root().dataset.theme).toBe('dark');
    expect(() => act(() => result.current.setChoice('light'))).not.toThrow();
    expect(root().dataset.theme).toBe('light');
  });

  it('never sets the Arc accent attribute and clears a stale one', () => {
    root().dataset.accent = 'violet';
    applyTheme('dark');
    expect(root().dataset.accent).toBeUndefined();
    expect(root().style.colorScheme).toBe('dark');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project web web/src/theme.test.tsx`
Expected: FAIL — `storedChoice` is not exported; `useTheme()` returns a tuple.

- [ ] **Step 3: Write the implementation** — replace `web/src/theme.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';
export const THEME_LABEL: Record<ThemeChoice, string> = { light: 'Light', dark: 'Dark', system: 'Match system' };

const KEY = 'aorch.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The saved choice; missing, unknown or unreadable means Match system. An old 'light'/'dark' is kept as the manual pick. */
export function storedChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

export function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY)?.matches ? 'dark' : 'light';
}

export const resolveTheme = (c: ThemeChoice): Theme => (c === 'system' ? systemTheme() : c);
export const initialTheme = (): Theme => resolveTheme(storedChoice());

/** Arc's foundation.css and the Studio tokens key their dark palette on data-theme. The Arc accent attribute is never set. */
export function applyTheme(t: Theme): void {
  const el = document.documentElement;
  el.dataset.theme = t;
  delete el.dataset.accent;
  el.style.colorScheme = t;
}

export function useTheme(): { choice: ThemeChoice; theme: Theme; setChoice: (c: ThemeChoice) => void } {
  const [choice, setChoiceState] = useState<ThemeChoice>(storedChoice);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(choice));

  useEffect(() => {
    setTheme(resolveTheme(choice));
    if (choice !== 'system') return;
    const mql = window.matchMedia?.(DARK_QUERY);
    if (!mql?.addEventListener) return;
    const on = () => setTheme(mql.matches ? 'dark' : 'light');
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, [choice]);
  useEffect(() => applyTheme(theme), [theme]);

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* storage unavailable */
    }
  }, []);
  return { choice, theme, setChoice };
}
```

In `web/src/App.tsx`, replace `const [theme, setTheme] = useTheme();` with `const { theme, setChoice } = useTheme();` and the switch with `<ThemeSwitch theme={theme} onThemeChange={(t) => setChoice(t)} iconOnly />` (the shell replaces it in Task 9).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project web web/src/theme.test.tsx web/src/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean (`main.tsx` still calls `applyTheme(initialTheme())`).

- [ ] **Step 6: Commit**

```bash
git add web/src/theme.ts web/src/theme.test.tsx web/src/App.tsx
git commit -m "feat(web): theme follows the OS live, with a manual override"
```

---

### Task 3: On-rule guards and the parity pass

**Files:**
- Test: `web/src/rules.test.ts` (create)
- Modify: `web/src/components/arc/foundation.css:50-60,114-119,123,131,142,150,162-163`
- Modify: `web/src/components/arc/code-block/code-block.module.css:28,36`
- Modify: `web/src/styles.css` (lines 26, 28, 35, 39, 59-63, 90, 119-125, 144, 162, 194, 217, 239)
- Modify: `web/src/Canvas.tsx:168-179` (grid position through CSS variables)
- Modify: `web/src/Runs.tsx:10,333`, `web/src/Crew.tsx:238-241,420-424`, `web/src/Triggers.tsx:201-204,368-372`
- Test: `web/src/Crew.test.tsx`, `web/src/Triggers.test.tsx` (one test each)

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: `styles.css` classes on-rule (`button.primary` ink, `.badge.s-*` tinted, `.chip.agent`/`button.link`/`.diff .dk` text in `--accInk`); `.canvas` reads `--grid-x`, `--grid-y`, `--grid-size`.

- [ ] **Step 1: Write the failing test** — create `web/src/rules.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = import.meta.url;
const root = fileURLToPath(new URL('./', here));
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
/** Product sources: CSS and TSX, without tests (they hold violet literals to assert their absence). */
const sources = walk(root)
  .filter((p) => /\.(css|tsx)$/.test(p) && !/\.test\.tsx$/.test(p) && !p.includes(`${join(root, 'test')}`))
  .map((p) => ({ path: relative(root, p), text: readFileSync(p, 'utf8') }));
const css = sources.filter((s) => s.path.endsWith('.css'));

/** Face colour sources may keep their hues (faces are identity art). Nothing else is allowed. */
const FACE_ALLOW = [{ path: 'Crew.tsx', value: '#b58bff' }];

function hexHue(hex: string): { h: number; chroma: number } {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return { h: 0, chroma: 0 };
  let hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue *= 60;
  return { h: hue < 0 ? hue + 360 : hue, chroma: d };
}
function violetHits(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
    const { h, chroma } = hexHue(m[0]);
    if (chroma > 0.1 && h >= 260 && h <= 320) hits.push(m[0]);
  }
  for (const m of text.matchAll(/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/g)) if (Number(m[2]) > 0.02 && Number(m[3]) >= 260 && Number(m[3]) <= 320) hits.push(m[0]);
  for (const m of text.matchAll(/hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%/g)) if (Number(m[2]) > 5 && Number(m[1]) >= 260 && Number(m[1]) <= 320) hits.push(m[0]);
  return hits;
}

describe('no purple', () => {
  it('finds no violet colours outside the face sources', () => {
    const found = sources.flatMap((s) => violetHits(s.text).filter((v) => !FACE_ALLOW.some((a) => a.path === s.path && a.value.toLowerCase() === v.toLowerCase())).map((v) => `${s.path}: ${v}`));
    expect(found).toEqual([]);
  });
  it('names no purple accent in stylesheets', () => {
    expect(css.filter((s) => /\b(purple|violet|indigo)\b/i.test(s.text)).map((s) => s.path)).toEqual([]);
  });
});

describe('no gradient decoration and no glow', () => {
  const ARC_FADES = ['tabs.module.css', 'segmented-control.module.css', 'timeline.module.css', 'json-viewer.module.css', 'sortable-data-table.module.css'];
  it('paints no gradient as a background outside Arc’s functional fades', () => {
    const bad = css.filter((s) => !ARC_FADES.some((f) => s.path.endsWith(f))).filter((s) => /background[\w-]*\s*:[^;{}]*-gradient\(/.test(s.text)).map((s) => s.path);
    expect(bad).toEqual([]);
  });
  it('never defines an --arc-gradient token as a gradient', () => {
    expect(css.filter((s) => /--arc-gradient[\w-]*\s*:[^;]*gradient\(/.test(s.text)).map((s) => s.path)).toEqual([]);
  });
  it('draws no glow (a zero-offset blurred shadow)', () => {
    expect(css.filter((s) => /box-shadow:\s*0 0 [1-9]\d*px/.test(s.text)).map((s) => s.path)).toEqual([]);
  });
});

// ---------- contrast ----------
type RGBA = [number, number, number, number];
const tokenBlock = (selector: string): Record<string, string> => {
  const text = read('studio.css');
  const start = text.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = text.slice(start + selector.length + 2, text.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
};
const parse = (v: string): RGBA => {
  if (v.startsWith('#')) {
    const h = v.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as RGBA;
  }
  const n = /rgba?\(([^)]+)\)/.exec(v)![1]!.split(',').map((x) => Number(x.trim()));
  return [n[0]!, n[1]!, n[2]!, n[3] ?? 1];
};
const over = (fg: RGBA, bg: RGBA): RGBA => [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3])).concat(1) as RGBA;
const lum = (c: RGBA) => {
  const f = (x: number) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a: RGBA, b: RGBA) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

describe.each([
  ['light', ':root:root'],
  ['dark', ':root:root[data-theme="dark"]'],
])('contrast in %s', (_name, selector) => {
  const T = tokenBlock(selector);
  const c = (k: string) => parse(T[k]!);
  const bg = c('--bg');
  const solid = (k: string) => over(c(k), bg);
  it('text: ink and muted on every surface', () => {
    for (const fg of ['--ink', '--mut']) for (const s of ['--bg', '--s1', '--s2', '--s3']) expect(ratio(c(fg), solid(s)), `${fg} on ${s}`).toBeGreaterThanOrEqual(4.5);
  });
  it('text: status colours on the page, on panels and on their own tint', () => {
    const pairs: [string, string][] = [['--accInk', '--accBg'], ['--ok', '--okBg'], ['--warn', '--warnBg'], ['--bad', '--badBg']];
    for (const [fg, tint] of pairs) {
      expect(ratio(c(fg), bg), `${fg} on --bg`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c(fg), solid('--s1')), `${fg} on --s1`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c(fg), solid(tint)), `${fg} on ${tint}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('white text on the accent fill', () => {
    expect(ratio([255, 255, 255, 1], c('--acc'))).toBeGreaterThanOrEqual(4.5);
  });
  it('UI: the accent against the page and panels', () => {
    for (const s of ['--bg', '--s1']) expect(ratio(c('--acc'), solid(s)), `--acc on ${s}`).toBeGreaterThanOrEqual(3);
    // --line2 is a decorative hairline (about 1.4:1 with the exact token values): see the plan's Interpretations.
  });
});

describe('parity pass on styles.css', () => {
  const styles = read('styles.css');
  const rule = (sel: string) => {
    const i = styles.indexOf(`${sel} {`);
    expect(i, sel).toBeGreaterThanOrEqual(0);
    return styles.slice(i, styles.indexOf('}', i));
  };
  it('keeps no hard-coded colours', () => {
    expect(styles.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });
  it('paints hand-built primary buttons ink', () => {
    expect(rule('button.primary')).toContain('background: var(--ink)');
    expect(rule('button.primary')).toContain('color: var(--bg)');
  });
  it('takes badge colours from tokens as tinted fills', () => {
    expect(rule('.badge')).toContain('color: var(--mut)');
    expect(rule('.badge.s-done')).toContain('color: var(--ok)');
    expect(rule('.badge.s-error')).toContain('color: var(--bad)');
  });
  it('never paints text in the fill-only accent', () => {
    expect(styles).not.toMatch(/(^|[;{\s])color:\s*var\(--accent\)/m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project web web/src/rules.test.ts`
Expected: FAIL — violet hits in `foundation.css` (`#7747ff`, `#a78bff`, `#5528ce`, `#8a66ff`, `#7128a5`, `#9c37be`, `oklch(… 300)`), `code-block.module.css` (`oklch(48% .15 285)`), `styles.css` (`#a77bf3`, `#6d5bd0`, `#fff`, `radial-gradient` on `.canvas`, `button.primary` accent).

- [ ] **Step 3: Fix `foundation.css` colour values**

In `web/src/components/arc/foundation.css`:
- Replace lines 50–60 (light brand gradient block) with:

```css
  /* Brand gradient, flattened for aorch (Studio Live: flat fills, neutral hue). The comment words the rules test bans stay out of stylesheets. */
  --arc-gradient-from: oklch(90% 0 0);
  --arc-gradient-to: oklch(92% 0 0);
  --arc-gradient: var(--arc-gradient-from);
  --arc-gradient-foreground: oklch(22% 0 0);
  --arc-gradient-soft: oklch(97.5% 0 0);
  --arc-gradient-line: oklch(83% 0 0);
  --arc-gradient-ink: oklch(47% 0 0);
```

- Replace lines 114–119 (dark gradient values) with:

```css
  --arc-gradient-from: oklch(38% 0 0);
  --arc-gradient-to: oklch(40% 0 0);
  --arc-gradient-foreground: oklch(96% 0 0);
  --arc-gradient-soft: oklch(23.5% 0 0);
  --arc-gradient-line: oklch(48% 0 0);
  --arc-gradient-ink: oklch(82% 0 0);
```

- Delete the four violet accent lines (123, 131, 142, 150: `:root[data-accent="violet"] { --accent: #7747ff; … }`, `:root[data-theme="dark"][data-accent="violet"] { --accent: #a78bff; … }`, `:root[data-accent="violet"] { --control-on: #7747ff; … }`, `:root[data-theme="dark"][data-accent="violet"] { --control-on: #8a66ff; … }`). The `data-accent` attribute is never set any more (Task 2), so no rule replaces them.
- Line 162 becomes `:root { --series-1: #1f7dcf; --series-2: #047857; --series-3: #e58f00; --series-4: #009e84; }` and line 163 becomes `:root[data-theme="dark"] { --series-1: #55adff; --series-2: #34d399; --series-3: #e66e00; --series-4: #00a861; }`.

In `web/src/components/arc/code-block/code-block.module.css`, change line 28 to `.keyword { color: var(--accent-strong); }` and delete line 36 (`:global(:root[data-theme="dark"]) .keyword { … }`); `--accent-strong` is `--accInk` in both themes.

- [ ] **Step 4: Parity edits in `styles.css`**

Replace these rules (left: current; right: new):

```css
button.primary { background: var(--ink); color: var(--bg); border-color: var(--ink); font-weight: 600; }
button.link { background: none; border: none; padding: 0; color: var(--accInk); text-align: left; }
.logo { color: var(--ink); font-size: 18px; }
.chip.agent { color: var(--accInk); }
.node.s-idle.k-agent { border-left-color: var(--ink); }
.diff .dk { color: var(--accInk); } .diff .dh { color: var(--muted); }
.t-run { --c: var(--acc); } .t-pipeline { --c: var(--ink); } .t-role { --c: var(--wait); } .t-file { --c: var(--done); } .t-note { --c: var(--queued); }
```

`.bot-editor` and `.trigger-form` borders change from `var(--accent)` to `var(--line2)`. Replace the canvas rule (lines 59–63) with:

```css
.canvas { position: relative; overflow: hidden; outline: none; touch-action: none; user-select: none; cursor: grab; background-color: var(--bg); }
/* The dot grid: a solid --grid fill cut into dots by a mask (no gradient fill). Canvas.tsx moves it with pan and zoom. */
.canvas::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; background: var(--grid);
  -webkit-mask-image: radial-gradient(circle, black 1.2px, transparent 1.4px); mask-image: radial-gradient(circle, black 1.2px, transparent 1.4px);
  -webkit-mask-size: var(--grid-size, 24px) var(--grid-size, 24px); mask-size: var(--grid-size, 24px) var(--grid-size, 24px);
  -webkit-mask-position: var(--grid-x, 0) var(--grid-y, 0); mask-position: var(--grid-x, 0) var(--grid-y, 0);
}
```

Replace lines 119–125 (dots and badges) with:

```css
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--queued); flex: none; }
.dot.s-done { background: var(--done); } .dot.s-running { background: var(--run); }
.dot.s-paused, .dot.s-awaiting { background: var(--wait); }
.dot.s-error { background: var(--err); } .dot.s-stopped { background: var(--skip); }
.dot.pulse { animation: pulse 1.4s ease-in-out infinite; }
/* Tinted fill with the status colour as text (no white-on-colour). */
.badge { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 7px; border-radius: 6px; margin-left: 6px; vertical-align: middle; background: var(--s2); color: var(--mut); }
.badge.s-done { background: var(--okBg); color: var(--ok); }
.badge.s-running, .badge.s-team { background: var(--accBg); color: var(--accInk); }
.badge.s-paused, .badge.s-awaiting { background: var(--warnBg); color: var(--warn); }
.badge.s-error { background: var(--badBg); color: var(--bad); }
.badge.s-stopped, .badge.s-skipped, .badge.s-queued { background: var(--s2); color: var(--mut); }
```

Delete line 239 (`.badge.s-team { background: var(--accent, #6d5bd0); }`).

- [ ] **Step 5: Move the canvas grid through CSS variables** — in `web/src/Canvas.tsx` add `type CSSProperties` to the React import and replace the `style={{ backgroundPosition…, backgroundSize… }}` prop on `.canvas` with:

```tsx
      style={{ '--grid-x': `${view.x}px`, '--grid-y': `${view.y}px`, '--grid-size': `${24 * view.k}px` } as CSSProperties}
```

- [ ] **Step 6: Run the rules test**

Run: `npx vitest run --project web web/src/rules.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing loading tests** — append to `web/src/Crew.test.tsx` inside `describe('Crew', …)`:

```tsx
  it('shows the ascii skeleton while the crew loads', async () => {
    routeApi({ ...routes, 'GET /api/crew': new Promise(() => {}) });
    const { container } = renderApp(<Crew />);
    expect(screen.getByRole('status', { name: 'Checking which agents are installed' })).toBeTruthy();
    expect(container.querySelector('[data-ascii-skeleton]')).toBeTruthy();
    expect(screen.queryByText('Checking which agents are installed…')).toBeNull();
  });
```

and to `web/src/Triggers.test.tsx` inside `describe('Triggers', …)`:

```tsx
  it('shows the ascii skeleton while triggers load', () => {
    routeApi({ 'GET /api/triggers': new Promise(() => {}), 'GET /api/triggers/deliveries': [], 'GET /api/triggers/setup': setup(true), 'GET /api/workspaces': [], 'GET /api/pipelines': [], 'GET /api/bots': { agents: {} } });
    const { container } = renderApp(<Triggers />);
    expect(screen.getByRole('status', { name: 'Loading triggers' })).toBeTruthy();
    expect(container.querySelector('[data-ascii-skeleton]')).toBeTruthy();
  });
```

Run: `npx vitest run --project web web/src/Crew.test.tsx web/src/Triggers.test.tsx`
Expected: the two new tests FAIL (no `status` role).

- [ ] **Step 8: Route the plain loading states through `Loading`**

`web/src/Crew.tsx`: add `import { Loading } from './components/Loading';`. Replace

```tsx
      {loading ? (
        <p className="muted">Checking which agents are installed…</p>
      ) : (
        <>
```

with

```tsx
      <Loading loading={loading} lines={6} label="Checking which agents are installed">
        <>
```

and the matching close at the end of the component

```tsx
        </>
      )}
    </div>
```

with

```tsx
        </>
      </Loading>
    </div>
```

`web/src/Triggers.tsx`: same import; replace `{loading ? (\n        <p className="muted">Loading triggers…</p>\n      ) : (\n        <>` with `<Loading loading={loading} lines={6} label="Loading triggers">\n        <>` and the closing `        </>\n      )}\n    </div>` with `        </>\n      </Loading>\n    </div>`.

`web/src/Runs.tsx`: replace the `Skeleton` import with `import { Loading } from './components/Loading';` and `<Skeleton lines={4} label="Loading run" />` with `<Loading loading lines={4} label="Loading run" />`.

- [ ] **Step 9: Run the suites**

Run: `npx vitest run --project web && npm run typecheck`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add web/src/rules.test.ts web/src/components/arc/foundation.css web/src/components/arc/code-block/code-block.module.css web/src/styles.css web/src/Canvas.tsx web/src/Crew.tsx web/src/Triggers.tsx web/src/Runs.tsx web/src/Crew.test.tsx web/src/Triggers.test.tsx
git commit -m "feat(web): no-purple, gradient and contrast guards; parity pass for unbuilt screens"
```

---

### Task 4: Studio parts I — ScreenHeader, SectionHeading, Panel, EmptyState, Kbd

**Files:**
- Create: `web/src/ui/studio/parts.css`
- Create: `web/src/ui/studio/ScreenHeader.tsx`, `SectionHeading.tsx`, `Panel.tsx`, `EmptyState.tsx`, `Kbd.tsx`
- Test: `web/src/ui/studio/ScreenHeader.test.tsx`, `SectionHeading.test.tsx`, `Panel.test.tsx`, `EmptyState.test.tsx`, `Kbd.test.tsx`

**Interfaces:**
- Consumes: Task 1 tokens; `cn` from `web/src/ui/cn.ts`; Arc `EmptyState` (`title: string; description: string; action?: ReactNode; className?: string`).
- Produces:
  - `ScreenHeader(props: { meta?: ReactNode; title: string; summary?: ReactNode; actions?: ReactNode })` → `<header class="sl-screen-header">` with an `h1`.
  - `SectionHeading(props: { id?: string; title: string; count?: number; action?: ReactNode })` → `h2` + mono count.
  - `Panel(props: { title?: string; count?: number; action?: ReactNode; className?: string; children: ReactNode })` → `<section class="sl-panel">`, labelled by its heading when titled.
  - `EmptyState(props: { title: string; description: string; action?: ReactNode })`.
  - `Kbd(props: { mod?: boolean; children: ReactNode })` and `isApple(): boolean`.
  - CSS classes in `parts.css` used by later parts: `.sl-sr` (visually hidden), `.sl-meta`, `.sl-list`, `.sl-alert`.

- [ ] **Step 1: Write the failing tests**

`web/src/ui/studio/ScreenHeader.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScreenHeader } from './ScreenHeader';

describe('ScreenHeader', () => {
  it('shows the meta line, the title as the page heading, the summary and the actions', () => {
    render(<ScreenHeader meta="2 running · 1 needs you" title="Home" summary="What is going on" actions={<button>Refresh</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
    expect(screen.getByText('2 running · 1 needs you').className).toContain('sl-meta');
    expect(screen.getByText('What is going on')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });
  it('leaves out what is not given', () => {
    const { container } = render(<ScreenHeader title="Runs" />);
    expect(container.querySelector('.sl-meta')).toBeNull();
    expect(container.querySelector('.sl-actions')).toBeNull();
  });
});
```

`web/src/ui/studio/SectionHeading.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionHeading } from './SectionHeading';

describe('SectionHeading', () => {
  it('shows the title, a mono count and an action', () => {
    render(<SectionHeading id="h" title="Needs you" count={3} action={<button>See all</button>} />);
    const h = screen.getByRole('heading', { level: 2, name: 'Needs you' });
    expect(h.id).toBe('h');
    expect(screen.getByText('3').className).toContain('sl-count');
    expect(screen.getByRole('button', { name: 'See all' })).toBeTruthy();
  });
  it('shows a zero count but no count when none is given', () => {
    const { rerender, container } = render(<SectionHeading title="Recent" count={0} />);
    expect(screen.getByText('0')).toBeTruthy();
    rerender(<SectionHeading title="Recent" />);
    expect(container.querySelector('.sl-count')).toBeNull();
  });
});
```

`web/src/ui/studio/Panel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel } from './Panel';

describe('Panel', () => {
  it('is a region named by its heading', () => {
    render(<Panel title="Running" count={2} className="s-running"><p>body</p></Panel>);
    const region = screen.getByRole('region', { name: 'Running' });
    expect(region.className).toContain('sl-panel');
    expect(region.className).toContain('s-running');
    expect(screen.getByText('body')).toBeTruthy();
  });
  it('can have no header', () => {
    const { container } = render(<Panel><p>plain</p></Panel>);
    expect(container.querySelector('h2')).toBeNull();
    expect(screen.getByText('plain')).toBeTruthy();
  });
});
```

`web/src/ui/studio/EmptyState.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('says what is empty and offers one action', () => {
    render(<EmptyState title="No runs yet" description="Start one from Home." action={<button>Start a run</button>} />);
    expect(screen.getByText('No runs yet')).toBeTruthy();
    expect(screen.getByText('Start one from Home.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a run' })).toBeTruthy();
  });
});
```

`web/src/ui/studio/Kbd.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { isApple, Kbd } from './Kbd';

const setPlatform = (p: string) => Object.defineProperty(navigator, 'platform', { value: p, configurable: true });
afterEach(() => setPlatform(''));

describe('Kbd', () => {
  it('shows ⌘ on Apple platforms', () => {
    setPlatform('MacIntel');
    expect(isApple()).toBe(true);
    render(<Kbd mod>K</Kbd>);
    expect(screen.getByText('⌘K').tagName).toBe('KBD');
  });
  it('shows Ctrl elsewhere', () => {
    setPlatform('Win32');
    render(<Kbd mod>K</Kbd>);
    expect(screen.getByText('Ctrl K')).toBeTruthy();
  });
  it('shows a plain key without a modifier', () => {
    render(<Kbd>Esc</Kbd>);
    expect(screen.getByText('Esc')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project web web/src/ui/studio`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`web/src/ui/studio/parts.css`:

```css
/* Shared Studio Live parts. Colours come from the root tokens only. */
.sl-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.sl-meta { margin: 0; font-family: var(--font-code); font-size: 11px; line-height: 1.5; color: var(--mut); }
.sl-screen-header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px 24px; padding: 20px 24px 12px; }
.sl-screen-header h1 { margin: 2px 0 0; font-size: 22px; line-height: 1.2; font-weight: 600; letter-spacing: -0.01em; color: var(--ink); }
.sl-summary { margin: 4px 0 0; max-width: 70ch; color: var(--mut); }
.sl-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.sl-section-heading { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; min-height: 24px; }
.sl-section-heading h2 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0; text-transform: none; color: var(--ink); }
.sl-count { font-family: var(--font-code); font-size: 11px; color: var(--mut); }
.sl-heading-action { margin-left: auto; display: flex; gap: 6px; align-items: center; }
.sl-panel { min-width: 0; padding: 14px 16px; background: var(--s1); border: 1px solid var(--line); border-radius: 12px; }
.sl-list { list-style: none; margin: 0; padding: 0; }
.sl-alert { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--badBg); color: var(--bad); display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.sl-note { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--warnBg); color: var(--warn); }
.sl-empty { padding: 8px 0; }
.sl-kbd { display: inline-block; padding: 0 5px; border: 1px solid var(--line2); border-radius: 4px; background: var(--s1); color: var(--mut); font-family: var(--font-code); font-size: 11px; line-height: 18px; white-space: nowrap; }
```

`web/src/ui/studio/ScreenHeader.tsx`:

```tsx
import type { ReactNode } from 'react';
import './parts.css';

/** The top of a screen: a mono meta line, the title (the page's h1), a summary and right-aligned actions. */
export function ScreenHeader(props: { meta?: ReactNode; title: string; summary?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sl-screen-header">
      <div>
        {props.meta ? <p className="sl-meta">{props.meta}</p> : null}
        <h1>{props.title}</h1>
        {props.summary ? <p className="sl-summary">{props.summary}</p> : null}
      </div>
      {props.actions ? <div className="sl-actions">{props.actions}</div> : null}
    </header>
  );
}
```

`web/src/ui/studio/SectionHeading.tsx`:

```tsx
import type { ReactNode } from 'react';
import './parts.css';

export function SectionHeading(props: { id?: string; title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="sl-section-heading">
      <h2 id={props.id}>{props.title}</h2>
      {props.count !== undefined ? <span className="sl-count">{props.count}</span> : null}
      {props.action ? <div className="sl-heading-action">{props.action}</div> : null}
    </div>
  );
}
```

`web/src/ui/studio/Panel.tsx`:

```tsx
import { useId, type ReactNode } from 'react';
import { cn } from '../cn';
import { SectionHeading } from './SectionHeading';
import './parts.css';

/** A bordered surface. With a title it is a region named by its heading. */
export function Panel(props: { title?: string; count?: number; action?: ReactNode; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={cn('sl-panel', props.className)} aria-labelledby={props.title ? id : undefined}>
      {props.title ? <SectionHeading id={id} title={props.title} count={props.count} action={props.action} /> : null}
      {props.children}
    </section>
  );
}
```

`web/src/ui/studio/EmptyState.tsx`:

```tsx
import type { ReactNode } from 'react';
import { EmptyState as ArcEmptyState } from '../../components/arc/empty-state/empty-state';
import './parts.css';

/** Arc's empty state with Studio spacing: say what is empty and offer one useful action. */
export function EmptyState(props: { title: string; description: string; action?: ReactNode }) {
  return <ArcEmptyState className="sl-empty" title={props.title} description={props.description} action={props.action} />;
}
```

`web/src/ui/studio/Kbd.tsx`:

```tsx
import type { ReactNode } from 'react';
import './parts.css';

export const isApple = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');

/** A keyboard hint. `mod` prefixes the platform's command key: ⌘ on Apple, Ctrl elsewhere. */
export function Kbd(props: { mod?: boolean; children: ReactNode }) {
  const prefix = props.mod ? (isApple() ? '⌘' : 'Ctrl ') : '';
  return (
    <kbd className="sl-kbd">
      {prefix}
      {props.children}
    </kbd>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project web web/src/ui/studio`
Expected: PASS (5 files). If `getByText('⌘K')` fails because the prefix and child are separate text nodes, the default matcher still joins them inside one `<kbd>`; keep the markup as written.

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/studio
git commit -m "feat(web): Studio parts for screen and section headers, panels, empty states and key hints"
```

---

### Task 5: Studio parts II — StatusChip, ListRow, FaceStack, StepTrack

**Files:**
- Create: `web/src/ui/studio/StatusChip.tsx`, `ListRow.tsx`, `FaceStack.tsx`, `StepTrack.tsx`, `steps.ts`
- Modify: `web/src/ui/studio/parts.css` (append)
- Test: `web/src/ui/studio/StatusChip.test.tsx`, `ListRow.test.tsx`, `FaceStack.test.tsx`, `StepTrack.test.tsx`

**Interfaces:**
- Consumes: `Face` from `web/src/Face.tsx` (`{ id; mood?; size?; label?; animate? }`), `cn`.
- Produces:
  - `type Tone = 'live' | 'needs' | 'done' | 'failed' | 'neutral'`; `toneFor(status?: string): Tone` (running→live, paused/awaiting→needs, done→done, error→failed, else neutral).
  - `StatusChip(props: { tone: Tone; label: string; pulse?: boolean; className?: string })`.
  - `ListRow(props: { lead?: ReactNode; title: ReactNode; onOpen?: () => void; meta?: ReactNode; extra?: ReactNode; age?: ReactNode; actions?: ReactNode; className?: string })` → an `<li class="sl-row">`.
  - `FaceStack(props: { bots: string[]; working?: string; size?: number; max?: number })`.
  - `type SegState = 'done' | 'working' | 'waiting' | 'queued' | 'failed' | 'skipped' | 'planning'`; `segmentsFor(steps: { id: string; status: string; title?: string }[], o?: { planning?: boolean }): { id: string; state: SegState; label: string }[]`; `trackLabel(segs): string`.
  - `StepTrack(props: { steps: { id: string; status: string; title?: string }[]; planning?: boolean; className?: string })`.

- [ ] **Step 1: Write the failing tests**

`web/src/ui/studio/StatusChip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusChip, toneFor } from './StatusChip';

describe('StatusChip', () => {
  it('maps run and step statuses to meaning colours', () => {
    expect(toneFor('running')).toBe('live');
    expect(toneFor('awaiting')).toBe('needs');
    expect(toneFor('paused')).toBe('needs');
    expect(toneFor('done')).toBe('done');
    expect(toneFor('error')).toBe('failed');
    expect(toneFor('stopped')).toBe('neutral');
    expect(toneFor(undefined)).toBe('neutral');
  });
  it('always pairs the colour with its text, and pulses only when asked', () => {
    const { container, rerender } = render(<StatusChip tone="live" label="running" pulse />);
    expect(screen.getByText('running').closest('.sl-chip')!.className).toContain('t-live');
    expect(container.querySelector('.sl-dot.pulse')).toBeTruthy();
    rerender(<StatusChip tone="done" label="done" />);
    expect(container.querySelector('.sl-dot.pulse')).toBeNull();
    expect(container.querySelector('.sl-dot')!.getAttribute('aria-hidden')).toBe('true');
  });
});
```

`web/src/ui/studio/ListRow.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ListRow } from './ListRow';

describe('ListRow', () => {
  it('lays out lead, title, meta, extra, age and actions in a list item', () => {
    render(
      <ul>
        <ListRow lead={<span>L</span>} title="Fix login" meta="r1 · aorch/r1" extra={<div>track</div>} age="2m ago" actions={<button>Open</button>} />
      </ul>,
    );
    const li = screen.getByRole('listitem');
    expect(li.className).toContain('sl-row');
    for (const t of ['L', 'Fix login', 'r1 · aorch/r1', 'track', '2m ago']) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });
  it('makes the title a button when the row opens something', () => {
    const onOpen = vi.fn();
    render(<ul><ListRow title="Team run" onOpen={onOpen} /></ul>);
    fireEvent.click(screen.getByRole('button', { name: 'Team run' }));
    expect(onOpen).toHaveBeenCalled();
  });
});
```

`web/src/ui/studio/FaceStack.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FaceStack } from './FaceStack';

describe('FaceStack', () => {
  it('overlaps faces with names and breathes only the working bot', () => {
    const { container } = render(<FaceStack bots={['planner', 'coder', 'reviewer']} working="coder" />);
    expect(screen.getByRole('img', { name: 'Bolt' }).getAttribute('data-mood')).toBe('working');
    expect(screen.getByRole('img', { name: 'Scout' }).getAttribute('data-mood')).toBe('idle');
    // only the working face is the animated (span) form
    expect(container.querySelectorAll('span.face')).toHaveLength(1);
  });
  it('folds faces past the maximum into a count', () => {
    render(<FaceStack bots={['planner', 'coder', 'reviewer', 'architect']} max={2} />);
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByLabelText('and 2 more')).toBeTruthy();
  });
  it('draws nothing for no bots', () => {
    const { container } = render(<FaceStack bots={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
```

`web/src/ui/studio/StepTrack.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { segmentsFor, trackLabel } from './steps';
import { StepTrack } from './StepTrack';

describe('StepTrack', () => {
  const steps = [
    { id: 'plan', status: 'done', title: 'Plan' },
    { id: 'code', status: 'running', title: 'Implement' },
    { id: 'ok', status: 'awaiting', title: 'Ship it' },
    { id: 'lint', status: 'skipped' },
    { id: 'gate', status: 'queued' },
    { id: 'rev', status: 'error' },
  ];
  it('maps statuses to segment states', () => {
    expect(segmentsFor(steps).map((s) => s.state)).toEqual(['done', 'working', 'waiting', 'skipped', 'queued', 'failed']);
  });
  it('shows one planning segment for a team run before its plan is approved', () => {
    expect(segmentsFor([], { planning: true })).toEqual([{ id: 'planning', state: 'planning', label: 'planning' }]);
    expect(segmentsFor([])).toEqual([]);
  });
  it('renders segments with an accessible summary', () => {
    const { container } = render(<StepTrack steps={steps} />);
    expect(screen.getByRole('img', { name: trackLabel(segmentsFor(steps)) })).toBeTruthy();
    expect(trackLabel(segmentsFor(steps))).toBe('1 of 6 steps done, 1 working, 1 waiting, 1 failed');
    expect(container.querySelectorAll('.sl-seg')).toHaveLength(6);
    expect(container.querySelector('.sl-seg.s-working')).toBeTruthy();
    expect(container.querySelector('.sl-seg.s-skipped')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project web web/src/ui/studio`
Expected: FAIL — the four new modules are missing.

- [ ] **Step 3: Write the implementation**

`web/src/ui/studio/StatusChip.tsx`:

```tsx
import { cn } from '../cn';
import './parts.css';

export type Tone = 'live' | 'needs' | 'done' | 'failed' | 'neutral';

/** Colour carries meaning only: blue live/working, amber needs you, green done, red failed. */
export function toneFor(status?: string): Tone {
  switch (status) {
    case 'running':
      return 'live';
    case 'paused':
    case 'awaiting':
      return 'needs';
    case 'done':
      return 'done';
    case 'error':
      return 'failed';
    default:
      return 'neutral';
  }
}

/** Label + dot on a tinted fill with the status colour as text. `pulse` only for live states; the text label always stays. */
export function StatusChip(props: { tone: Tone; label: string; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('sl-chip', `t-${props.tone}`, props.className)}>
      <span className={cn('sl-dot', { pulse: !!props.pulse })} aria-hidden="true" />
      {props.label}
    </span>
  );
}
```

`web/src/ui/studio/ListRow.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '../cn';
import './parts.css';

export interface ListRowProps {
  lead?: ReactNode;
  title: ReactNode;
  /** The title becomes a button that opens the row's subject. */
  onOpen?: () => void;
  meta?: ReactNode;
  /** A full-width line under the title (a step track, a "what's happening now" line). */
  extra?: ReactNode;
  age?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** A hairline row: leading marker or face, title and mono meta, trailing age and actions. Lives in a `.sl-list`. */
export function ListRow(p: ListRowProps) {
  return (
    <li className={cn('sl-row', p.className)}>
      <div className="sl-row-lead">{p.lead}</div>
      <div className="sl-row-main">
        {p.onOpen ? (
          <button type="button" className="sl-row-title" onClick={p.onOpen}>
            {p.title}
          </button>
        ) : (
          <span className="sl-row-title">{p.title}</span>
        )}
        {p.meta ? <span className="sl-row-meta">{p.meta}</span> : null}
      </div>
      <div className="sl-row-side">
        {p.age ? <span className="sl-age">{p.age}</span> : null}
        {p.actions}
      </div>
      {p.extra ? <div className="sl-row-extra">{p.extra}</div> : null}
    </li>
  );
}
```

`web/src/ui/studio/FaceStack.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { Face } from '../../Face';
import './parts.css';

/** Overlapping faces of a run's bots; the working bot breathes, the rest are still. */
export function FaceStack(props: { bots: string[]; working?: string; size?: number; max?: number }) {
  const max = props.max ?? 4;
  const size = props.size ?? 24;
  if (!props.bots.length) return null;
  const shown = props.bots.slice(0, max);
  const more = props.bots.length - shown.length;
  return (
    <span className="sl-facestack" style={{ '--face': `${size}px` } as CSSProperties}>
      {shown.map((b) =>
        b === props.working ? <Face key={b} id={b} size={size} mood="working" animate="always" /> : <Face key={b} id={b} size={size} mood="idle" />,
      )}
      {more > 0 ? (
        <span className="sl-facestack-more" aria-label={`and ${more} more`}>
          +{more}
        </span>
      ) : null}
    </span>
  );
}
```

`web/src/ui/studio/steps.ts`:

```ts
export type SegState = 'done' | 'working' | 'waiting' | 'queued' | 'failed' | 'skipped' | 'planning';
export interface StepLike { id: string; status: string; title?: string }
export interface Segment { id: string; state: SegState; label: string }

const STATE: Record<string, SegState> = { done: 'done', running: 'working', awaiting: 'waiting', queued: 'queued', error: 'failed', skipped: 'skipped' };

/** One segment per step in pipeline order. A team run before its plan is approved has no steps: one "planning" segment. */
export function segmentsFor(steps: StepLike[], o: { planning?: boolean } = {}): Segment[] {
  if (!steps.length) return o.planning ? [{ id: 'planning', state: 'planning', label: 'planning' }] : [];
  return steps.map((s) => ({ id: s.id, state: STATE[s.status] ?? 'queued', label: `${s.title ?? s.id}: ${s.status}` }));
}

export function trackLabel(segs: Segment[]): string {
  if (segs.length === 1 && segs[0]!.state === 'planning') return 'planning';
  const n = (st: SegState) => segs.filter((s) => s.state === st).length;
  const parts = [`${n('done')} of ${segs.length} steps done`];
  if (n('working')) parts.push(`${n('working')} working`);
  if (n('waiting')) parts.push(`${n('waiting')} waiting`);
  if (n('failed')) parts.push(`${n('failed')} failed`);
  return parts.join(', ');
}
```

`web/src/ui/studio/StepTrack.tsx`:

```tsx
import { cn } from '../cn';
import { segmentsFor, trackLabel, type StepLike } from './steps';
import './parts.css';

/** A run's steps as a segmented bar: done, working (moving stripes), waiting (pulse), queued; skipped steps are hairlines. */
export function StepTrack(props: { steps: StepLike[]; planning?: boolean; className?: string }) {
  const segs = segmentsFor(props.steps, { planning: props.planning });
  if (!segs.length) return null;
  return (
    <div className={cn('sl-steptrack', props.className)} role="img" aria-label={trackLabel(segs)}>
      {segs.map((s) => (
        <span key={s.id} className={cn('sl-seg', `s-${s.state}`)} title={s.label} />
      ))}
    </div>
  );
}
```

Append to `web/src/ui/studio/parts.css`:

```css
/* ListRow */
.sl-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; padding: 10px 6px; border-top: 1px solid var(--line); border-radius: 8px; transition: background-color var(--t-fast) var(--ease); }
.sl-row:first-child { border-top-color: transparent; }
.sl-row:hover { background: var(--s2); }
.sl-row-lead:empty { display: none; }
.sl-row-main { display: flex; flex-direction: column; min-width: 0; }
.sl-row-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--ink); }
button.sl-row-title { padding: 0; border: 0; background: none; font: inherit; font-weight: 500; text-align: left; cursor: pointer; }
button.sl-row-title:hover { text-decoration: underline; text-underline-offset: 2px; }
.sl-row-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-code); font-size: 11px; color: var(--mut); }
.sl-row-side { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: flex-end; }
.sl-row-extra { grid-column: 2 / -1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.sl-age { font-family: var(--font-code); font-size: 11px; color: var(--mut); white-space: nowrap; }

/* StatusChip */
.sl-chip { display: inline-flex; align-items: center; gap: 6px; padding: 1px 8px; border-radius: 6px; font-size: 11px; line-height: 18px; font-weight: 500; white-space: nowrap; background: var(--s2); color: var(--mut); }
.sl-chip.t-live { background: var(--accBg); color: var(--accInk); }
.sl-chip.t-needs { background: var(--warnBg); color: var(--warn); }
.sl-chip.t-done { background: var(--okBg); color: var(--ok); }
.sl-chip.t-failed { background: var(--badBg); color: var(--bad); }
.sl-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: currentColor; }
.sl-chip.t-live .sl-dot { background: var(--acc); }
.sl-dot.pulse { animation: sl-pulse 1.4s var(--ease) infinite; }
@keyframes sl-pulse { 50% { opacity: .35; } }

/* FaceStack: faces on their squircle; on light a --line2 hairline keeps the shape visible */
.sl-facestack { display: inline-flex; align-items: center; }
.sl-facestack > .face { margin-left: calc(var(--face) * -0.3); border-radius: 30%; box-shadow: 0 0 0 2px var(--s1); }
.sl-facestack > .face:first-child { margin-left: 0; }
:root:not([data-theme="dark"]) .sl-facestack > .face { box-shadow: 0 0 0 1px var(--line2), 0 0 0 3px var(--s1); }
.sl-facestack-more { margin-left: 6px; font-family: var(--font-code); font-size: 11px; color: var(--mut); }

/* StepTrack */
.sl-steptrack { display: flex; align-items: center; gap: 3px; height: 6px; min-width: 0; }
.sl-seg { position: relative; flex: 1 1 0; height: 6px; overflow: hidden; border-radius: 2px; background: var(--s3); }
.sl-seg.s-done { background: var(--ok); }
.sl-seg.s-failed { background: var(--bad); }
.sl-seg.s-waiting { background: var(--warn); animation: sl-pulse 1.4s var(--ease) infinite; }
.sl-seg.s-working, .sl-seg.s-planning { background: var(--accBg); }
/* stripes: a solid --acc fill cut by a mask (not a gradient fill), moving while the step works */
.sl-seg.s-working::after, .sl-seg.s-planning::after {
  content: ''; position: absolute; inset: 0 -12px 0 0; background: var(--acc);
  -webkit-mask-image: repeating-linear-gradient(135deg, black 0 4px, transparent 4px 8px); mask-image: repeating-linear-gradient(135deg, black 0 4px, transparent 4px 8px);
  animation: sl-stripes .8s linear infinite;
}
@keyframes sl-stripes { to { transform: translateX(-11.3px); } }
.sl-seg.s-skipped { flex: 0 0 10px; height: 1px; background: var(--line2); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project web web/src/ui/studio web/src/rules.test.ts`
Expected: PASS (the rules test still passes: stripes use `mask-image`, not a background gradient; `box-shadow: 0 0 0 2px` has no blur).

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/studio
git commit -m "feat(web): Studio parts for status chips, list rows, face stacks and step tracks"
```

---

## Phase 2 — Shell

### Task 6: Hash routes for the new shell, and poll failure counts

**Files:**
- Modify: `web/src/hooks.ts`
- Modify: `web/src/App.tsx`, `web/src/CommandMenu.tsx` (imports only)
- Test: `web/src/hooks.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces (from `web/src/hooks.ts`):
  - `type Screen = 'home' | 'runs' | 'builder' | 'crew' | 'api' | 'graph' | 'triggers'`; `type Tab = Screen | 'settings'`.
  - `SCREENS: Screen[]` (that order); `TAB_LABEL: Record<Tab, string>`.
  - `interface Route { tab: Tab; id?: string; node?: string }` — `id`: run id, workflow name, bot id or note path; `node`: a step of the run (runs only).
  - `parseHash(h: string): Route` (empty or unknown → `{ tab: 'home' }`), `hashFor(r: Route): string`.
  - `useHashRoute(block?: (next: Route, current: Route) => boolean, onBlocked?: (next: Route) => void): [Route, (r: Route) => void]` — a blocked `hashchange` restores the previous hash with `history.replaceState` and calls `onBlocked`; changes made through the returned `go` are never blocked.
  - `Poll<T>` gains `fails: number` (failures in a row).
  - `TABS` is removed (use `SCREENS`).

- [ ] **Step 1: Write the failing tests** — in `web/src/hooks.test.tsx`, replace the whole `describe('hash routes', …)` block and add a `fails` test inside `describe('usePoll', …)`:

```tsx
  it('counts failures in a row and resets on success', async () => {
    apiMock.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => usePoll('/api/x', 1000));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current.fails).toBe(3);
    apiMock.mockResolvedValue({});
    await act(() => vi.advanceTimersByTimeAsync(BACKOFF_MS));
    expect(result.current.fails).toBe(0);
  });
```

```tsx
describe('hash routes', () => {
  it('parses and formats', () => {
    expect(parseHash('#/runs/r-1')).toEqual({ tab: 'runs', id: 'r-1' });
    expect(parseHash('#/runs/r-1/code')).toEqual({ tab: 'runs', id: 'r-1', node: 'code' });
    expect(parseHash('#/crew')).toEqual({ tab: 'crew' });
    expect(parseHash('#/crew/quill')).toEqual({ tab: 'crew', id: 'quill' });
    expect(parseHash('#/graph/runs%2Fr1.md')).toEqual({ tab: 'graph', id: 'runs/r1.md' });
    expect(parseHash('#/settings')).toEqual({ tab: 'settings' });
    expect(parseHash('')).toEqual({ tab: 'home' });
    expect(parseHash('#/nope')).toEqual({ tab: 'home' });
    expect(parseHash('#/runs/%E0')).toEqual({ tab: 'runs', id: '%E0' });
    expect(hashFor({ tab: 'builder', id: 'my flow' })).toBe('#/builder/my%20flow');
    expect(hashFor({ tab: 'runs', id: 'r1', node: 'code' })).toBe('#/runs/r1/code');
    expect(hashFor({ tab: 'graph', id: 'runs/r1.md' })).toBe('#/graph/runs%2Fr1.md');
    expect(parseHash(hashFor({ tab: 'builder', id: 'my flow' }))).toEqual({ tab: 'builder', id: 'my flow' });
  });

  it('lists the screens in rail order', () => {
    expect(SCREENS).toEqual(['home', 'runs', 'builder', 'crew', 'api', 'graph', 'triggers']);
    expect(TAB_LABEL.settings).toBe('Settings');
  });

  it('follows hashchange and sets the hash', () => {
    const { result } = renderHook(() => useHashRoute());
    act(() => result.current[1]({ tab: 'graph' }));
    expect(location.hash).toBe('#/graph');
    act(() => {
      location.hash = '#/runs/r9';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current[0]).toEqual({ tab: 'runs', id: 'r9' });
  });

  it('restores the hash and reports a blocked browser navigation', () => {
    location.hash = '#/api';
    const onBlocked = vi.fn();
    const { result } = renderHook(() => useHashRoute((next, cur) => cur.tab === 'api' && next.tab !== 'api', onBlocked));
    act(() => {
      location.hash = '#/crew';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(onBlocked).toHaveBeenCalledWith({ tab: 'crew' });
    expect(location.hash).toBe('#/api');
    expect(result.current[0]).toEqual({ tab: 'api' });
  });

  it('never blocks its own navigation', () => {
    location.hash = '#/api';
    const onBlocked = vi.fn();
    const { result } = renderHook(() => useHashRoute(() => true, onBlocked));
    act(() => result.current[1]({ tab: 'crew' }));
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(onBlocked).not.toHaveBeenCalled();
    expect(result.current[0]).toEqual({ tab: 'crew' });
  });
});
```

Update the import line to `import { BACKOFF_MS, hashFor, parseHash, SCREENS, TAB_LABEL, usePoll, useHashRoute } from './hooks';`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project web web/src/hooks.test.tsx`
Expected: FAIL — `SCREENS` is undefined; `parseHash('')` returns `builder`; `fails` is undefined.

- [ ] **Step 3: Write the implementation** — in `web/src/hooks.ts`:

Change `Poll<T>` and `usePoll` to track failures:

```ts
export interface Poll<T> {
  data: T | undefined;
  error: string | undefined;
  /** Failures in a row (0 after a success). */
  fails: number;
  refresh: () => Promise<void>;
}
```

Inside `usePoll`, add `const [failCount, setFailCount] = useState(0);`, set `setFailCount(0)` next to `fails.current = 0;` and `setFailCount(fails.current)` right after `fails.current++;`, and return `{ data, error, fails: failCount, refresh: tick }`.

Replace everything from `export type Tab = …` to the end of the file with:

```ts
export type Screen = 'home' | 'runs' | 'builder' | 'crew' | 'api' | 'graph' | 'triggers';
export type Tab = Screen | 'settings';
export const SCREENS: Screen[] = ['home', 'runs', 'builder', 'crew', 'api', 'graph', 'triggers'];
const TAB_IDS: readonly string[] = [...SCREENS, 'settings'];
export const TAB_LABEL: Record<Tab, string> = { home: 'Home', runs: 'Runs', builder: 'Builder', crew: 'Crew', api: 'API', graph: 'Graph', triggers: 'Triggers', settings: 'Settings' };

export interface Route {
  tab: Tab;
  /** Runs: the run id. Builder: a saved workflow. Crew: a bot id. Graph: a note path. */
  id?: string;
  /** Runs: a step of the run, selected in the Inspector. */
  node?: string;
}

export function parseHash(h: string): Route {
  const [t, id, node] = h.replace(/^#\/?/, '').split('/');
  if (!TAB_IDS.includes(t ?? '')) return { tab: 'home' };
  const r: Route = { tab: t as Tab };
  if (id) r.id = safeDecode(id);
  if (id && node && r.tab === 'runs') r.node = safeDecode(node);
  return r;
}

/** A hand-typed or truncated link may hold a malformed escape (`%E0`): keep the raw id instead of throwing. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export const hashFor = (r: Route): string =>
  `#/${r.tab}${r.id ? `/${encodeURIComponent(r.id)}${r.node ? `/${encodeURIComponent(r.node)}` : ''}` : ''}`;

/**
 * The route in the URL hash. `block` is asked about every hash change the person makes outside the app (Back, Forward,
 * a typed hash): when it says yes the previous hash is put back and `onBlocked` gets the destination. Changes made with
 * the returned `go` are never blocked (the caller has already decided).
 */
export function useHashRoute(block?: (next: Route, current: Route) => boolean, onBlocked?: (next: Route) => void): [Route, (r: Route) => void] {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  const current = useRef(route);
  current.current = route;
  const guard = useRef({ block, onBlocked });
  guard.current = { block, onBlocked };
  /** The hash `go` just set: its hashchange is ours, not the person's. */
  const expected = useRef<string | null>(null);

  useEffect(() => {
    const on = () => {
      const next = parseHash(location.hash);
      if (expected.current !== null && expected.current === location.hash) {
        expected.current = null;
        setRoute(next);
        return;
      }
      if (guard.current.block?.(next, current.current)) {
        history.replaceState(history.state, '', hashFor(current.current));
        guard.current.onBlocked?.(next);
        return;
      }
      setRoute(next);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const go = useCallback((r: Route) => {
    const h = hashFor(r);
    if (location.hash !== h) {
      expected.current = h;
      location.hash = h;
    }
    current.current = r;
    setRoute(r);
  }, []);
  return [route, go];
}
```

In `web/src/App.tsx` replace `TAB_LABEL, TABS, … type Tab` in the hooks import with `SCREENS, TAB_LABEL, … type Screen`, map `SCREENS` instead of `TABS` in the tab list, and type `openTab` as `(t: Screen)`. In `web/src/CommandMenu.tsx` replace `TABS`/`Tab` with `SCREENS`/`Screen` the same way. (Until Task 9 the Home tab shows an empty main.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project web web/src/hooks.test.tsx web/src/App.test.tsx && npm run typecheck`
Expected: PASS. If an `App.test.tsx` case relied on the Builder default, it is rewritten in Task 9; it should still pass here because every case sets an explicit hash or does not depend on the default screen.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks.ts web/src/hooks.test.tsx web/src/App.tsx web/src/CommandMenu.tsx
git commit -m "feat(web): hash routes for Home, Settings and step links, with a guard for browser navigation"
```

---

### Task 7: Rail and bottom bar

**Files:**
- Create: `web/src/ui/studio/nav.ts`, `useMediaQuery.ts`, `Rail.tsx`, `BottomBar.tsx`, `shell.css`
- Test: `web/src/ui/studio/Rail.test.tsx`, `BottomBar.test.tsx`, `useMediaQuery.test.tsx`

**Interfaces:**
- Consumes: `Screen`, `TAB_LABEL` (Task 6); `Kbd` (Task 4); lucide icons `House, ListChecks, Workflow, Users, Braces, Network, Zap, Settings, Search, Ellipsis`.
- Produces:
  - `NAV: { id: Screen; label: string; Icon: LucideIcon }[]` (rail order).
  - `useMediaQuery(query: string): boolean`; `PHONE = '(max-width: 899px)'`; `BELOW_WIDE = '(max-width: 1199px)'`.
  - `Rail(props: RailProps)`; `interface RailProps { active: Screen; settingsOpen?: boolean; onGo: (s: Screen) => void; onSearch: () => void; onSettings: () => void }`.
  - `BottomBar(props: Omit<RailProps, 'onSearch'>)`.

- [ ] **Step 1: Write the failing tests**

`web/src/ui/studio/useMediaQuery.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PHONE, useMediaQuery } from './useMediaQuery';

describe('useMediaQuery', () => {
  it('reads the query and follows changes', () => {
    let matches = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (q: string) => ({ get matches() { return q === PHONE && matches; }, media: q, addEventListener: (_: string, f: () => void) => listeners.add(f), removeEventListener: (_: string, f: () => void) => listeners.delete(f) }));
    const { result } = renderHook(() => useMediaQuery(PHONE));
    expect(result.current).toBe(true);
    act(() => { matches = false; listeners.forEach((f) => f()); });
    expect(result.current).toBe(false);
  });
});
```

`web/src/ui/studio/Rail.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Rail } from './Rail';

const setup = (o: { active?: Parameters<typeof Rail>[0]['active']; settingsOpen?: boolean } = {}) => {
  const p = { onGo: vi.fn(), onSearch: vi.fn(), onSettings: vi.fn() };
  render(<Rail active={o.active ?? 'home'} settingsOpen={o.settingsOpen} {...p} />);
  return p;
};

describe('Rail', () => {
  it('is the main navigation with every screen, search on top and Settings at the bottom', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const names = [...nav.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Search or jump to', 'Home', 'Runs', 'Builder', 'Crew', 'API', 'Graph', 'Triggers', 'Settings']);
  });

  it('marks the active screen and goes where it is clicked', () => {
    const p = setup({ active: 'runs' });
    expect(screen.getByRole('button', { name: 'Runs' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Crew' }));
    expect(p.onGo).toHaveBeenCalledWith('crew');
    fireEvent.click(screen.getByRole('button', { name: 'Search or jump to' }));
    expect(p.onSearch).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(p.onSettings).toHaveBeenCalled();
  });

  it('marks Settings while its drawer is open', () => {
    setup({ active: 'api', settingsOpen: true });
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'API' }).getAttribute('aria-current')).toBeNull();
  });

  it('moves focus with arrow keys, Home and End (roving tabindex)', () => {
    setup({ active: 'home' });
    const home = screen.getByRole('button', { name: 'Home' });
    expect(home.tabIndex).toBe(0);
    expect(screen.getByRole('button', { name: 'Runs' }).tabIndex).toBe(-1);
    home.focus();
    fireEvent.keyDown(home, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Runs' }));
    expect(screen.getByRole('button', { name: 'Runs' }).tabIndex).toBe(0);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search or jump to' }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search or jump to' }));
  });

  it('shows the label tooltip 300 ms after hover or focus', () => {
    vi.useFakeTimers();
    setup();
    const crew = screen.getByRole('button', { name: 'Crew' });
    fireEvent.pointerEnter(crew);
    act(() => vi.advanceTimersByTime(299));
    expect(document.querySelector('.sl-rail-tip')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(document.querySelector('.sl-rail-tip')!.textContent).toBe('Crew');
    fireEvent.pointerLeave(crew);
    expect(document.querySelector('.sl-rail-tip')).toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: 'Graph' }));
    act(() => vi.advanceTimersByTime(300));
    expect(document.querySelector('.sl-rail-tip')!.textContent).toBe('Graph');
  });
});
```

`web/src/ui/studio/BottomBar.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BottomBar } from './BottomBar';

describe('BottomBar', () => {
  it('shows five screens and a More menu with Graph, Triggers and Settings', () => {
    const onGo = vi.fn();
    const onSettings = vi.fn();
    render(<BottomBar active="home" onGo={onGo} onSettings={onSettings} />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect([...nav.querySelectorAll(':scope > button')].map((b) => b.textContent)).toEqual(['Home', 'Runs', 'Builder', 'Crew', 'API', 'More']);
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    const more = screen.getByRole('button', { name: 'More' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Graph', 'Triggers', 'Settings']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Graph' }));
    expect(onGo).toHaveBeenCalledWith('graph');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(onSettings).toHaveBeenCalled();
  });

  it('closes the menu with Escape and marks More while a screen inside it is active', () => {
    render(<BottomBar active="triggers" onGo={() => {}} onSettings={() => {}} />);
    const more = screen.getByRole('button', { name: 'More' });
    expect(more.getAttribute('aria-current')).toBe('page');
    fireEvent.click(more);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project web web/src/ui/studio/Rail.test.tsx web/src/ui/studio/BottomBar.test.tsx web/src/ui/studio/useMediaQuery.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`web/src/ui/studio/nav.ts`:

```ts
import { Braces, House, ListChecks, Network, Users, Workflow, Zap, type LucideIcon } from 'lucide-react';
import { TAB_LABEL, type Screen } from '../../hooks';

export const NAV: { id: Screen; label: string; Icon: LucideIcon }[] = [
  { id: 'home', label: TAB_LABEL.home, Icon: House },
  { id: 'runs', label: TAB_LABEL.runs, Icon: ListChecks },
  { id: 'builder', label: TAB_LABEL.builder, Icon: Workflow },
  { id: 'crew', label: TAB_LABEL.crew, Icon: Users },
  { id: 'api', label: TAB_LABEL.api, Icon: Braces },
  { id: 'graph', label: TAB_LABEL.graph, Icon: Network },
  { id: 'triggers', label: TAB_LABEL.triggers, Icon: Zap },
];
```

`web/src/ui/studio/useMediaQuery.ts`:

```ts
import { useEffect, useState } from 'react';

export const PHONE = '(max-width: 899px)';
export const BELOW_WIDE = '(max-width: 1199px)';

/** True while the media query matches; follows changes. False where matchMedia is missing (the wide layout). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query)?.matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    setMatches(m.matches);
    const on = () => setMatches(m.matches);
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}
```

`web/src/ui/studio/Rail.tsx`:

```tsx
import { Search, Settings, type LucideIcon } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import type { Screen } from '../../hooks';
import { cn } from '../cn';
import { Kbd } from './Kbd';
import { NAV } from './nav';
import './shell.css';

const TIP_DELAY_MS = 300;

export interface RailProps {
  active: Screen;
  /** The Settings drawer is open over the active screen. */
  settingsOpen?: boolean;
  onGo: (s: Screen) => void;
  onSearch: () => void;
  onSettings: () => void;
}

interface Item { key: string; label: string; Icon: LucideIcon; pick: () => void; current: boolean }

/** The left icon rail: ⌘K search, the screens, Settings at the bottom. One tab stop; arrows, Home and End move inside. */
export function Rail(p: RailProps) {
  const items: Item[] = [
    { key: 'search', label: 'Search or jump to', Icon: Search, pick: p.onSearch, current: false },
    ...NAV.map((n) => ({ key: n.id, label: n.label, Icon: n.Icon, pick: () => p.onGo(n.id), current: !p.settingsOpen && n.id === p.active })),
    { key: 'settings', label: 'Settings', Icon: Settings, pick: p.onSettings, current: !!p.settingsOpen },
  ];
  const activeIndex = Math.max(0, items.findIndex((i) => i.current));
  const [focus, setFocus] = useState<number>();
  const stop = focus ?? activeIndex;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [tip, setTip] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showTip = (key: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setTip(key), TIP_DELAY_MS);
  };
  const hideTip = () => {
    clearTimeout(timer.current);
    setTip(undefined);
  };
  const move = (i: number) => {
    const n = (i + items.length) % items.length;
    setFocus(n);
    refs.current[n]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const at = refs.current.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    const to: Record<string, number> = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: items.length - 1 };
    if (!(e.key in to)) return;
    e.preventDefault();
    move(to[e.key]!);
  };

  return (
    <nav className="sl-rail" aria-label="Main" onKeyDown={onKeyDown}>
      {items.map((it, i) => (
        <div key={it.key} className={cn('sl-rail-slot', { 'sl-rail-bottom': it.key === 'settings' })}>
          <button
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            className={cn('sl-rail-btn', { current: it.current })}
            aria-label={it.label}
            aria-current={it.current ? 'page' : undefined}
            tabIndex={i === stop ? 0 : -1}
            onClick={() => {
              setFocus(i);
              it.pick();
            }}
            onFocus={() => {
              setFocus(i);
              showTip(it.key);
            }}
            onBlur={hideTip}
            onPointerEnter={() => showTip(it.key)}
            onPointerLeave={hideTip}
          >
            <it.Icon size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {tip === it.key ? (
            <span className="sl-rail-tip" aria-hidden="true">
              {it.label}
              {it.key === 'search' ? <Kbd mod>K</Kbd> : null}
            </span>
          ) : null}
        </div>
      ))}
    </nav>
  );
}
```

Note: the search tooltip's text is `Search or jump to⌘K`; the test only checks plain items.

`web/src/ui/studio/BottomBar.tsx`:

```tsx
import { Ellipsis, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Screen } from '../../hooks';
import { cn } from '../cn';
import { NAV } from './nav';
import type { RailProps } from './Rail';
import './shell.css';

const MAIN: Screen[] = ['home', 'runs', 'builder', 'crew', 'api'];
const MORE = NAV.filter((n) => !MAIN.includes(n.id));

/** Under 900 px: five screens and a More menu (Graph, Triggers, Settings). */
export function BottomBar(p: Omit<RailProps, 'onSearch'>) {
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreActive = !!p.settingsOpen || MORE.some((n) => n.id === p.active);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && e.target !== moreRef.current) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  const close = () => {
    setOpen(false);
    moreRef.current?.focus();
  };

  return (
    <nav className="sl-bottombar" aria-label="Main">
      {NAV.filter((n) => MAIN.includes(n.id)).map((n) => (
        <button key={n.id} type="button" className={cn('sl-bottom-btn', { current: !p.settingsOpen && p.active === n.id })} aria-current={!p.settingsOpen && p.active === n.id ? 'page' : undefined} onClick={() => p.onGo(n.id)}>
          <n.Icon size={18} strokeWidth={1.75} aria-hidden="true" />
          {n.label}
        </button>
      ))}
      <button ref={moreRef} type="button" className={cn('sl-bottom-btn', { current: moreActive })} aria-haspopup="menu" aria-expanded={open} aria-current={moreActive ? 'page' : undefined} onClick={() => setOpen((o) => !o)}>
        <Ellipsis size={18} strokeWidth={1.75} aria-hidden="true" />
        More
      </button>
      {open ? (
        <div ref={menuRef} className="sl-bottom-menu" role="menu" aria-label="More" onKeyDown={(e) => e.key === 'Escape' && close()}>
          {MORE.map((n) => (
            <button key={n.id} type="button" role="menuitem" onClick={() => (setOpen(false), p.onGo(n.id))}>
              <n.Icon size={16} aria-hidden="true" />
              {n.label}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => (setOpen(false), p.onSettings())}>
            <Settings size={16} aria-hidden="true" />
            Settings
          </button>
        </div>
      ) : null}
    </nav>
  );
}
```

The test's `nav.querySelectorAll(':scope > button')` excludes menu items (they live inside the menu `div`).

`web/src/ui/studio/shell.css`:

```css
/* Rail (900 px and wider) */
.sl-rail { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 56px; height: 100%; padding: 10px 0; background: var(--s1); border-right: 1px solid var(--line); }
.sl-rail-slot { position: relative; }
.sl-rail-slot:first-child { margin-bottom: 8px; }
.sl-rail-bottom { margin-top: auto; }
.sl-rail-btn { position: relative; display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 8px; background: none; color: var(--mut); cursor: pointer; transition: background-color var(--t-fast) var(--ease), color var(--t-fast) var(--ease); }
.sl-rail-btn:hover { background: var(--s2); color: var(--ink); }
.sl-rail-btn.current { background: var(--s2); color: var(--ink); }
.sl-rail-btn.current::before { content: ''; position: absolute; left: -10px; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; background: var(--acc); }
.sl-rail-tip { position: absolute; left: calc(100% + 10px); top: 50%; z-index: 30; display: inline-flex; gap: 8px; align-items: center; padding: 4px 8px; transform: translateY(-50%); white-space: nowrap; border-radius: 6px; background: var(--ink); color: var(--bg); font-size: 12px; pointer-events: none; }
.sl-rail-tip .sl-kbd { background: transparent; color: var(--bg); border-color: var(--bg); }

/* Bottom bar (under 900 px) */
.sl-bottombar { position: relative; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); padding: 4px 4px calc(4px + env(safe-area-inset-bottom)); background: var(--s1); border-top: 1px solid var(--line); }
.sl-bottom-btn { display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 48px; padding: 6px 2px; border: 0; border-radius: 8px; background: none; color: var(--mut); font: inherit; font-size: 11px; cursor: pointer; }
.sl-bottom-btn.current { color: var(--ink); background: var(--s2); }
.sl-bottom-menu { position: absolute; right: 8px; bottom: calc(100% + 6px); z-index: 30; display: flex; flex-direction: column; min-width: 180px; padding: 4px; background: var(--s1); border: 1px solid var(--line2); border-radius: 10px; }
.sl-bottom-menu [role="menuitem"] { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border: 0; border-radius: 8px; background: none; color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
.sl-bottom-menu [role="menuitem"]:hover, .sl-bottom-menu [role="menuitem"]:focus-visible { background: var(--s2); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project web web/src/ui/studio web/src/rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/studio
git commit -m "feat(web): rail and phone bottom bar navigation"
```

---

### Task 8: Settings drawer and connection status

**Files:**
- Create: `web/src/ui/studio/connection.ts`, `web/src/ui/studio/SettingsDrawer.tsx`
- Modify: `web/src/ui/studio/shell.css` (append)
- Test: `web/src/ui/studio/connection.test.ts`, `web/src/ui/studio/SettingsDrawer.test.tsx`

**Interfaces:**
- Consumes: `Poll<T>` with `fails` and `BACKOFF_AFTER` (Task 6); `ThemeChoice`, `THEME_LABEL` (Task 2); `StatusChip` (Task 5); Arc `Drawer`, `DrawerContent` (`title`, `description`, `side`), `SegmentedControl` (default export; buttons with `aria-pressed`), `CopyButton` (`value`, `label`).
- Produces:
  - `type Connection = 'connected' | 'reconnecting' | 'offline'`; `connectionOf(p: { ok: boolean; fails: number }, everConnected: boolean): Connection`; `useConnection(health: Poll<{ ok: boolean }>): Connection`; `CONNECTION_LABEL: Record<Connection, string>`.
  - `SettingsDrawer(props: { open: boolean; onClose: () => void; choice: ThemeChoice; onChoice: (c: ThemeChoice) => void; vault?: string; connection: Connection })`.

- [ ] **Step 1: Write the failing tests**

`web/src/ui/studio/connection.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { connectionOf } from './connection';

describe('connectionOf', () => {
  it('is connected after a good poll', () => expect(connectionOf({ ok: true, fails: 0 }, true)).toBe('connected'));
  it('is offline when it never connected', () => {
    expect(connectionOf({ ok: false, fails: 1 }, false)).toBe('offline');
    expect(connectionOf({ ok: false, fails: 5 }, false)).toBe('offline');
  });
  it('rides out one or two misses, then says reconnecting at the backoff threshold', () => {
    expect(connectionOf({ ok: false, fails: 2 }, true)).toBe('connected');
    expect(connectionOf({ ok: false, fails: 3 }, true)).toBe('reconnecting');
  });
});
```

`web/src/ui/studio/SettingsDrawer.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsDrawer } from './SettingsDrawer';

const base = { open: true, onClose: () => {}, choice: 'system' as const, onChoice: () => {}, vault: '/home/me/notes/aorch', connection: 'connected' as const };

describe('SettingsDrawer', () => {
  it('holds theme, the full vault path, the loopback note and the connection', () => {
    render(<SettingsDrawer {...base} />);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Match system' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('/home/me/notes/aorch')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy path/ })).toBeTruthy();
    expect(screen.getByText(/only listens on this machine/)).toBeTruthy();
    expect(screen.getByText('connected')).toBeTruthy();
  });

  it('picks a theme', () => {
    const onChoice = vi.fn();
    render(<SettingsDrawer {...base} onChoice={onChoice} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(onChoice).toHaveBeenCalledWith('dark');
  });

  it('shows reconnecting and offline', () => {
    const { rerender } = render(<SettingsDrawer {...base} connection="reconnecting" />);
    expect(screen.getByText('reconnecting')).toBeTruthy();
    rerender(<SettingsDrawer {...base} connection="offline" vault={undefined} />);
    expect(screen.getByText('offline')).toBeTruthy();
    expect(screen.getByText('Not known until the server answers.')).toBeTruthy();
  });

  it('closes with Escape', () => {
    const onClose = vi.fn();
    render(<SettingsDrawer {...base} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project web web/src/ui/studio/connection.test.ts web/src/ui/studio/SettingsDrawer.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`web/src/ui/studio/connection.ts`:

```ts
import { useRef } from 'react';
import { BACKOFF_AFTER, type Poll } from '../../hooks';

export type Connection = 'connected' | 'reconnecting' | 'offline';
export const CONNECTION_LABEL: Record<Connection, string> = { connected: 'connected', reconnecting: 'reconnecting', offline: 'offline' };

/**
 * connected: the last health poll worked (one or two misses after having connected still count as connected);
 * reconnecting: three misses in a row after having connected (usePoll now backs off); offline: never connected.
 */
export function connectionOf(p: { ok: boolean; fails: number }, everConnected: boolean): Connection {
  if (p.ok) return 'connected';
  if (!everConnected) return 'offline';
  return p.fails >= BACKOFF_AFTER ? 'reconnecting' : 'connected';
}

export function useConnection(health: Poll<{ ok: boolean }>): Connection {
  const ok = !!health.data?.ok && !health.error;
  const ever = useRef(false);
  if (ok) ever.current = true;
  return connectionOf({ ok, fails: health.fails }, ever.current);
}
```

`web/src/ui/studio/SettingsDrawer.tsx`:

```tsx
import { CopyButton } from '../../components/arc/copy-button/copy-button';
import { Drawer, DrawerContent } from '../../components/arc/drawer/drawer';
import SegmentedControl from '../../components/arc/segmented-control/segmented-control';
import { THEME_LABEL, type ThemeChoice } from '../../theme';
import { CONNECTION_LABEL, type Connection } from './connection';
import { StatusChip, type Tone } from './StatusChip';
import './shell.css';

const TONE: Record<Connection, Tone> = { connected: 'done', reconnecting: 'needs', offline: 'failed' };
const CHOICES: ThemeChoice[] = ['light', 'dark', 'system'];

/** Settings, opened over the current screen (which stays mounted): theme, vault, why loopback, connection. */
export function SettingsDrawer(p: { open: boolean; onClose: () => void; choice: ThemeChoice; onChoice: (c: ThemeChoice) => void; vault?: string; connection: Connection }) {
  return (
    <Drawer open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <DrawerContent side="right" title="Settings" description="This dashboard and the aorch server on this machine." className="sl-settings">
        <section className="sl-settings-group" aria-labelledby="set-theme">
          <h3 id="set-theme">Theme</h3>
          <SegmentedControl label="Theme" options={CHOICES.map((c) => ({ value: c, label: THEME_LABEL[c] }))} value={p.choice} onValueChange={(v) => p.onChoice(v as ThemeChoice)} />
        </section>
        <section className="sl-settings-group" aria-labelledby="set-vault">
          <h3 id="set-vault">Vault</h3>
          {p.vault ? (
            <div className="sl-settings-path">
              <code>{p.vault}</code>
              <CopyButton value={p.vault} label="Copy path" />
            </div>
          ) : (
            <p className="sl-meta">Not known until the server answers.</p>
          )}
        </section>
        <section className="sl-settings-group" aria-labelledby="set-loopback">
          <h3 id="set-loopback">Loopback only</h3>
          <p>The API starts agents and writes files, so it only listens on this machine.</p>
        </section>
        <section className="sl-settings-group" aria-labelledby="set-conn">
          <h3 id="set-conn">Connection</h3>
          <StatusChip tone={TONE[p.connection]} label={CONNECTION_LABEL[p.connection]} pulse={p.connection === 'reconnecting'} />
        </section>
      </DrawerContent>
    </Drawer>
  );
}
```

Append to `web/src/ui/studio/shell.css`:

```css
/* Settings drawer */
.sl-settings-group { display: flex; flex-direction: column; gap: 8px; padding: 14px 0; border-top: 1px solid var(--line); }
.sl-settings-group:first-of-type { border-top: 0; padding-top: 0; }
.sl-settings-group h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--ink); }
.sl-settings-group p { margin: 0; color: var(--mut); }
.sl-settings-path { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.sl-settings-path code { overflow-wrap: anywhere; user-select: all; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project web web/src/ui/studio`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/ui/studio
git commit -m "feat(web): Settings drawer with theme, vault path and connection status"
```

---

### Task 9: App shell — rail, Settings over the screen, ⌘K entries, leave guards

**Files:**
- Modify: `web/src/App.tsx` (full rewrite)
- Modify: `web/src/CommandMenu.tsx` (full rewrite)
- Create: `web/src/home/Home.tsx` (frame; sections arrive in Tasks 14–16), `web/src/home/home.css`
- Modify: `web/src/ui/studio/shell.css` (append the app layout)
- Modify: `web/src/styles.css` (delete `.app`, `.topbar`, `.brand`, `.logo`, `.status`, and in the `@media (max-width: 1000px)` block the `.topbar` and `.status .info-badge` lines)
- Test: `web/src/App.test.tsx` (full rewrite), `web/src/CommandMenu.test.tsx` (create)

**Interfaces:**
- Consumes: `useHashRoute`, `SCREENS`, `TAB_LABEL`, `Route`, `Screen`, `usePoll` (Task 6); `Rail`, `BottomBar`, `useMediaQuery`, `PHONE` (Task 7); `SettingsDrawer`, `useConnection` (Task 8); `useTheme`, `THEME_LABEL`, `ThemeChoice` (Task 2); `ScreenHeader` (Task 4).
- Produces:
  - `Home(props: { onGo: (r: Route) => void })` from `web/src/home/Home.tsx` (filled in Tasks 14–16).
  - `CommandMenu(props: { open: boolean; onOpenChange: (o: boolean) => void; onGo: (r: Route) => void; onSettings: () => void; onTheme: (c: ThemeChoice) => void })`.
  - App behaviour: default `#/home`; Settings is `#/settings` drawn over the last screen, which stays mounted; the API tab's unsaved-edits guard covers rail, bottom bar, ⌘K, in-screen links and browser `hashchange`.

- [ ] **Step 1: Write the failing tests**

Replace `web/src/App.test.tsx` with:

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mounts = vi.hoisted(() => ({ api: 0 }));
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
vi.mock('./home/Home', () => ({ Home: () => <div>home screen</div> }));
vi.mock('./Builder', () => ({
  Builder: (p: { pipeline?: string; gate?: { run: string; env?: string }; onGateUsed?: () => void }) => (
    <div>
      builder screen {p.pipeline ?? ''}
      {p.gate ? ` gate ${p.gate.run} in ${p.gate.env ?? '-'}` : ''}
      {p.gate ? <button onClick={p.onGateUsed}>use gate</button> : null}
    </div>
  ),
}));
vi.mock('./Runs', () => ({ Runs: (p: { selected?: string; node?: string }) => <div>runs screen {p.selected ?? ''} {p.node ?? ''}</div> }));
vi.mock('./Graph', () => ({ GraphView: () => <div>graph screen</div> }));
vi.mock('./Crew', () => ({ Crew: () => <div>crew screen</div> }));
vi.mock('./Triggers', () => ({ Triggers: () => <div>triggers screen</div> }));
vi.mock('./http/ApiTab', () => ({
  ApiTab: (p: { onStarted: (id: string) => void; onUseAsGate: (g: { run: string; env?: string }) => void; onDirtyChange?: (d: boolean) => void }) => {
    useState(() => mounts.api++);
    return (
      <div>
        api screen
        <button onClick={() => p.onDirtyChange?.(true)}>edit draft</button>
        <button onClick={() => p.onUseAsGate({ run: 'runs/list', env: 'stage' })}>gate it</button>
        <button onClick={() => p.onStarted('r9')}>started</button>
      </div>
    );
  },
}));
import { api } from './api';
import { App } from './App';
import { routeApi } from './test/fixtures';

const browserGoes = (hash: string) =>
  act(() => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
const railButton = (name: string) => screen.findByRole('button', { name });

beforeEach(() => {
  vi.mocked(api).mockReset();
  mounts.api = 0;
  routeApi({ 'GET /api/health': { ok: true, vault: '/home/me/notes/aorch' }, 'GET /api/crew': { bots: [] }, 'GET /api/runs': [], 'GET /api/pipelines': [] });
});

describe('App shell', () => {
  it('opens on Home with the rail as the main navigation', () => {
    render(<App />);
    expect(screen.getByText('home screen')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('sends an unknown hash to Home', () => {
    location.hash = '#/nowhere';
    render(<App />);
    expect(screen.getByText('home screen')).toBeTruthy();
  });

  it('navigates by the rail and reopens the last viewed run', async () => {
    location.hash = '#/runs/r5';
    render(<App />);
    expect(screen.getByText(/runs screen r5/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Crew' }));
    expect(location.hash).toBe('#/crew');
    expect(screen.getByText('crew screen')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }));
    expect(location.hash).toBe('#/runs/r5');
    browserGoes('#/graph');
    expect(screen.getByText('graph screen')).toBeTruthy();
  });

  it('asks before leaving a dirty API tab by the rail', async () => {
    location.hash = '#/api';
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'edit draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crew' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(location.hash).toBe('#/api');
    expect(screen.getByText('api screen')).toBeTruthy();
    fireEvent.click(await railButton('Crew'));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(location.hash).toBe('#/crew');
    expect(screen.getByText('crew screen')).toBeTruthy();
  });

  it('asks before leaving a dirty API tab by ⌘K', async () => {
    location.hash = '#/api';
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'edit draft' }));
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.click(await screen.findByText('Go to Crew'));
    expect(await screen.findByRole('button', { name: 'Discard' })).toBeTruthy();
    expect(location.hash).toBe('#/api');
  });

  it('asks before browser Back leaves a dirty API tab, restoring the hash first', async () => {
    location.hash = '#/api';
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'edit draft' }));
    browserGoes('#/crew');
    expect(await screen.findByRole('button', { name: 'Discard' })).toBeTruthy();
    expect(location.hash).toBe('#/api');
    expect(screen.getByText('api screen')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(location.hash).toBe('#/crew');
    await waitFor(() => expect(screen.getByText('crew screen')).toBeTruthy());
  });

  it('opens Settings over a dirty API tab without asking and without remounting it', async () => {
    location.hash = '#/api';
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'edit draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(location.hash).toBe('#/settings');
    const drawer = await screen.findByRole('dialog', { name: 'Settings' });
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(screen.getByText('api screen')).toBeTruthy();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(location.hash).toBe('#/api'));
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(mounts.api).toBe(1);
  });

  it('hands a request gate from the API tab to the Builder once, and opens started runs', async () => {
    location.hash = '#/api';
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'gate it' }));
    expect(location.hash).toBe('#/builder');
    expect(screen.getByText(/gate runs\/list in stage/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'use gate' }));
    expect(screen.queryByText(/gate runs\/list/)).toBeNull();
    browserGoes('#/api');
    fireEvent.click(screen.getByRole('button', { name: 'started' }));
    expect(location.hash).toBe('#/runs/r9');
  });

  it('shows the vault path and connection in Settings', async () => {
    location.hash = '#/settings';
    render(<App />);
    expect(await screen.findByText('/home/me/notes/aorch')).toBeTruthy();
    expect(await screen.findByText('connected')).toBeTruthy();
    expect(screen.getByText('home screen')).toBeTruthy();
  });

  it('shows offline when the server is down', async () => {
    routeApi({ 'GET /api/health': new Error('down'), 'GET /api/crew': { bots: [] } });
    location.hash = '#/settings';
    render(<App />);
    expect(await screen.findByText('offline')).toBeTruthy();
  });

  it('opens the command menu with Ctrl-K and navigates', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(await screen.findByText('Go to Triggers'));
    await waitFor(() => expect(screen.getByText('triggers screen')).toBeTruthy());
  });

  it('leaves Ctrl-K to text fields but always opens on Meta-K', async () => {
    render(<App />);
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    try {
      ta.focus();
      fireEvent.keyDown(ta, { key: 'k', ctrlKey: true });
      await act(async () => {});
      expect(screen.queryByText('Go to Triggers')).toBeNull();
      fireEvent.keyDown(ta, { key: 'k', metaKey: true });
      expect(await screen.findByText('Go to Triggers')).toBeTruthy();
    } finally {
      ta.remove();
    }
  });

  it('uses the bottom bar under 900 px', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 899px)', media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Graph' }));
    expect(location.hash).toBe('#/graph');
    expect(screen.queryByRole('button', { name: 'Search or jump to' })).toBeNull();
  });
});
```

Create `web/src/CommandMenu.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { CommandMenu } from './CommandMenu';
import { makeRow, routeApi } from './test/fixtures';

const open = () => {
  const p = { onOpenChange: vi.fn(), onGo: vi.fn(), onSettings: vi.fn(), onTheme: vi.fn() };
  render(<CommandMenu open {...p} />);
  return p;
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({ 'GET /api/runs': [makeRow({ id: 'r3', task: 'Ship the thing' })], 'GET /api/pipelines': [{ name: 'full-review' }] });
});

describe('CommandMenu', () => {
  it('lists Go to entries for every screen in rail order', () => {
    open();
    for (const s of ['Home', 'Runs', 'Builder', 'Crew', 'API', 'Graph', 'Triggers']) expect(screen.getByText(`Go to ${s}`)).toBeTruthy();
    expect(screen.getAllByText('Go to').length).toBeGreaterThan(0);
  });
  it('goes to a screen', () => {
    const p = open();
    fireEvent.click(screen.getByText('Go to Home'));
    expect(p.onGo).toHaveBeenCalledWith({ tab: 'home' });
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });
  it('opens Settings', () => {
    const p = open();
    fireEvent.click(screen.getByText('Open Settings'));
    expect(p.onSettings).toHaveBeenCalled();
  });
  it.each([['Theme: Light', 'light'], ['Theme: Dark', 'dark'], ['Theme: Match system', 'system']])('picks %s', (label, choice) => {
    const p = open();
    fireEvent.click(screen.getByText(label));
    expect(p.onTheme).toHaveBeenCalledWith(choice);
  });
  it('keeps recent runs and workflows', async () => {
    const p = open();
    fireEvent.click(await screen.findByText('Ship the thing'));
    expect(p.onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r3' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project web web/src/App.test.tsx web/src/CommandMenu.test.tsx`
Expected: FAIL — no rail in App; `./home/Home` missing; no "Open Settings" entry.

- [ ] **Step 3: Rewrite `web/src/CommandMenu.tsx`**

```tsx
import { useMemo } from 'react';
import type { RunRow } from './api';
import { CommandPalette, type CommandItem } from './components/arc/command-palette/command-palette';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { SCREENS, TAB_LABEL, usePoll, type Route, type Screen } from './hooks';
import { THEME_LABEL, type ThemeChoice } from './theme';

const THEMES: ThemeChoice[] = ['light', 'dark', 'system'];

/** Cmd/Ctrl-K: go to a screen, open Settings, pick a theme, jump to a recent run or a saved workflow. */
export function CommandMenu(props: { open: boolean; onOpenChange: (o: boolean) => void; onGo: (r: Route) => void; onSettings: () => void; onTheme: (c: ThemeChoice) => void }) {
  const runs = usePoll<RunRow[]>(props.open ? '/api/runs' : null, 10_000);
  const flows = usePoll<{ name: string }[]>(props.open ? '/api/pipelines' : null, 30_000);
  const items = useMemo<CommandItem[]>(
    () => [
      ...SCREENS.map((s) => ({ id: `go:${s}`, label: `Go to ${TAB_LABEL[s]}`, group: 'Go to' })),
      { id: 'open:settings', label: 'Open Settings', group: 'Go to' },
      ...THEMES.map((c) => ({ id: `theme:${c}`, label: `Theme: ${THEME_LABEL[c]}`, group: 'Theme' })),
      ...(runs.data ?? []).slice(0, 10).map((r) => ({
        id: `run:${r.id}`,
        label: r.task.split('\n')[0]!.slice(0, 80),
        description: `${r.kind === 'team' ? 'Team run' : r.pipeline} · ${r.status}`,
        group: 'Recent runs',
        keywords: [r.id],
      })),
      ...(flows.data ?? []).map((f) => ({ id: `flow:${f.name}`, label: f.name, description: 'Open in Builder', group: 'Workflows' })),
    ],
    [runs.data, flows.data],
  );
  const pick = (item: CommandItem) => {
    const i = item.id.indexOf(':');
    const kind = item.id.slice(0, i);
    const value = item.id.slice(i + 1);
    props.onOpenChange(false);
    if (kind === 'go') props.onGo({ tab: value as Screen });
    else if (kind === 'open') props.onSettings();
    else if (kind === 'theme') props.onTheme(value as ThemeChoice);
    else if (kind === 'run') props.onGo({ tab: 'runs', id: value });
    else props.onGo({ tab: 'builder', id: value });
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <DialogContent title="Jump to" description="Screens, settings, recent runs and saved workflows">
          <CommandPalette items={items} autoFocus label="Jump to" placeholder="Search screens, runs, workflows" onSelect={pick} onClose={() => props.onOpenChange(false)} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
```

- [ ] **Step 4: Create the Home frame**

`web/src/home/Home.tsx`:

```tsx
import type { Route } from '../hooks';
import { ScreenHeader } from '../ui/studio/ScreenHeader';
import './home.css';

/** Home: what needs you, what is running, and where to start the next run. Sections are added in the Home phase. */
export function Home(_props: { onGo: (r: Route) => void }) {
  return (
    <div className="home">
      <ScreenHeader meta="aorch · this machine" title="Home" summary="What needs you, what is running, and a place to start the next run." />
      <div className="home-grid" />
    </div>
  );
}
```

`web/src/home/home.css`:

```css
.home { min-height: 100%; padding-bottom: 32px; }
.home-grid { display: flex; flex-direction: column; gap: 16px; padding: 0 24px; }
@media (max-width: 899px) { .home-grid { padding: 0 12px; } }
```

- [ ] **Step 5: Rewrite `web/src/App.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Builder } from './Builder';
import { CommandMenu } from './CommandMenu';
import { Button } from './components/arc/button/button';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { ToastStack, ToastStackProvider } from './components/arc/toast-stack/toast-stack';
import { Crew } from './Crew';
import { loadCrewDefs } from './crewStore';
import { GraphView } from './Graph';
import { Home } from './home/Home';
import { ApiTab } from './http/ApiTab';
import { useHashRoute, usePoll, type Route, type Screen } from './hooks';
import { Runs } from './Runs';
import { useTheme } from './theme';
import { Triggers } from './Triggers';
import { cn } from './ui/cn';
import { BottomBar } from './ui/studio/BottomBar';
import { useConnection } from './ui/studio/connection';
import { Rail } from './ui/studio/Rail';
import { SettingsDrawer } from './ui/studio/SettingsDrawer';
import { PHONE, useMediaQuery } from './ui/studio/useMediaQuery';
import './ui/studio/shell.css';

type ScreenRoute = Omit<Route, 'tab'> & { tab: Screen };

const isTextField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export function App() {
  /** The API tab has a request with unsaved edits: leaving the tab asks first (the tab unmounts and the draft would be lost). */
  const [apiDirty, setApiDirty] = useState(false);
  const [leaving, setLeaving] = useState<Route>();
  /** The screen shown under the Settings drawer. Settings opens over it and it stays mounted. */
  const screenRef = useRef<ScreenRoute>({ tab: 'home' });
  const leavesDirtyApi = (next: Route) => screenRef.current.tab === 'api' && apiDirty && next.tab !== 'api' && next.tab !== 'settings';
  const [route, goNow] = useHashRoute(leavesDirtyApi, setLeaving);
  if (route.tab !== 'settings') screenRef.current = route as ScreenRoute;
  const screen = screenRef.current;

  const go = (r: Route) => (leavesDirtyApi(r) ? setLeaving(r) : goNow(r));
  const [lastRun, setLastRun] = useState(route.tab === 'runs' ? route.id : undefined);
  const { choice, setChoice } = useTheme();
  const [palette, setPalette] = useState(false);
  /** A request gate handed over by the API tab, waiting for the Builder to place it (cleared once used). */
  const [gateDraft, setGateDraft] = useState<{ run: string; env?: string }>();
  const health = usePoll<{ ok: boolean; vault?: string }>('/api/health', 5000);
  const connection = useConnection(health);
  const phone = useMediaQuery(PHONE);

  useEffect(() => void loadCrewDefs(), []);
  useEffect(() => {
    if (route.tab === 'runs' && route.id) setLastRun(route.id);
  }, [route]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey)) return;
      // Ctrl-K edits text in fields (macOS: delete to end of line); only Meta-K is taken there
      if (!e.metaKey && isTextField(e.target)) return;
      e.preventDefault();
      setPalette(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openScreen = (s: Screen) => go(s === 'runs' && lastRun ? { tab: 'runs', id: lastRun } : { tab: s });
  const openSettings = () => go({ tab: 'settings' });
  const settingsOpen = route.tab === 'settings';

  return (
    <ToastStackProvider>
      <div className={cn('shell', { phone })}>
        {phone ? null : <Rail active={screen.tab} settingsOpen={settingsOpen} onGo={openScreen} onSearch={() => setPalette(true)} onSettings={openSettings} />}
        <main className="shell-main">
          {screen.tab === 'home' ? <Home onGo={go} /> : null}
          {screen.tab === 'builder' ? <Builder pipeline={screen.id} gate={gateDraft} onGateUsed={() => setGateDraft(undefined)} onStarted={(id) => go({ tab: 'runs', id })} /> : null}
          {screen.tab === 'runs' ? <Runs selected={screen.id} onSelect={(id) => go({ tab: 'runs', id })} /> : null}
          {screen.tab === 'api' ? <ApiTab onStarted={(id) => go({ tab: 'runs', id })} onUseAsGate={(g) => (setGateDraft(g), go({ tab: 'builder' }))} onDirtyChange={setApiDirty} /> : null}
          {screen.tab === 'graph' ? <GraphView /> : null}
          {screen.tab === 'crew' ? <Crew /> : null}
          {screen.tab === 'triggers' ? <Triggers /> : null}
        </main>
        {phone ? <BottomBar active={screen.tab} settingsOpen={settingsOpen} onGo={openScreen} onSettings={openSettings} /> : null}
      </div>
      <SettingsDrawer open={settingsOpen} onClose={() => goNow(screen)} choice={choice} onChoice={setChoice} vault={health.data?.vault} connection={connection} />
      <CommandMenu open={palette} onOpenChange={setPalette} onGo={go} onSettings={openSettings} onTheme={setChoice} />
      <Dialog open={!!leaving} onOpenChange={(o) => !o && setLeaving(undefined)}>
        {leaving ? (
          <DialogContent className="studio api-dialog" title="Discard unsaved changes?" description="The open API request has edits that are not saved.">
            <div className="row end">
              <Button variant="secondary" onClick={() => setLeaving(undefined)}>
                Keep editing
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const r = leaving;
                  setLeaving(undefined);
                  setApiDirty(false);
                  goNow(r);
                }}
              >
                Discard
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
      <ToastStack />
    </ToastStackProvider>
  );
}
```

Append to `web/src/ui/studio/shell.css`:

```css
/* App layout: rail + screen (900 px and wider); screen + bottom bar below */
.shell { display: grid; grid-template-columns: 56px minmax(0, 1fr); height: 100%; background: var(--bg); color: var(--ink); }
.shell.phone { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
.shell-main { min-width: 0; min-height: 0; overflow: auto; }
```

In `web/src/styles.css` delete the rules for `.app`, `.topbar`, `.brand`, `.logo`, `.status`, and the `.topbar { flex-wrap… }` and `.status .info-badge { display: none; }` lines inside `@media (max-width: 1000px)`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run --project web web/src/App.test.tsx web/src/CommandMenu.test.tsx web/src/rules.test.ts`
Expected: PASS.

- [ ] **Step 7: Full web suite, typecheck, build**

Run: `npx vitest run --project web && npm run typecheck && npm run build`
Expected: all green.

- [ ] **Step 8: Chrome check (phase 2 done)**

Run `npm run build && npm run dev` (API serves the built dashboard on :4177) and check in Chrome, in light and dark and at 390 × 844 and 1024 × 768: the rail (tooltips after 300 ms, arrow keys, active marker in blue), the bottom bar with More under 900 px, Settings over the current screen (theme switch follows the OS under Match system), ⌘K entries, toasts in token colours, and the Back-button guard from a dirty API request. Builder, Graph, Crew and Triggers show no violet, no blue primary button, no grey skeleton.

- [ ] **Step 9: Commit**

```bash
git add web/src/App.tsx web/src/App.test.tsx web/src/CommandMenu.tsx web/src/CommandMenu.test.tsx web/src/home web/src/ui/studio/shell.css web/src/styles.css
git commit -m "feat(web): rail shell with Settings drawer, Home route, new command menu entries and leave guards"
```

---

## Phase 3 — Home and its server changes

### Task 10: Read-model types and `/api/runs` row additions

**Files:**
- Modify: `src/types.ts` (append read-model types)
- Create: `src/runRows.ts`
- Modify: `src/server.ts:701-705` (GET `/api/runs`)
- Modify: `web/src/api.ts` (`RunRow`, `ApiError`), `web/src/test/fixtures.ts` (`makeRow` defaults)
- Create: `test/home-helpers.ts`
- Test: `test/run-rows.test.ts`

**Interfaces:**
- Consumes: `crewFor`, `CREW` (`src/bots.ts`); `Store.state`, `Store.lastTs`.
- Produces (in `src/types.ts`):

```ts
export interface RunStep { id: string; status: NodeStatus; /** The crew bot that runs it (a bot id, for faces). */ bot: string }
export interface RunCurrent { node: string; /** Display name of the bot. */ bot: string; title: string }
export interface RunRowExtras { branch: string; lastTs: number; steps: RunStep[]; current?: RunCurrent; bots: string[] }
export type AttentionKind = 'plan_ready' | 'question' | 'approval' | 'planning_error' | 'paused' | 'interrupted' | 'failed';
export type AttentionAction = 'answer' | 'review' | 'approve' | 'resume' | 'retry' | 'open';
export interface AttentionItem { id: string; ts: number; runId: string; kind: AttentionKind; title: string; meta: string; actions: AttentionAction[]; node?: string }
export type ActivityKind = 'working' | 'needs' | 'done' | 'failed' | 'info';
export interface ActivityLine { id: string; ts: number; runId: string; who: string; text: string; kind: ActivityKind; bot?: string }
export interface RosterPreview { bots: { id: string; name: string; why: string }[]; core: string[] }
```

- `nodeTitle(n: PipelineNode): string` and `rowExtras(s: RunState, lastTs: number): RunRowExtras` from `src/runRows.ts`.
- `seedRun(store, id, o?)` from `test/home-helpers.ts` (used by Tasks 11–12): `o: { kind?: 'workflow' | 'team'; nodes?: Partial<PipelineNode>[]; task?: string; probe?: boolean; name?: string }`.
- Web: `interface RunRow extends RunRowExtras` (adds `branch`, `lastTs`, `steps`, `current?`, `bots`); `class ApiError extends Error { status: number }`, thrown by `api()` for non-2xx replies.

- [ ] **Step 1: Write the shared test helper** — create `test/home-helpers.ts`:

```ts
import type { Store } from '../src/store.js';
import { DEFAULT_SETTINGS, type Pipeline, type PipelineNode } from '../src/types.js';
import { pipe } from './helpers.js';

/** Start a run in the event log without the engine: a chained pipeline of `nodes` (default: one coder step titled Implement). */
export function seedRun(store: Store, id: string, o: { kind?: 'workflow' | 'team'; nodes?: Partial<PipelineNode>[]; task?: string; probe?: boolean; name?: string } = {}): void {
  const nodes = o.nodes ?? (o.kind === 'team' ? [] : [{ id: 'code', role: 'coder', title: 'Implement' }]);
  const pipeline: Pipeline = nodes.length
    ? { ...pipe(nodes, nodes.slice(1).map((n, i) => [nodes[i]!.id!, n.id!] as [string, string])), name: o.name ?? 'flow' }
    : { name: o.kind === 'team' ? 'team' : (o.name ?? 'flow'), version: 1, mode: 'pipeline', nodes: [], edges: [], settings: { ...DEFAULT_SETTINGS } };
  store.append(id, {
    type: 'run.started',
    pipeline,
    task: o.task ?? 'a task',
    repo: '/repo',
    workdir: '/wt',
    baseSha: 'abc',
    branch: `aorch/${id}`,
    ...(o.kind ? { kind: o.kind } : {}),
    ...(o.probe ? { probe: { proposal: 'p1', side: 'baseline' as const } } : {}),
  });
}
```

- [ ] **Step 2: Write the failing test** — create `test/run-rows.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rowExtras } from '../src/runRows.js';
import { Store } from '../src/store.js';
import { seedRun } from './home-helpers.js';
import { startHttpTestServer } from './http-helpers.js';

describe('run rows for Home', () => {
  it('lists steps in pipeline order, the first running or awaiting step as current, and the agent bots', () => {
    const store = Store.open(':memory:');
    seedRun(store, 'r1', { nodes: [{ id: 'plan', role: 'planner', title: 'Plan' }, { id: 'code', role: 'coder', title: 'Implement' }, { id: 'gate', kind: 'gate', command: 'npm test' }, { id: 'ok', kind: 'approval' }] });
    store.append('r1', { type: 'node.started', node: 'plan', attempt: 1 });
    store.append('r1', { type: 'node.finished', node: 'plan', status: 'done', output: 'x', durationMs: 5, attempt: 1 });
    store.append('r1', { type: 'node.started', node: 'code', attempt: 1 });
    const x = rowExtras(store.state('r1')!, store.lastTs('r1'));
    expect(x.steps).toEqual([
      { id: 'plan', status: 'done', bot: 'planner' },
      { id: 'code', status: 'running', bot: 'coder' },
      { id: 'gate', status: 'queued', bot: 'tester' },
      { id: 'ok', status: 'queued', bot: 'approval' },
    ]);
    expect(x.current).toEqual({ node: 'code', bot: 'Bolt', title: 'Implement' });
    expect(x.bots).toEqual(['planner', 'coder']);
    expect(x.branch).toBe('aorch/r1');
    expect(x.lastTs).toBe(store.lastTs('r1'));
  });

  it('has no current step when nothing runs or waits, and no steps for a team run before its plan', () => {
    const store = Store.open(':memory:');
    seedRun(store, 'r2');
    expect(rowExtras(store.state('r2')!, 0).current).toBeUndefined();
    seedRun(store, 't1', { kind: 'team' });
    expect(rowExtras(store.state('t1')!, 0)).toMatchObject({ steps: [], bots: [] });
  });

  it('treats an awaiting step as current', () => {
    const store = Store.open(':memory:');
    seedRun(store, 'r3', { nodes: [{ id: 'code', role: 'coder', title: 'Implement' }, { id: 'ok', kind: 'approval', title: 'Ship it' }] });
    store.append('r3', { type: 'node.started', node: 'code', attempt: 1 });
    store.append('r3', { type: 'node.finished', node: 'code', status: 'done', output: '', durationMs: 1, attempt: 1 });
    store.append('r3', { type: 'approval.requested', node: 'ok' });
    expect(rowExtras(store.state('r3')!, 0).current).toEqual({ node: 'ok', bot: 'Gate', title: 'Ship it' });
  });
});

describe('GET /api/runs', () => {
  let srv: Awaited<ReturnType<typeof startHttpTestServer>>;
  beforeAll(async () => {
    srv = await startHttpTestServer();
  });
  afterAll(() => srv.close());

  it('adds branch, lastTs, steps, current and bots and keeps the existing fields', async () => {
    seedRun(srv.store, 'rx', { nodes: [{ id: 'code', role: 'coder', title: 'Implement' }] });
    srv.store.append('rx', { type: 'node.started', node: 'code', attempt: 1 });
    const r = await srv.api('GET', '/api/runs');
    expect(r.status).toBe(200);
    const row = r.json.find((x: { id: string }) => x.id === 'rx');
    expect(row).toMatchObject({ id: 'rx', pipeline: 'flow', status: 'running', pending: 0, planReady: false, live: false, branch: 'aorch/rx', steps: [{ id: 'code', status: 'running', bot: 'coder' }], current: { node: 'code', bot: 'Bolt', title: 'Implement' }, bots: ['coder'] });
    expect(typeof row.lastTs).toBe('number');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --project node test/run-rows.test.ts`
Expected: FAIL — `src/runRows.js` not found.

- [ ] **Step 4: Write the implementation**

Append to `src/types.ts`:

```ts
// ---------- dashboard read models (Home) ----------

export interface RunStep {
  id: string;
  status: NodeStatus;
  /** The crew bot that runs it (a bot id, for faces). */
  bot: string;
}
export interface RunCurrent {
  node: string;
  /** Display name of the bot. */
  bot: string;
  title: string;
}
/** What GET /api/runs adds to each run row. */
export interface RunRowExtras {
  branch: string;
  lastTs: number;
  steps: RunStep[];
  current?: RunCurrent;
  bots: string[];
}
export type AttentionKind = 'plan_ready' | 'question' | 'approval' | 'planning_error' | 'paused' | 'interrupted' | 'failed';
export type AttentionAction = 'answer' | 'review' | 'approve' | 'resume' | 'retry' | 'open';
export interface AttentionItem {
  id: string;
  ts: number;
  runId: string;
  kind: AttentionKind;
  title: string;
  meta: string;
  actions: AttentionAction[];
  /** The step an approval or a worker's question belongs to. */
  node?: string;
}
export type ActivityKind = 'working' | 'needs' | 'done' | 'failed' | 'info';
export interface ActivityLine {
  id: string;
  ts: number;
  runId: string;
  who: string;
  text: string;
  kind: ActivityKind;
  /** The bot whose face goes with the line. */
  bot?: string;
}
export interface RosterPreview {
  bots: { id: string; name: string; why: string }[];
  core: string[];
}
```

Create `src/runRows.ts`:

```ts
/** The extra fields Home needs on each GET /api/runs row. Read-only, computed from the folded run state. */
import { CREW, crewFor } from './bots.js';
import type { PipelineNode, RunRowExtras, RunState } from './types.js';

export const nodeTitle = (n: PipelineNode): string => n.title ?? n.role ?? n.id;

export function rowExtras(s: RunState, lastTs: number): RunRowExtras {
  const steps = s.pipeline.nodes.map((n) => ({ id: n.id, status: s.nodes[n.id]?.status ?? 'queued', bot: crewFor(n) }));
  const cur = s.pipeline.nodes.find((n) => {
    const st = s.nodes[n.id]?.status;
    return st === 'running' || st === 'awaiting';
  });
  const bots = [...new Set(s.pipeline.nodes.filter((n) => n.kind === 'agent').map((n) => crewFor(n)))];
  return {
    branch: s.branch,
    lastTs,
    steps,
    ...(cur ? { current: { node: cur.id, bot: CREW[crewFor(cur)]?.name ?? crewFor(cur), title: nodeTitle(cur) } } : {}),
    bots,
  };
}
```

In `src/server.ts` add `import { rowExtras } from './runRows.js';` and replace the GET `/api/runs` handler body with:

```ts
    if (p === '/api/runs' && m === 'GET') {
      // Evolve probe replays are experiments, hidden unless ?all=1
      const all = url.searchParams.get('all') === '1';
      const rows = store.list().filter((r) => all || !r.probe).map((r) => {
        const s = store.state(r.id);
        return { ...r, ...(s ? rowExtras(s, store.lastTs(r.id)) : {}), live: engine.isLive(r.id) || teamWaits(r) };
      });
      return send(res, 200, rows), true;
    }
```

In `web/src/api.ts`:
- Extend the type import: `import type { Answer, NodeState, Pipeline, Question, RunRowExtras, RunState, StoredEvent, TeamMode, TeamPlan } from '../../src/types.js';` and re-export the read-model types: `export type { ActivityLine, AttentionAction, AttentionItem, RosterPreview, RunStep } from '../../src/types.js';`.
- Change `export interface RunRow {` to `export interface RunRow extends RunRowExtras {`.
- Add above `api()`:

```ts
/** A non-2xx reply: the server's JSON `error` text plus the HTTP status (Home tells a 409 "no workspace" apart). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
```

- In `api()`, replace the throw with `if (!res.ok) throw new ApiError(json?.error ?? (text.slice(0, 200) || \`HTTP ${res.status}\`), res.status);`.

In `web/src/test/fixtures.ts`, extend `makeRow`'s defaults with `branch: 'aorch/r1', lastTs: Date.now(), steps: [], bots: []` (before `...o`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run --project node test/run-rows.test.ts test/server.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/runRows.ts src/server.ts web/src/api.ts web/src/test/fixtures.ts test/home-helpers.ts test/run-rows.test.ts
git commit -m "feat(server): run rows carry branch, last event time, steps, current step and bots"
```

---

### Task 11: `GET /api/attention`

**Files:**
- Create: `src/attention.ts`
- Modify: `src/server.ts` (route next to the runs routes)
- Test: `test/attention.test.ts`

**Interfaces:**
- Consumes: `AttentionItem`, `AttentionKind`, `AttentionAction`, `planWaiting`, `RunState`, `StoredEvent` (`src/types.ts`); `nodeTitle` (Task 10); `seedRun` (Task 10).
- Produces (from `src/attention.ts`):
  - `FAILED_WINDOW_MS = 86_400_000`
  - `interface AttentionRun { state: RunState; events: StoredEvent[]; live: boolean; lastTs: number }`
  - `mayNeedAttention(r: { status: RunState['status']; finishedAt?: number; probe?: true }, now?: number): boolean`
  - `attentionFor(r: AttentionRun, now?: number): AttentionItem[]`
  - `attentionItems(runs: AttentionRun[], now?: number): AttentionItem[]` (sorted by `ts` descending)
  - Route `GET /api/attention` → `{ items: AttentionItem[] }`.

- [ ] **Step 1: Write the failing test** — create `test/attention.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { attentionFor, attentionItems, FAILED_WINDOW_MS, mayNeedAttention, type AttentionRun } from '../src/attention.js';
import { Store } from '../src/store.js';
import type { Question, TeamPlan } from '../src/types.js';
import { seedRun } from './home-helpers.js';
import { startHttpTestServer } from './http-helpers.js';

const S = 'SENTINEL-attention';
const card = (id: string, o: Partial<Question> = {}): Question => ({ id, ask: `ask ${id}`, options: [{ id: 'a', label: 'A' }], recommended: 'a', ...o });
const plan: TeamPlan = { goal: 'g', success: [], assignments: [{ bot: 'coder', goal: 'c', mode: 'read' }], limits: { allowWrites: false }, answers: [] };
const runOf = (store: Store, id: string, live = false): AttentionRun => ({ state: store.state(id)!, events: store.eventsNoChunks(id), live, lastTs: store.lastTs(id) });
const kinds = (r: AttentionRun) => attentionFor(r).map((i) => i.kind);

describe('attention items', () => {
  it('plan_ready: a team plan waiting for approval links to its review', () => {
    const s = Store.open(':memory:');
    seedRun(s, 't1', { kind: 'team' });
    s.append('t1', { type: 'plan.ready', plan });
    const [item] = attentionFor(runOf(s, 't1', true));
    expect(item).toMatchObject({ id: 't1:plan_ready', kind: 'plan_ready', title: 'Plan ready for approval', actions: ['review'], meta: 'Team run · t1 · aorch/t1' });
    expect(item!.ts).toBe(s.eventsNoChunks('t1').at(-1)!.ts);
  });

  it('question: one item per pending planning card or worker question', () => {
    const s = Store.open(':memory:');
    seedRun(s, 't2', { kind: 'team' });
    s.append('t2', { type: 'plan.question', round: 1, questions: [card('q1'), card('q2', { ask: 'x'.repeat(200) })] });
    const items = attentionFor(runOf(s, 't2', true));
    expect(items.map((i) => i.id)).toEqual(['t2:question:q1', 't2:question:q2']);
    expect(items[1]!.title).toHaveLength(120);
    expect(items[0]).toMatchObject({ actions: ['answer'] });
    expect(items[0]!.node).toBeUndefined();

    seedRun(s, 'w1', { nodes: [{ id: 'code', role: 'coder', title: 'Implement' }] });
    s.append('w1', { type: 'node.started', node: 'code', attempt: 1 });
    s.append('w1', { type: 'user.ask', node: 'code', question: card('q3', { from: 'code' }), wait: true });
    const [ask] = attentionFor(runOf(s, 'w1', true));
    expect(ask).toMatchObject({ kind: 'question', node: 'code', title: 'ask q3' });
  });

  it('approval: an awaiting approval step, and no paused item on top of it', () => {
    const s = Store.open(':memory:');
    seedRun(s, 'r1', { nodes: [{ id: 'code', role: 'coder' }, { id: 'ok', kind: 'approval', title: 'Ship it' }] });
    s.append('r1', { type: 'approval.requested', node: 'ok' });
    s.append('r1', { type: 'run.finished', status: 'paused' });
    const items = attentionFor(runOf(s, 'r1'));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'r1:approval:ok', kind: 'approval', node: 'ok', title: 'Ship it waits for approval', actions: ['approve', 'open'] });
  });

  it('paused: a paused run with nothing more specific', () => {
    const s = Store.open(':memory:');
    seedRun(s, 'r2');
    s.append('r2', { type: 'run.finished', status: 'paused' });
    expect(attentionFor(runOf(s, 'r2'))).toMatchObject([{ kind: 'paused', title: 'Paused', actions: ['open'] }]);
  });

  it('planning_error: a stalled team run whose latest error is newer than its latest resume, without error text', () => {
    const s = Store.open(':memory:');
    seedRun(s, 't3', { kind: 'team' });
    s.append('t3', { type: 'team.error', message: S });
    const items = attentionFor(runOf(s, 't3'));
    expect(items).toMatchObject([{ kind: 'planning_error', title: 'Planning failed', actions: ['retry', 'open'] }]);
    expect(JSON.stringify(items)).not.toContain(S);
    s.append('t3', { type: 'run.resumed' });
    expect(kinds(runOf(s, 't3'))).toEqual(['interrupted']);
  });

  it('interrupted: running with no process driving it, only when not live', () => {
    const s = Store.open(':memory:');
    seedRun(s, 'r3');
    expect(attentionFor(runOf(s, 'r3'))).toMatchObject([{ kind: 'interrupted', title: 'Interrupted: no process is driving it', actions: ['resume', 'open'] }]);
    expect(attentionFor(runOf(s, 'r3', true))).toEqual([]);
  });

  it('failed: an error run from the last 24 hours, without error text', () => {
    const s = Store.open(':memory:');
    seedRun(s, 'r4');
    s.append('r4', { type: 'run.finished', status: 'error', error: S });
    const r = runOf(s, 'r4');
    const items = attentionFor(r);
    expect(items).toMatchObject([{ kind: 'failed', title: 'Failed', actions: ['retry', 'open'] }]);
    expect(items[0]!.ts).toBe(r.state.finishedAt);
    expect(JSON.stringify(items)).not.toContain(S);
    expect(attentionFor(r, r.state.finishedAt! + FAILED_WINDOW_MS + 1)).toEqual([]);
  });

  it('sorts newest first and skips probe runs', () => {
    const s = Store.open(':memory:');
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    seedRun(s, 'old');
    now.mockReturnValue(2_000);
    seedRun(s, 'new');
    seedRun(s, 'probe', { probe: true });
    now.mockRestore();
    const items = attentionItems([runOf(s, 'old'), runOf(s, 'new'), runOf(s, 'probe')]);
    expect(items.map((i) => i.runId)).toEqual(['new', 'old']);
    expect(mayNeedAttention({ status: 'running', probe: true })).toBe(false);
    expect(mayNeedAttention({ status: 'done' })).toBe(false);
    expect(mayNeedAttention({ status: 'error', finishedAt: Date.now() })).toBe(true);
  });
});

describe('GET /api/attention', () => {
  let srv: Awaited<ReturnType<typeof startHttpTestServer>>;
  beforeAll(async () => {
    srv = await startHttpTestServer();
  });
  afterAll(() => srv.close());

  it('answers with the items of real runs only', async () => {
    seedRun(srv.store, 'ra');
    seedRun(srv.store, 'rp', { probe: true });
    const r = await srv.api('GET', '/api/attention');
    expect(r.status).toBe(200);
    expect(r.json.items.map((i: { id: string }) => i.id)).toEqual(['ra:interrupted']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project node test/attention.test.ts`
Expected: FAIL — `src/attention.js` not found.

- [ ] **Step 3: Write the implementation** — create `src/attention.ts`:

```ts
/** What needs the person, computed from run states and (for planning errors) the event log. Read-only; no free text. */
import { nodeTitle } from './runRows.js';
import { planWaiting, type AttentionAction, type AttentionItem, type AttentionKind, type RunState, type StoredEvent } from './types.js';

export const FAILED_WINDOW_MS = 24 * 60 * 60_000;
const ASK_MAX = 120;

export interface AttentionRun {
  state: RunState;
  /** The run's events without chunks, oldest first. */
  events: StoredEvent[];
  /** As GET /api/runs computes it: driven by this server, or a team run waiting on the person. */
  live: boolean;
  lastTs: number;
}

/** Is this run worth reading the event log for? (Cheap filter on a run-list row.) */
export function mayNeedAttention(r: { status: RunState['status']; finishedAt?: number; probe?: true }, now = Date.now()): boolean {
  if (r.probe) return false;
  return r.status === 'running' || r.status === 'paused' || (r.status === 'error' && !!r.finishedAt && now - r.finishedAt <= FAILED_WINDOW_MS);
}

export function attentionFor(r: AttentionRun, now = Date.now()): AttentionItem[] {
  const s = r.state;
  if (s.probe) return [];
  const out: AttentionItem[] = [];
  const meta = `${s.kind === 'team' ? 'Team run' : s.pipeline.name} · ${s.id} · ${s.branch}`;
  const add = (kind: AttentionKind, ts: number, title: string, actions: AttentionAction[], key?: string, node?: string) =>
    out.push({ id: `${s.id}:${kind}${key ? `:${key}` : ''}`, ts, runId: s.id, kind, title, meta, actions, ...(node ? { node } : {}) });
  const last = (pred: (e: StoredEvent['event']) => boolean): StoredEvent | undefined => {
    for (let i = r.events.length - 1; i >= 0; i--) if (pred(r.events[i]!.event)) return r.events[i];
    return undefined;
  };
  const active = s.status === 'running' || s.status === 'paused';

  if (active && planWaiting(s)) add('plan_ready', last((e) => e.type === 'plan.ready')?.ts ?? r.lastTs, 'Plan ready for approval', ['review']);

  if (active) {
    for (const q of s.pending) {
      const asker = s.userAsks?.find((a) => a.question.id === q.id)?.node;
      const ev = last((e) => (e.type === 'plan.question' && e.questions.some((x) => x.id === q.id)) || (e.type === 'user.ask' && e.question.id === q.id));
      add('question', ev?.ts ?? r.lastTs, q.ask.slice(0, ASK_MAX), ['answer'], q.id, asker);
    }
    for (const n of s.pipeline.nodes) {
      if (n.kind !== 'approval' || s.nodes[n.id]?.status !== 'awaiting') continue;
      const ev = last((e) => e.type === 'approval.requested' && e.node === n.id);
      add('approval', ev?.ts ?? r.lastTs, `${nodeTitle(n)} waits for approval`, ['approve', 'open'], n.id, n.id);
    }
  }

  let planningError = false;
  if (s.kind === 'team' && s.status === 'running' && !r.live) {
    const err = last((e) => e.type === 'team.error');
    const resumed = last((e) => e.type === 'run.resumed');
    if (err && (!resumed || err.seq > resumed.seq)) {
      planningError = true;
      add('planning_error', err.ts, 'Planning failed', ['retry', 'open']);
    }
  }
  if (s.status === 'paused' && !out.some((i) => i.kind === 'approval' || i.kind === 'question')) add('paused', r.lastTs, 'Paused', ['open']);
  if (s.status === 'running' && !r.live && !planningError) add('interrupted', r.lastTs, 'Interrupted: no process is driving it', ['resume', 'open']);
  if (s.status === 'error' && s.finishedAt && now - s.finishedAt <= FAILED_WINDOW_MS) add('failed', s.finishedAt, 'Failed', ['retry', 'open']);
  return out;
}

export function attentionItems(runs: AttentionRun[], now = Date.now()): AttentionItem[] {
  return runs.flatMap((r) => attentionFor(r, now)).sort((a, b) => b.ts - a.ts || a.id.localeCompare(b.id));
}
```

In `src/server.ts` add `import { attentionItems, mayNeedAttention } from './attention.js';` and, right after the GET `/api/runs` handler:

```ts
    if (p === '/api/attention' && m === 'GET') {
      const now = Date.now();
      const runs = store.list().filter((r) => mayNeedAttention(r, now)).flatMap((r) => {
        const state = store.state(r.id);
        return state ? [{ state, events: store.eventsNoChunks(r.id), live: engine.isLive(r.id) || teamWaits(r), lastTs: store.lastTs(r.id) }] : [];
      });
      return send(res, 200, { items: attentionItems(runs, now) }), true;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project node test/attention.test.ts && npm run typecheck`
Expected: PASS. If `foldRun` does not set `finishedAt` for a `paused` finish, nothing here depends on it.

- [ ] **Step 5: Commit**

```bash
git add src/attention.ts src/server.ts test/attention.test.ts
git commit -m "feat(server): GET /api/attention lists what needs the person"
```

---

### Task 12: `GET /api/activity`

**Files:**
- Modify: `src/store.ts` (add `FeedCursor`, `feedQuery`, `Store.feed`)
- Create: `src/activity.ts`
- Modify: `src/server.ts` (route)
- Test: `test/activity.test.ts`

**Interfaces:**
- Consumes: `ActivityLine`, `ActivityKind`, `RunState`, `StoredEvent` (`src/types.ts`); `crewFor` (`src/bots.ts`); `nodeTitle` (Task 10); `seedRun`; `Store.runIds({ probes: true })`.
- Produces:
  - `src/store.ts`: `interface FeedCursor { ts: number; runId: string; seq: number }`; `feedQuery(o: { types: string[]; after?: FeedCursor; exclude?: string[]; limit: number }): { sql: string; params: (string | number)[] }`; `Store.feed(o): StoredEvent[]` (with `after`: oldest first; without: newest first).
  - `src/activity.ts`: `ACTIVITY_TYPES`, `ACTIVITY_LIMIT = 30`, `ACTIVITY_MAX = 100`, `parseCursor(s: string): FeedCursor | undefined`, `cursorOf(c: FeedCursor): string`, `namesFor(s?: RunState): Names`, `activityLine(e: StoredEvent, names: Names): ActivityLine | undefined`, `activityFeed(store: Store, o: { since?: FeedCursor; limit: number }): { lines: ActivityLine[]; cursor: string | null }`.
  - Route `GET /api/activity?since=<ts:runId:seq>&limit=<n>` → `{ lines, cursor }`, newest first; malformed `since` → 400.

- [ ] **Step 1: Write the failing test** — create `test/activity.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { activityFeed, activityLine, cursorOf, namesFor, parseCursor } from '../src/activity.js';
import { feedQuery, Store } from '../src/store.js';
import type { RunEvent, StoredEvent } from '../src/types.js';
import { seedRun } from './home-helpers.js';
import { startHttpTestServer } from './http-helpers.js';

const S = 'SENTINEL-activity';
const NODES = [{ id: 'code', role: 'coder', title: 'Implement' }, { id: 'gate', kind: 'gate' as const, command: 'npm test', title: 'Tests' }];
const ev = (event: RunEvent, seq = 1): StoredEvent => ({ runId: 'r1', seq, ts: 10, event });

describe('activity lines', () => {
  const s = Store.open(':memory:');
  seedRun(s, 'r1', { nodes: NODES, name: 'ship' });
  const names = namesFor(s.state('r1'));
  const line = (e: RunEvent) => activityLine(ev(e), names);

  it.each<[RunEvent, string, string]>([
    [{ type: 'run.started', pipeline: s.state('r1')!.pipeline, task: S, repo: '/r', workdir: '/w', baseSha: 'a', branch: 'b' }, 'run started', 'working'],
    [{ type: 'run.resumed' }, 'run resumed', 'working'],
    [{ type: 'node.started', node: 'code', attempt: 1 }, 'Implement started', 'working'],
    [{ type: 'node.started', node: 'code', attempt: 2 }, 'Implement started (attempt 2)', 'working'],
    [{ type: 'node.finished', node: 'code', status: 'done', output: S, durationMs: 65_000, costUsd: 0.5, attempt: 1, verdict: 'PASS' }, 'Implement finished · VERDICT PASS · $0.50 · 1m 5s', 'done'],
    [{ type: 'node.finished', node: 'code', status: 'done', output: S, durationMs: 1500, attempt: 1, verdict: 'FAIL' }, 'Implement failed · VERDICT FAIL · 1.5s', 'failed'],
    [{ type: 'node.finished', node: 'code', status: 'error', output: S, error: S, durationMs: 0, attempt: 1 }, 'Implement failed', 'failed'],
    [{ type: 'node.skipped', node: 'gate', reason: S }, 'Tests skipped', 'info'],
    [{ type: 'gate.result', node: 'gate', ok: true, exitCode: 0, output: S, durationMs: 5 }, 'Tests passed', 'done'],
    [{ type: 'gate.result', node: 'gate', ok: false, exitCode: 2, output: S, durationMs: 5 }, 'Tests failed (exit 2)', 'failed'],
    [{ type: 'approval.requested', node: 'gate' }, 'Tests waits for approval', 'needs'],
    [{ type: 'approval.resolved', node: 'gate', approved: true, by: S }, 'Tests approved', 'done'],
    [{ type: 'approval.resolved', node: 'gate', approved: false }, 'Tests rejected', 'failed'],
    [{ type: 'plan.question', round: 1, questions: [{ id: 'q', ask: S, why: S, options: [{ id: 'a', label: S }], recommended: 'a' }] }, 'the team asks 1 question', 'needs'],
    [{ type: 'plan.question', round: 1, questions: [{ id: 'q', ask: S, options: [], recommended: '' }, { id: 'q2', ask: S, options: [], recommended: '' }] }, 'the team asks 2 questions', 'needs'],
    [{ type: 'plan.ready', plan: { goal: S, success: [S], assignments: [{ bot: 'coder', goal: S, mode: 'read', why: S }], limits: { allowWrites: false }, answers: [] } }, 'plan ready for approval', 'needs'],
    [{ type: 'user.ask', node: 'code', question: { id: 'q3', ask: S, options: [], recommended: '' }, wait: true }, 'Implement has a question', 'needs'],
    [{ type: 'user.answer', question: 'q3', answer: { question: 'q3', text: S, by: 'user' } }, 'question answered', 'info'],
    [{ type: 'handoff', from: 'code', to: 'gate', goal: S, answer: S, round: 1 }, 'Implement → Tests', 'info'],
    [{ type: 'consult', from: 'code', to: 'gate', question: S, answer: S, round: 1 }, 'Implement → Tests', 'info'],
    [{ type: 'run.finished', status: 'done' }, 'run done', 'done'],
    [{ type: 'run.finished', status: 'error', error: S }, 'run failed', 'failed'],
    [{ type: 'run.finished', status: 'stopped', budget: true }, 'run stopped · budget reached', 'info'],
  ])('%j → %s', (e, text, kind) => {
    const l = line(e)!;
    expect(l.text).toBe(text);
    expect(l.kind).toBe(kind);
    expect(JSON.stringify(l)).not.toContain(S);
  });

  it('skips every type outside the allowlist, chunks above all', () => {
    expect(line({ type: 'node.chunk', node: 'code', text: S })).toBeUndefined();
    expect(line({ type: 'team.error', message: S })).toBeUndefined();
    expect(line({ type: 'feedback', node: 'code', rating: 'up', note: S })).toBeUndefined();
  });

  it('names who and which face from the pipeline nodes', () => {
    expect(line({ type: 'node.started', node: 'code', attempt: 1 })).toMatchObject({ id: 'r1:1', who: 'Implement', bot: 'coder' });
    expect(line({ type: 'run.started', pipeline: s.state('r1')!.pipeline, task: 't', repo: '/r', workdir: '/w', baseSha: 'a', branch: 'b' })).toMatchObject({ who: 'ship' });
    expect(line({ type: 'plan.ready', plan: { goal: 'g', success: [], assignments: [], limits: { allowWrites: false }, answers: [] } })).toMatchObject({ who: 'Maestro', bot: 'orchestrator' });
    expect(line({ type: 'node.started', node: 'ghost', attempt: 1 })).toMatchObject({ who: 'ghost', text: 'ghost started' });
  });

  it('parses and prints cursors', () => {
    expect(parseCursor('1700:rabc123:7')).toEqual({ ts: 1700, runId: 'rabc123', seq: 7 });
    expect(parseCursor('nope')).toBeUndefined();
    expect(cursorOf({ ts: 1, runId: 'r', seq: 2 })).toBe('1:r:2');
  });
});

describe('activity feed', () => {
  it('never returns free text from any field', () => {
    const s = Store.open(':memory:');
    seedRun(s, 'r1', { nodes: NODES, task: S });
    const all: RunEvent[] = [
      { type: 'node.finished', node: 'code', status: 'error', output: S, error: S, durationMs: 1, attempt: 1 },
      { type: 'gate.result', node: 'gate', ok: false, exitCode: 1, output: S, durationMs: 1 },
      { type: 'plan.question', round: 1, questions: [{ id: 'q', ask: S, why: S, options: [{ id: 'a', label: S, detail: S }], recommended: 'a' }] },
      { type: 'plan.ready', plan: { goal: S, success: [S], assignments: [{ bot: 'coder', goal: S, expected: S, mode: 'read', why: S }], limits: { allowWrites: false }, answers: [] } },
      { type: 'team.error', message: S },
      { type: 'user.ask', node: 'code', question: { id: 'q2', ask: S, why: S, options: [], recommended: '' }, wait: true },
      { type: 'handoff', from: 'code', to: 'gate', goal: S, answer: S, round: 1 },
      { type: 'node.skipped', node: 'gate', reason: S },
      { type: 'run.finished', status: 'error', error: S },
    ];
    for (const e of all) s.append('r1', e);
    const feed = activityFeed(s, { limit: 100 });
    expect(feed.lines.length).toBeGreaterThan(5);
    expect(JSON.stringify(feed)).not.toContain(S);
  });

  it('pages with a cursor without repeats or gaps when events share a timestamp', () => {
    const s = Store.open(':memory:');
    const now = vi.spyOn(Date, 'now').mockReturnValue(5_000);
    for (const id of ['ra', 'rb', 'rc']) {
      seedRun(s, id);
      s.append(id, { type: 'node.started', node: 'code', attempt: 1 });
    }
    now.mockRestore();
    const everything = activityFeed(s, { limit: 100 }).lines; // newest first
    expect(everything).toHaveLength(6);
    const oldest = [...everything].reverse();
    const first = oldest[0]!;
    let cursor: string | null = cursorOf({ ts: first.ts, runId: first.runId, seq: Number(first.id.split(':').at(-1)) });
    const seen: string[] = [];
    for (let i = 0; i < 5 && cursor; i++) {
      const page = activityFeed(s, { since: parseCursor(cursor)!, limit: 2 });
      if (!page.lines.length) break;
      seen.push(...[...page.lines].reverse().map((l) => l.id));
      cursor = page.cursor;
    }
    expect(seen).toEqual(oldest.slice(1).map((l) => l.id));
  });

  it('defaults to 30 lines and caps at 100 through the route', async () => {
    const srv = await startHttpTestServer();
    try {
      seedRun(srv.store, 'rl');
      for (let i = 0; i < 130; i++) srv.store.append('rl', { type: 'node.started', node: 'code', attempt: 1 });
      expect((await srv.api('GET', '/api/activity')).json.lines).toHaveLength(30);
      expect((await srv.api('GET', '/api/activity?limit=500')).json.lines).toHaveLength(100);
      expect((await srv.api('GET', '/api/activity?limit=abc')).json.lines).toHaveLength(30);
      const bad = await srv.api('GET', '/api/activity?since=garbage');
      expect(bad.status).toBe(400);
      expect(bad.json.error).toMatch(/cursor/);
    } finally {
      await srv.close();
    }
  });

  it('leaves probe runs out', () => {
    const s = Store.open(':memory:');
    seedRun(s, 'real');
    seedRun(s, 'probe', { probe: true });
    s.append('probe', { type: 'node.started', node: 'code', attempt: 1 });
    expect(new Set(activityFeed(s, { limit: 100 }).lines.map((l) => l.runId))).toEqual(new Set(['real']));
  });

  it('keeps paging after the cursor’s run is deleted', () => {
    const s = Store.open(':memory:');
    seedRun(s, 'gone');
    const { cursor } = activityFeed(s, { limit: 100 });
    s.deleteRun('gone');
    seedRun(s, 'next');
    const page = activityFeed(s, { since: parseCursor(cursor!)!, limit: 30 });
    expect(page.lines.map((l) => l.runId)).toEqual(['next']);
    expect(page.cursor).not.toBe(cursor);
  });

  it('echoes the cursor when nothing is new', () => {
    const s = Store.open(':memory:');
    seedRun(s, 'r1');
    const { cursor } = activityFeed(s, { limit: 100 });
    expect(activityFeed(s, { since: parseCursor(cursor!)!, limit: 30 })).toEqual({ lines: [], cursor });
  });

  it('uses the events_type index even with many chunk rows', () => {
    const s = Store.open(':memory:');
    const db = s.raw() as unknown as { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): { detail: string }[] } };
    const ins = db.prepare('INSERT INTO events(run_id, seq, ts, type, data) VALUES (?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    for (let i = 1; i <= 10_000; i++) ins.run('rc', i, i, 'node.chunk', '{"type":"node.chunk","node":"code","text":"x"}');
    db.exec('COMMIT');
    for (const after of [undefined, { ts: 5, runId: 'rc', seq: 5 }]) {
      const q = feedQuery({ types: ['node.started', 'run.finished'], after, exclude: ['p1'], limit: 30 });
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...q.params).map((r) => r.detail).join('\n');
      expect(plan).toContain('events_type');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project node test/activity.test.ts`
Expected: FAIL — `src/activity.js` not found and `feedQuery` not exported.

- [ ] **Step 3: Add the feed query to the store** — in `src/store.ts`, above `export class Store`:

```ts
/** A position in the cross-run event order (ts, run id, seq). */
export interface FeedCursor {
  ts: number;
  runId: string;
  seq: number;
}

/**
 * Events of some types across runs. With `after`: strictly after that position, oldest first, so a gap longer than
 * `limit` is paged forward without holes. Without: the newest, newest first. The type list lets SQLite use events_type.
 */
export function feedQuery(o: { types: string[]; after?: FeedCursor; exclude?: string[]; limit: number }): { sql: string; params: (string | number)[] } {
  const params: (string | number)[] = [...o.types];
  let sql = `SELECT run_id, seq, ts, data FROM events WHERE type IN (${o.types.map(() => '?').join(', ')})`;
  if (o.after) {
    sql += ' AND (ts, run_id, seq) > (?, ?, ?)';
    params.push(o.after.ts, o.after.runId, o.after.seq);
  }
  if (o.exclude?.length) {
    sql += ` AND run_id NOT IN (${o.exclude.map(() => '?').join(', ')})`;
    params.push(...o.exclude);
  }
  const dir = o.after ? 'ASC' : 'DESC';
  sql += ` ORDER BY ts ${dir}, run_id ${dir}, seq ${dir} LIMIT ?`;
  params.push(o.limit);
  return { sql, params };
}
```

and inside the class, after `eventsNoChunks`:

```ts
  /** Events of some types across runs (see feedQuery for the order). */
  feed(o: { types: string[]; after?: FeedCursor; exclude?: string[]; limit: number }): StoredEvent[] {
    const q = feedQuery(o);
    const rows = this.db.prepare(q.sql).all(...q.params) as { run_id: string; seq: number; ts: number; data: string }[];
    return rows.map((r) => ({ runId: r.run_id, seq: r.seq, ts: r.ts, event: JSON.parse(r.data) as RunEvent }));
  }
```

- [ ] **Step 4: Write `src/activity.ts`**

```ts
/**
 * Recent events across all runs as display lines for Home. The feed may be on a shared screen, so lines carry only ids,
 * bot names, step titles, statuses, counts, costs and durations: never task text, prompts, outputs, gate output,
 * questions, goals or error messages.
 */
import { crewFor } from './bots.js';
import { nodeTitle } from './runRows.js';
import type { FeedCursor, Store } from './store.js';
import type { ActivityKind, ActivityLine, RunState, StoredEvent } from './types.js';

export const ACTIVITY_TYPES = [
  'run.started', 'run.resumed', 'node.started', 'node.finished', 'node.skipped', 'gate.result', 'approval.requested', 'approval.resolved',
  'plan.question', 'plan.ready', 'user.ask', 'user.answer', 'handoff', 'consult', 'run.finished',
] as const;
export const ACTIVITY_LIMIT = 30;
export const ACTIVITY_MAX = 100;

export function parseCursor(s: string): FeedCursor | undefined {
  const m = /^(\d+):(.+):(\d+)$/.exec(s);
  return m ? { ts: Number(m[1]), runId: m[2]!, seq: Number(m[3]) } : undefined;
}
export const cursorOf = (c: FeedCursor): string => `${c.ts}:${c.runId}:${c.seq}`;

const usd = (n: number) => `$${n.toFixed(2)}`;
const dur = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

export interface Names {
  /** The run's label: its pipeline name, or "Team run". */
  label: string;
  node: (id: string) => { name: string; bot?: string };
}

/** Step and bot names from the run's pipeline nodes (title ?? role ?? id), looked up once per run. */
export function namesFor(s: RunState | undefined): Names {
  const byId = new Map((s?.pipeline.nodes ?? []).map((n) => [n.id, n] as const));
  return {
    label: s ? (s.kind === 'team' ? 'Team run' : s.pipeline.name) : 'run',
    node: (id) => {
      const n = byId.get(id);
      return n ? { name: nodeTitle(n), bot: crewFor(n) } : { name: id };
    },
  };
}

export function activityLine(e: StoredEvent, names: Names): ActivityLine | undefined {
  const ev = e.event;
  const line = (who: string, text: string, kind: ActivityKind, bot?: string): ActivityLine => ({ id: `${e.runId}:${e.seq}`, ts: e.ts, runId: e.runId, who, text, kind, ...(bot ? { bot } : {}) });
  const node = (id: string) => names.node(id);
  switch (ev.type) {
    case 'run.started':
      return line(names.label, 'run started', 'working');
    case 'run.resumed':
      return line(names.label, 'run resumed', 'working');
    case 'node.started': {
      const n = node(ev.node);
      return line(n.name, `${n.name} started${ev.attempt > 1 ? ` (attempt ${ev.attempt})` : ''}`, 'working', n.bot);
    }
    case 'node.finished': {
      const n = node(ev.node);
      const ok = ev.status === 'done' && ev.verdict !== 'FAIL';
      const text = `${n.name} ${ok ? 'finished' : 'failed'}${ev.verdict ? ` · VERDICT ${ev.verdict}` : ''}${ev.costUsd ? ` · ${usd(ev.costUsd)}` : ''}${ev.durationMs ? ` · ${dur(ev.durationMs)}` : ''}`;
      return line(n.name, text, ok ? 'done' : 'failed', n.bot);
    }
    case 'node.skipped': {
      const n = node(ev.node);
      return line(n.name, `${n.name} skipped`, 'info', n.bot);
    }
    case 'gate.result': {
      const n = node(ev.node);
      return line(n.name, `${n.name} ${ev.ok ? 'passed' : `failed (exit ${ev.exitCode ?? '?'})`}`, ev.ok ? 'done' : 'failed', n.bot);
    }
    case 'approval.requested': {
      const n = node(ev.node);
      return line(n.name, `${n.name} waits for approval`, 'needs', n.bot);
    }
    case 'approval.resolved': {
      const n = node(ev.node);
      return line(n.name, `${n.name} ${ev.approved ? 'approved' : 'rejected'}`, ev.approved ? 'done' : 'failed', n.bot);
    }
    case 'plan.question':
      return line('Maestro', `the team asks ${ev.questions.length} question${ev.questions.length === 1 ? '' : 's'}`, 'needs', 'orchestrator');
    case 'plan.ready':
      return line('Maestro', 'plan ready for approval', 'needs', 'orchestrator');
    case 'user.ask': {
      const n = node(ev.node);
      return line(n.name, `${n.name} has a question`, 'needs', n.bot);
    }
    case 'user.answer':
      return line('You', 'question answered', 'info');
    case 'handoff':
    case 'consult': {
      const a = node(ev.from);
      const b = node(ev.to);
      return line(a.name, `${a.name} → ${b.name}`, 'info', a.bot);
    }
    case 'run.finished': {
      const word = ev.status === 'error' ? 'failed' : ev.status;
      return line(names.label, `run ${word}${ev.budget ? ' · budget reached' : ''}`, ev.status === 'done' ? 'done' : ev.status === 'error' ? 'failed' : 'info');
    }
    default:
      return undefined;
  }
}

export function activityFeed(store: Store, o: { since?: FeedCursor; limit: number }): { lines: ActivityLine[]; cursor: string | null } {
  const events = store.feed({ types: [...ACTIVITY_TYPES], after: o.since, exclude: store.runIds({ probes: true }), limit: o.limit });
  const names = new Map<string, Names>();
  const lines: ActivityLine[] = [];
  for (const e of events) {
    if (!names.has(e.runId)) names.set(e.runId, namesFor(store.state(e.runId)));
    const l = activityLine(e, names.get(e.runId)!);
    if (l) lines.push(l);
  }
  // after a cursor the query pages forward (oldest first); the response is always newest first
  const newest = o.since ? events.at(-1) : events[0];
  if (o.since) lines.reverse();
  return { lines, cursor: newest ? cursorOf({ ts: newest.ts, runId: newest.runId, seq: newest.seq }) : o.since ? cursorOf(o.since) : null };
}
```

- [ ] **Step 5: Add the route** — in `src/server.ts` add `import { ACTIVITY_LIMIT, ACTIVITY_MAX, activityFeed, parseCursor } from './activity.js';` and, after the attention route:

```ts
    if (p === '/api/activity' && m === 'GET') {
      const raw = url.searchParams.get('since');
      const since = raw ? parseCursor(raw) : undefined;
      if (raw && !since) throw new HttpError(400, 'malformed "since" cursor');
      const n = Number(url.searchParams.get('limit') ?? ACTIVITY_LIMIT);
      const limit = Number.isInteger(n) && n > 0 ? Math.min(n, ACTIVITY_MAX) : ACTIVITY_LIMIT;
      return send(res, 200, activityFeed(store, { since, limit })), true;
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --project node test/activity.test.ts && npm run typecheck`
Expected: PASS. The query-plan test prints `SEARCH events USING INDEX events_type (type=?)`; if SQLite chooses another plan on this Node version, keep the assertion and add `INDEXED BY events_type` to the `FROM events` clause in `feedQuery` (it is the index the spec names).

- [ ] **Step 7: Commit**

```bash
git add src/store.ts src/activity.ts src/server.ts test/activity.test.ts
git commit -m "feat(server): GET /api/activity streams safe display lines across runs"
```

---

### Task 13: `GET /api/roster/preview`

**Files:**
- Modify: `src/roster.ts` (export `DOMAIN` and `baseName`; `buildRoster` takes optional `langs`)
- Create: `src/rosterPreview.ts`
- Modify: `src/server.ts` (route)
- Test: `test/roster-preview.test.ts`

**Interfaces:**
- Consumes: `buildRoster`, `botLanguage`, `detectLanguages`, `loadRouting`, `RosterEntry`, `Routing`; `loadCrew`, `saveBot`, `BUILTIN_IDS`, `BUILTIN_BOTS`; `getWorkspace`, `listWorkspaces`; `RosterPreview` type.
- Produces:
  - `src/roster.ts`: `export const DOMAIN`, `export const baseName`, `buildRoster(o: { dir?: string; task: string; crew: BotDef[]; routing?: Routing; langs?: Set<string> })`.
  - `src/rosterPreview.ts`: `PREVIEW_TASK_MAX = 2000`, `workspaceLanguages(key: string, dir: string, now?: number): Set<string>` (cached 60 s), `clearLanguageCache()`, `taskKeywords(task: string): string[]`, `rankPreview(entries: RosterEntry[], o: { task: string; langs: Set<string>; routing?: Routing; names: Record<string, string> }): RosterPreview['bots']`, `rosterPreview(o: { home: string; task: string; ws?: string; now?: number }): RosterPreview`.
  - Route `GET /api/roster/preview?task=&ws=` → `RosterPreview`; task over 2000 characters → 400.

- [ ] **Step 1: Write the failing test** — create `test/roster-preview.test.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILTIN_BOTS, BUILTIN_IDS, loadCrew, saveBot, type BotDef } from '../src/crew.js';
import type { RosterEntry } from '../src/roster.js';
import { clearLanguageCache, rankPreview, taskKeywords, workspaceLanguages } from '../src/rosterPreview.js';
import { startHttpTestServer } from './http-helpers.js';
import { makeRepo } from './helpers.js';

const look = BUILTIN_BOTS[0]!.look;
const ecc = (id: string, when: string): BotDef => ({ id, name: id.replace(/-/g, ' '), title: id, kind: 'verdict', persona: '', look, source: 'ecc@v2.2.3', whenToUse: when });
const entry = (id: string, when = '', builtin = false): RosterEntry => ({ id, kind: 'agent', readOnly: true, when, builtin });

describe('ranking', () => {
  it('scores language, domain and keywords, drops zeros, keeps roster order on ties and returns three', () => {
    // rag: domain +3, "retriever" +1 = 4; go-reviewer: language +3; a/b/c-bot: keyword +1 each (roster order wins the tie)
    const entries = [entry('planner', 'plans', true), entry('go-reviewer', 'Reviews Go code'), entry('rag-pipeline-reviewer', 'Reviews retriever pipelines'), entry('docs-writer', 'Writes documentation'), entry('a-bot', 'retriever tuning'), entry('b-bot', 'retriever tuning'), entry('c-bot', 'retriever tuning')];
    const bots = rankPreview(entries, { task: 'fix the RAG retriever', langs: new Set(['go']), names: { 'rag-pipeline-reviewer': 'Rag reviewer' } });
    expect(bots.map((b) => b.id)).toEqual(['rag-pipeline-reviewer', 'go-reviewer', 'a-bot']);
    expect(bots[0]).toEqual({ id: 'rag-pipeline-reviewer', name: 'Rag reviewer', why: 'Reviews retriever pipelines' });
    expect(bots.some((b) => b.id === 'planner' || b.id === 'docs-writer')).toBe(false);
  });

  it('counts a routing rule that names the bot', () => {
    const bots = rankPreview([entry('ecc-security-reviewer', 'Security review')], { task: 'harden the login endpoint', langs: new Set(), names: {}, routing: { table: [], rules: [{ when: 'login and auth changes', agents: ['security-reviewer'] }] } });
    expect(bots.map((b) => b.id)).toEqual(['ecc-security-reviewer']);
  });

  it('cuts why to 80 characters and keeps only meaningful keywords', () => {
    expect(rankPreview([entry('x-bot', `retriever ${'y'.repeat(100)}`)], { task: 'retriever', langs: new Set(), names: {} })[0]!.why).toHaveLength(80);
    // words of 4+ letters, once each; "with" is a stop word and "fix" is too short
    expect(taskKeywords('Fix the flaky login test with care, care')).toEqual(['flaky', 'login', 'test', 'care']);
  });
});

describe('language cache', () => {
  it('scans a workspace once per 60 seconds', () => {
    clearLanguageCache();
    const dir = makeRepo();
    expect(workspaceLanguages('w', dir, 0).size).toBe(0);
    writeFileSync(join(dir, 'go.mod'), 'module x\n');
    expect(workspaceLanguages('w', dir, 59_000).size).toBe(0);
    expect([...workspaceLanguages('w', dir, 61_000)]).toEqual(['go']);
  });
});

describe('GET /api/roster/preview', () => {
  let srv: Awaited<ReturnType<typeof startHttpTestServer>>;
  beforeAll(async () => {
    srv = await startHttpTestServer();
    saveBot(srv.home, ecc('rag-pipeline-reviewer', 'Reviews retrieval and embedding pipelines'));
    saveBot(srv.home, ecc('seo-specialist', 'Improves search ranking of landing pages'));
    expect(loadCrew(srv.home).filter((b) => b.source).map((b) => b.id).sort()).toEqual(['rag-pipeline-reviewer', 'seo-specialist']);
  });
  afterAll(() => srv.close());
  const preview = (task: string, ws = 'api') => srv.api('GET', `/api/roster/preview?task=${encodeURIComponent(task)}&ws=${ws}`);

  it('picks different specialists for different tasks on the same workspace, never a built-in', async () => {
    const calls = srv.mock.calls.length;
    const rag = await preview('fix the RAG retriever');
    expect(rag.status).toBe(200);
    expect(rag.json.bots.map((b: { id: string }) => b.id)).toEqual(['rag-pipeline-reviewer']);
    const seo = await preview('improve SEO for the landing pages');
    expect(seo.json.bots.map((b: { id: string }) => b.id)).toEqual(['seo-specialist']);
    for (const r of [rag, seo]) {
      expect(r.json.bots.some((b: { id: string }) => BUILTIN_IDS.has(b.id))).toBe(false);
      expect(r.json.core).toEqual(expect.arrayContaining(['planner', 'coder', 'reviewer']));
    }
    expect(srv.mock.calls.length).toBe(calls); // no model call
  });

  it('answers built-ins only for an unknown workspace', async () => {
    const r = await preview('fix the RAG retriever', 'nope');
    expect(r.status).toBe(200);
    expect(r.json.bots).toEqual([]);
    expect(r.json.core.length).toBeGreaterThan(0);
  });

  it('refuses a task over 2000 characters', async () => {
    const r = await preview('x'.repeat(2001));
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/too long/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project node test/roster-preview.test.ts`
Expected: FAIL — `src/rosterPreview.js` not found.

- [ ] **Step 3: Export what the preview needs from `src/roster.ts`**

- `const DOMAIN: Record<string, RegExp> = {` → `export const DOMAIN: Record<string, RegExp> = {`
- `const baseName = (id: string) => id.replace(/^ecc-/, '');` → `export const baseName = (id: string): string => id.replace(/^ecc-/, '');`
- `export function buildRoster(o: { dir?: string; task: string; crew: BotDef[]; routing?: Routing }): RosterEntry[] {` → `export function buildRoster(o: { dir?: string; task: string; crew: BotDef[]; routing?: Routing; /** Languages already detected for `dir` (skips the scan). */ langs?: Set<string> }): RosterEntry[] {`, and its first line `const langs = detectLanguages(o.dir);` → `const langs = o.langs ?? detectLanguages(o.dir);`.

- [ ] **Step 4: Write `src/rosterPreview.ts`**

```ts
/** Up to three specialists Maestro would likely pick for a task, from the roster heuristic alone (no model call). */
import { loadCrew } from './crew.js';
import type { Routing } from './ecc.js';
import { DOMAIN, baseName, botLanguage, buildRoster, detectLanguages, loadRouting, type RosterEntry } from './roster.js';
import type { RosterPreview } from './types.js';
import { getWorkspace, listWorkspaces } from './workspace.js';

export const PREVIEW_TASK_MAX = 2000;
const LANG_TTL_MS = 60_000;
const WHY_MAX = 80;
const STOP = new Set(['with', 'that', 'this', 'from', 'into', 'have', 'make', 'when', 'what', 'they', 'them', 'then', 'than', 'there', 'their', 'about', 'should', 'would', 'could', 'also', 'some', 'more', 'only', 'just', 'your', 'where', 'which', 'while', 'will', 'each', 'other', 'after', 'before', 'over', 'under', 'using', 'need', 'needs', 'want', 'like', 'please']);

const langCache = new Map<string, { at: number; langs: Set<string> }>();

/** The repo scan, cached per workspace for 60 s (the preview is asked as the person types). */
export function workspaceLanguages(key: string, dir: string, now = Date.now()): Set<string> {
  const hit = langCache.get(key);
  if (hit && now - hit.at < LANG_TTL_MS) return hit.langs;
  const langs = detectLanguages(dir);
  langCache.set(key, { at: now, langs });
  return langs;
}
export const clearLanguageCache = (): void => langCache.clear();

/** Lower-cased words of 4+ letters, minus a short stop list, once each. */
export function taskKeywords(task: string): string[] {
  return [...new Set(task.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((w) => !STOP.has(w));
}

/** +3 language fit, +3 domain fit, +1 per task keyword in the bot's when line or a routing rule naming it. Top 3, zeros dropped, ties in roster order. */
export function rankPreview(entries: RosterEntry[], o: { task: string; langs: Set<string>; routing?: Routing; names: Record<string, string> }): RosterPreview['bots'] {
  const words = taskKeywords(o.task);
  return entries
    .filter((e) => !e.builtin)
    .map((e, i) => {
      let score = 0;
      const lang = botLanguage(e.id);
      if (lang && o.langs.has(lang)) score += 3;
      if (DOMAIN[baseName(e.id)]?.test(o.task)) score += 3;
      const rules = (o.routing?.rules ?? []).filter((r) => r.agents.includes(baseName(e.id)) || r.agents.includes(e.id)).map((r) => r.when);
      const text = [e.when, ...rules].join(' ').toLowerCase();
      score += words.filter((w) => text.includes(w)).length;
      return { e, i, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 3)
    .map(({ e }) => ({ id: e.id, name: o.names[e.id] ?? e.id, why: e.when.slice(0, WHY_MAX) }));
}

export function rosterPreview(o: { home: string; task: string; ws?: string; now?: number }): RosterPreview {
  const crew = loadCrew(o.home);
  const routing = loadRouting(o.home);
  const w = o.ws ? getWorkspace(o.home, o.ws) : listWorkspaces(o.home).find((x) => x.isDefault);
  const usable = !!w && w.exists;
  const langs = usable ? workspaceLanguages(w.id, w.path, o.now) : new Set<string>();
  const entries = buildRoster({ dir: usable ? w.path : undefined, task: o.task, crew, routing, langs });
  const core = entries.filter((e) => e.builtin).map((e) => e.id);
  if (!usable) return { bots: [], core };
  const names = Object.fromEntries(crew.map((b) => [b.id, b.name]));
  return { bots: rankPreview(entries, { task: o.task, langs, routing, names }), core };
}
```

- [ ] **Step 5: Add the route** — in `src/server.ts` add `import { PREVIEW_TASK_MAX, rosterPreview } from './rosterPreview.js';` and, after the activity route:

```ts
    if (p === '/api/roster/preview' && m === 'GET') {
      const task = url.searchParams.get('task') ?? '';
      if (task.length > PREVIEW_TASK_MAX) throw new HttpError(400, `"task" is too long (max ${PREVIEW_TASK_MAX})`);
      return send(res, 200, rosterPreview({ home: cfg.home, task, ws: url.searchParams.get('ws') ?? undefined })), true;
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run --project node test/roster-preview.test.ts test/roster.test.ts && npm run typecheck`
Expected: PASS (the existing roster tests still pass: `langs` is optional).

- [ ] **Step 7: Commit**

```bash
git add src/roster.ts src/rosterPreview.ts src/server.ts test/roster-preview.test.ts
git commit -m "feat(server): GET /api/roster/preview guesses Maestro's specialists without a model call"
```

---

### Task 14: Home — Start a run

**Files:**
- Create: `web/src/home/workspaces.ts`, `web/src/home/useRosterPreview.ts`, `web/src/home/StartRun.tsx`, `web/src/ui/studio/InlineError.tsx`
- Modify: `web/src/home/Home.tsx` (mount Start a run), `web/src/home/home.css` (append)
- Test: `web/src/home/useRosterPreview.test.tsx`, `web/src/home/StartRun.test.tsx`, `web/src/ui/studio/InlineError.test.tsx`

**Interfaces:**
- Consumes: `api`, `RosterPreview` (Task 10 re-export); `usePoll`, `Route`; `Panel`, `EmptyState`, `Kbd` (Task 4); `Loading`; `Face`; Arc `Textarea` (`label`), `Select` (`label`, `options`, `value`, `onValueChange`), `SegmentedControl`, `Button`; `useNotify`.
- Produces:
  - `interface WorkspaceRow { id: string; name: string; path: string; isDefault: boolean; exists: boolean; repos: string[] }`; `WS_KEY = 'aorch.api.ws'`; `storedWorkspace(): string | undefined`; `pickWorkspace(list: WorkspaceRow[], picked?: string): WorkspaceRow | undefined` (picked → stored → default → first; stale ids fall through).
  - `useRosterPreview(task: string, ws: string | undefined): RosterPreview | undefined` (`PREVIEW_DELAY_MS = 400`, `PREVIEW_MIN = 8`, `PREVIEW_MAX = 2000`).
  - `StartRun(props: { onGo: (r: Route) => void; onStarted: (id: string) => void })` — a `Panel` with class `s-start`.
  - `InlineError(props: { message: string; onRetry: () => void })` in `web/src/ui/studio/` — every data panel's inline load error (`role="alert"` + Retry).

- [ ] **Step 1: Write the failing tests**

`web/src/home/useRosterPreview.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { useRosterPreview } from './useRosterPreview';

const hook = (t: string) => renderHook(({ t }) => useRosterPreview(t, 'api'), { initialProps: { t } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api).mockReset();
});

describe('useRosterPreview', () => {
  it('asks 400 ms after typing stops, only for tasks of 8+ characters', async () => {
    vi.mocked(api).mockResolvedValue({ bots: [], core: ['planner'] });
    const { result, rerender } = hook('short');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api).not.toHaveBeenCalled();
    rerender({ t: 'fix the RAG' });
    await act(() => vi.advanceTimersByTimeAsync(200));
    rerender({ t: 'fix the RAG retriever' });
    await act(() => vi.advanceTimersByTimeAsync(399));
    expect(api).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(vi.mocked(api).mock.calls).toEqual([['GET', '/api/roster/preview?task=fix%20the%20RAG%20retriever&ws=api']]);
    expect(result.current).toEqual({ bots: [], core: ['planner'] });
  });

  it('keeps one request in flight and then sends only the latest text', async () => {
    let release!: (v: unknown) => void;
    vi.mocked(api)
      .mockImplementationOnce(() => new Promise((r) => (release = r)))
      .mockResolvedValue({ bots: [{ id: 'b', name: 'B', why: 'w' }], core: [] });
    const { result, rerender } = hook('first long task');
    await act(() => vi.advanceTimersByTimeAsync(400));
    rerender({ t: 'second long task' });
    await act(() => vi.advanceTimersByTimeAsync(400));
    rerender({ t: 'third long task' });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(api).toHaveBeenCalledTimes(1);
    await act(async () => release({ bots: [], core: [] }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(api).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api).mock.calls[1]![1]).toContain('third%20long%20task');
    expect(result.current?.bots[0]?.id).toBe('b');
  });

  it('hides on error and never asks for a task over 2000 characters', async () => {
    vi.mocked(api).mockRejectedValue(new Error('boom'));
    const { result, rerender } = hook('a long enough task');
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(result.current).toBeUndefined();
    vi.mocked(api).mockClear();
    rerender({ t: 'x'.repeat(2001) });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api).not.toHaveBeenCalled();
  });
});
```

`web/src/home/StartRun.test.tsx`:

```tsx
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api } from '../api';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { StartRun } from './StartRun';

const WS = [
  { id: 'api', name: 'API', path: '/p/api', isDefault: true, exists: true, repos: [] },
  { id: 'web', name: 'Web', path: '/p/web', isDefault: false, exists: true, repos: [] },
];
const routes = { 'GET /api/workspaces': WS, 'GET /api/roster/preview': new Error('hidden'), 'POST /api/runs': { id: 'r7' } };
const taskField = () => screen.findByLabelText('Task') as Promise<HTMLTextAreaElement>;
const type = async (text: string) => fireEvent.change(await taskField(), { target: { value: text } });
const start = () => screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement;
const setup = (p: { onGo?: () => void; onStarted?: (id: string) => void } = {}) => renderApp(<StartRun onGo={p.onGo ?? (() => {})} onStarted={p.onStarted ?? (() => {})} />);

beforeEach(() => {
  vi.mocked(api).mockReset();
  localStorage.clear();
  routeApi(routes);
});

describe('Start a run', () => {
  it('starts a live team run in the default workspace with Meta+Enter', async () => {
    const onStarted = vi.fn();
    setup({ onStarted });
    await type('Fix the login bug');
    await act(async () => fireEvent.keyDown(await taskField(), { key: 'Enter', metaKey: true }));
    expect(calls('POST', '/api/runs')[0]![2]).toEqual({ kind: 'team', mode: 'live', task: 'Fix the login bug', repo: '/p/api' });
    expect(onStarted).toHaveBeenCalledWith('r7');
    expect((await taskField()).value).toBe('');
  });

  it('starts an autonomous run with Ctrl+Enter, and plain Enter only adds a newline', async () => {
    setup();
    await type('Write the docs');
    fireEvent.click(screen.getByRole('button', { name: 'Team · autonomous' }));
    fireEvent.keyDown(await taskField(), { key: 'Enter' });
    expect(calls('POST', '/api/runs')).toHaveLength(0);
    await act(async () => fireEvent.keyDown(await taskField(), { key: 'Enter', ctrlKey: true }));
    expect(calls('POST', '/api/runs')[0]![2]).toMatchObject({ mode: 'autonomous', task: 'Write the docs' });
  });

  it('keeps Start disabled until there is a task', async () => {
    setup();
    await taskField();
    expect(start().disabled).toBe(true);
    await type('   ');
    expect(start().disabled).toBe(true);
    await type('Do it');
    expect(start().disabled).toBe(false);
  });

  it('shows a refused start inline and keeps the task', async () => {
    routeApi({ ...routes, 'POST /api/runs': new Error('repo path does not exist: /p/api') });
    setup();
    await type('Fix it');
    await act(async () => fireEvent.click(start()));
    expect(screen.getByRole('alert').textContent).toContain('repo path does not exist');
    expect((await taskField()).value).toBe('Fix it');
  });

  it('starts one run when Start is clicked twice', async () => {
    routeApi({ ...routes, 'POST /api/runs': new Promise(() => {}) });
    setup();
    await type('Fix it');
    fireEvent.click(start());
    fireEvent.click(start());
    await act(async () => {});
    expect(calls('POST', '/api/runs')).toHaveLength(1);
    expect(start().disabled).toBe(true);
  });

  it('uses the API tab’s workspace', async () => {
    localStorage.setItem('aorch.api.ws', 'web');
    setup();
    await type('Fix it');
    await act(async () => fireEvent.click(start()));
    expect(calls('POST', '/api/runs')[0]![2]).toMatchObject({ repo: '/p/web' });
  });

  it('falls back to the default workspace when the stored one is gone', async () => {
    localStorage.setItem('aorch.api.ws', 'removed');
    setup();
    await type('Fix it');
    await act(async () => fireEvent.click(start()));
    expect(calls('POST', '/api/runs')[0]![2]).toMatchObject({ repo: '/p/api' });
  });

  it('does not start in a workspace whose folder is missing', async () => {
    routeApi({ ...routes, 'GET /api/workspaces': [{ ...WS[0]!, exists: false }] });
    setup();
    await type('Fix it');
    expect(start().disabled).toBe(true);
    expect(screen.getByRole('note').textContent).toContain('/p/api');
  });

  it('shows the register-a-workspace empty state when none is registered', async () => {
    routeApi({ ...routes, 'GET /api/workspaces': [] });
    setup();
    expect(await screen.findByText('No workspace yet')).toBeTruthy();
    expect(screen.getByText(/aorch workspace init/)).toBeTruthy();
    expect(screen.queryByLabelText('Task')).toBeNull();
  });

  it('fills the task from an example and opens the Builder for workflows', async () => {
    const onGo = vi.fn();
    setup({ onGo });
    fireEvent.click(await screen.findByRole('button', { name: 'Fix the flaky login test' }));
    expect((await taskField()).value).toBe('Fix the flaky login test');
    fireEvent.click(screen.getByRole('button', { name: 'Workflow…' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'builder' });
  });

  it('shows Maestro’s likely picks as a guess, next to the core crew', async () => {
    routeApi({ ...routes, 'GET /api/roster/preview': { bots: [{ id: 'rag-pipeline-reviewer', name: 'RAG reviewer', why: 'Reviews retrieval' }], core: ['planner', 'coder', 'reviewer', 'architect'] } });
    setup();
    await type('fix the RAG retriever');
    expect(await screen.findByText('RAG reviewer', {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText(/a guess/)).toBeTruthy();
    expect(screen.getByText('core crew (planner, coder, reviewer…) always available')).toBeTruthy();
  });

  it('says Maestro will use the core crew when it would pick no specialist', async () => {
    routeApi({ ...routes, 'GET /api/roster/preview': { bots: [], core: ['planner', 'coder'] } });
    setup();
    await type('tidy the readme file');
    await waitFor(() => expect(screen.getByText('Maestro will use the core crew')).toBeTruthy(), { timeout: 2000 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project web web/src/home`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`web/src/home/workspaces.ts`:

```ts
export interface WorkspaceRow { id: string; name: string; path: string; isDefault: boolean; exists: boolean; repos: string[] }

/** The API tab's workspace choice (shared with Home). */
export const WS_KEY = 'aorch.api.ws';

export function storedWorkspace(): string | undefined {
  try {
    return localStorage.getItem(WS_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The picked workspace, else the API tab's choice, else the default, else the first. An id that is no longer listed falls through. */
export function pickWorkspace(list: WorkspaceRow[], picked?: string): WorkspaceRow | undefined {
  const byId = (id?: string) => (id ? list.find((w) => w.id === id) : undefined);
  return byId(picked) ?? byId(storedWorkspace()) ?? list.find((w) => w.isDefault) ?? list[0];
}
```

`web/src/home/useRosterPreview.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { api, type RosterPreview } from '../api';

export const PREVIEW_DELAY_MS = 400;
export const PREVIEW_MIN = 8;
export const PREVIEW_MAX = 2000;

/**
 * "Maestro would pick": asked 400 ms after typing stops, for tasks of 8 to 2000 characters, with at most one request in
 * flight (newer text waits and only the latest is sent). Undefined hides the row: nothing to show yet, or any error.
 */
export function useRosterPreview(task: string, ws: string | undefined): RosterPreview | undefined {
  const [preview, setPreview] = useState<RosterPreview>();
  const inFlight = useRef(false);
  const queued = useRef<{ task: string; ws?: string } | null>(null);
  const latest = useRef({ task: task.trim(), ws });
  latest.current = { task: task.trim(), ws };
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const ask = useRef(async (q: { task: string; ws?: string }): Promise<void> => {
    if (inFlight.current) {
      queued.current = q;
      return;
    }
    inFlight.current = true;
    try {
      const r = await api<RosterPreview>('GET', `/api/roster/preview?task=${encodeURIComponent(q.task)}${q.ws ? `&ws=${encodeURIComponent(q.ws)}` : ''}`);
      // a reply for text that has changed since is dropped
      if (alive.current && latest.current.task === q.task && latest.current.ws === q.ws) setPreview(r);
    } catch {
      if (alive.current) setPreview(undefined);
    } finally {
      inFlight.current = false;
      const next = queued.current;
      queued.current = null;
      if (next) void ask.current(next);
    }
  });

  useEffect(() => {
    const t = task.trim();
    if (t.length < PREVIEW_MIN || t.length > PREVIEW_MAX) {
      setPreview(undefined);
      return;
    }
    const timer = setTimeout(() => void ask.current({ task: t, ws }), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [task, ws]);

  return preview;
}
```

`web/src/home/StartRun.tsx`:

```tsx
import { useState, type KeyboardEvent } from 'react';
import { api, type RosterPreview } from '../api';
import { Button } from '../components/arc/button/button';
import SegmentedControl from '../components/arc/segmented-control/segmented-control';
import { Select } from '../components/arc/select/select';
import { Textarea } from '../components/arc/textarea/textarea';
import { Loading } from '../components/Loading';
import { Face } from '../Face';
import { usePoll, type Route } from '../hooks';
import { EmptyState } from '../ui/studio/EmptyState';
import { InlineError } from '../ui/studio/InlineError';
import { Kbd } from '../ui/studio/Kbd';
import { Panel } from '../ui/studio/Panel';
import { useRosterPreview } from './useRosterPreview';
import { pickWorkspace, type WorkspaceRow } from './workspaces';

type Mode = 'live' | 'autonomous';
const EXAMPLES = ['Add rate limiting to the public API', 'Fix the flaky login test', 'Write a README section for the CLI'];

function PreviewRow({ preview }: { preview: RosterPreview }) {
  const core = `${preview.core.slice(0, 3).join(', ')}${preview.core.length > 3 ? '…' : ''}`;
  return (
    <div className="start-preview" aria-label="Maestro would pick">
      <span className="sl-meta">Maestro would pick · a guess</span>
      {preview.bots.length ? (
        <>
          <ul className="sl-list start-picks">
            {preview.bots.map((b) => (
              <li key={b.id}>
                <Face id={b.id} size={20} label={b.name} />
                <b>{b.name}</b>
                <span className="start-why">{b.why}</span>
              </li>
            ))}
          </ul>
          <span className="sl-meta">core crew ({core}) always available</span>
        </>
      ) : (
        <span>Maestro will use the core crew</span>
      )}
    </div>
  );
}

/** Start a team run from Home (workflow runs start from the Builder's run dialog). */
export function StartRun(props: { onGo: (r: Route) => void; onStarted: (id: string) => void }) {
  const workspaces = usePoll<WorkspaceRow[]>('/api/workspaces', 30_000);
  const [picked, setPicked] = useState<string>();
  const ws = pickWorkspace(workspaces.data ?? [], picked);
  const [task, setTask] = useState('');
  const [mode, setMode] = useState<Mode>('live');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const preview = useRosterPreview(task, ws?.id);
  const ready = !!task.trim() && !!ws?.exists && !busy;

  async function start() {
    if (!ready || !ws) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ id: string }>('POST', '/api/runs', { kind: 'team', mode, task: task.trim(), repo: ws.path });
      setTask('');
      props.onStarted(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    void start();
  };

  const list = workspaces.data;
  return (
    <Panel title="Start a run" className="s-start">
      <Loading loading={list === undefined && !workspaces.error} lines={5} label="Loading workspaces">
        {workspaces.error && !list ? (
          <InlineError message={workspaces.error} onRetry={() => void workspaces.refresh()} />
        ) : !list?.length ? (
          <EmptyState title="No workspace yet" description="Register the project the team should work on: run aorch workspace init in its folder." />
        ) : (
          <div className="start-form">
            <Textarea label="Task" rows={3} value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={onKeyDown} placeholder="What should the team do?" />
            <div className="start-chips">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" className="start-chip" onClick={() => setTask(x)}>
                  {x}
                </button>
              ))}
            </div>
            <div className="start-row">
              <Select label="Workspace" value={ws?.id} onValueChange={setPicked} options={list.map((w) => ({ value: w.id, label: w.exists ? w.name : `${w.name} (folder missing)` }))} />
              <SegmentedControl label="Run as" options={[{ value: 'live', label: 'Team · live' }, { value: 'autonomous', label: 'Team · autonomous' }]} value={mode} onValueChange={(v) => setMode(v as Mode)} />
              <button type="button" className="link" onClick={() => props.onGo({ tab: 'builder' })}>
                Workflow…
              </button>
            </div>
            {preview ? <PreviewRow preview={preview} /> : null}
            {ws && !ws.exists ? (
              <p className="sl-note" role="note">
                The folder for {ws.name} is missing: {ws.path}
              </p>
            ) : null}
            {error ? (
              <p className="sl-alert" role="alert">
                {error}
              </p>
            ) : null}
            <div className="start-go">
              <Kbd mod>↵</Kbd>
              <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void start()}>
                Start
              </Button>
            </div>
          </div>
        )}
      </Loading>
    </Panel>
  );
}
```

Create `web/src/ui/studio/InlineError.tsx` (shared by every data panel from here on):

```tsx
import { Button } from '../../components/arc/button/button';
import './parts.css';

/** A data panel's own load error, with a retry. Never a silent empty list. */
export function InlineError(props: { message: string; onRetry: () => void }) {
  return (
    <div className="sl-alert" role="alert">
      <span>{props.message}</span>
      <Button variant="secondary" size="sm" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  );
}
```

and its test `web/src/ui/studio/InlineError.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineError } from './InlineError';

describe('InlineError', () => {
  it('is an alert with a retry', () => {
    const onRetry = vi.fn();
    render(<InlineError message="down" onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('down');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
```

Replace `web/src/home/Home.tsx`:

```tsx
import type { Route } from '../hooks';
import { useNotify } from '../ui/notify';
import { ScreenHeader } from '../ui/studio/ScreenHeader';
import { StartRun } from './StartRun';
import './home.css';

export function Home(props: { onGo: (r: Route) => void }) {
  const notify = useNotify();
  return (
    <div className="home">
      <ScreenHeader meta="aorch · this machine" title="Home" summary="What needs you, what is running, and a place to start the next run." />
      <div className="home-grid">
        <StartRun onGo={props.onGo} onStarted={(id) => notify.ok('Run started', id)} />
      </div>
    </div>
  );
}
```

(Task 15 replaces the toast with a refresh of Running.)

Append to `web/src/home/home.css`:

```css
.start-form { display: flex; flex-direction: column; gap: 12px; }
.start-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.start-chip { padding: 2px 10px; border: 1px solid var(--line2); border-radius: 8px; background: var(--s1); color: var(--mut); font: inherit; font-size: 12px; cursor: pointer; }
.start-chip:hover { color: var(--ink); background: var(--s2); }
.start-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.start-row > :first-child { flex: 1 1 200px; min-width: 0; }
.start-preview { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px dashed var(--line2); border-radius: 10px; }
.start-picks li { display: flex; gap: 8px; align-items: center; min-width: 0; }
.start-why { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--mut); }
.start-go { display: flex; gap: 10px; align-items: center; justify-content: flex-end; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project web web/src/home web/src/ui/studio/InlineError.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/home web/src/ui/studio/InlineError.tsx web/src/ui/studio/InlineError.test.tsx
git commit -m "feat(web): Home starts team runs, with the roster guess and workspace fallbacks"
```

---

### Task 15: Home — Needs you, Running, Recent, and polling

**Files:**
- Create: `web/src/home/runText.ts`, `web/src/home/Elapsed.tsx`, `web/src/home/NeedsYou.tsx`, `web/src/home/Running.tsx`, `web/src/home/Recent.tsx`
- Modify: `web/src/home/Home.tsx` (full rewrite), `web/src/home/home.css` (append)
- Test: `web/src/home/NeedsYou.test.tsx`, `web/src/home/Running.test.tsx`, `web/src/home/Recent.test.tsx`, `web/src/home/Home.test.tsx`

**Interfaces:**
- Consumes: `RunRow` with `steps`, `current`, `bots`, `lastTs`, `branch` and `AttentionItem` (Task 10); `Poll<T>`; `Panel`, `ListRow`, `StatusChip`, `StepTrack`, `FaceStack`, `EmptyState`, `InlineError`; `Loading`; `api`, `ago`, `fmtDur`, `fmtUsd`; `useNotify`.
- Produces:
  - `runText.ts`: `runTitle(r: { kind: string; pipeline: string }): string`, `nowLine(r: RunRow): string`, `workingBot(r: RunRow): string | undefined`, `recentRuns(rows: RunRow[]): RunRow[]`, `busyBots(rows: RunRow[]): Set<string>`, `fmtClock(ms: number): string`.
  - `Elapsed(props: { since: number })`.
  - `NeedsYou(props: { poll: Poll<{ items: AttentionItem[] }>; refreshing: boolean; onGo: (r: Route) => void; onChanged: () => void })`; `linkFor(item: AttentionItem, a: AttentionAction): Route`.
  - `Running(props: { poll: Poll<RunRow[]>; refreshing: boolean; onGo })`, `Recent(props: same)`.
  - `Home`: polls `/api/runs` and `/api/attention` every 2 s while any run is live, every 10 s otherwise (`LIVE_MS`, `IDLE_MS`); a Refresh action shows skeletons.

- [ ] **Step 1: Write the failing tests**

`web/src/home/NeedsYou.test.tsx`:

```tsx
import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type AttentionItem } from '../api';
import type { Poll } from '../hooks';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { NeedsYou } from './NeedsYou';

const now = Date.now();
const items: AttentionItem[] = [
  { id: 'r1:approval:ok', ts: now - 60_000, runId: 'r1', kind: 'approval', title: 'Ship it waits for approval', meta: 'flow · r1 · aorch/r1', actions: ['approve', 'open'], node: 'ok' },
  { id: 'r2:failed', ts: now - 120_000, runId: 'r2', kind: 'failed', title: 'Failed', meta: 'flow · r2 · aorch/r2', actions: ['retry', 'open'] },
  { id: 'r3:question:q1', ts: now - 180_000, runId: 'r3', kind: 'question', title: 'Which database?', meta: 'Team run · r3 · aorch/r3', actions: ['answer'], node: 'code' },
];
const poll = (data?: { items: AttentionItem[] }, error?: string): Poll<{ items: AttentionItem[] }> => ({ data, error, fails: 0, refresh: vi.fn(async () => {}) });
const setup = (p: Poll<{ items: AttentionItem[] }>, refreshing = false) => {
  const onGo = vi.fn();
  const onChanged = vi.fn();
  renderApp(<NeedsYou poll={p} refreshing={refreshing} onGo={onGo} onChanged={onChanged} />);
  return { onGo, onChanged };
};

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({ 'POST /api/runs/r1/approve': {}, 'POST /api/runs/r2/resume': {} });
});

describe('Needs you', () => {
  it('lists items newest first with a kind chip, meta, age and actions', () => {
    setup(poll({ items }));
    expect(screen.getByRole('region', { name: 'Needs you' })).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('.sl-row-title')!.textContent)).toEqual(['Ship it waits for approval', 'Failed', 'Which database?']);
    expect(screen.getByText('approval').closest('.sl-chip')!.className).toContain('t-needs');
    expect(screen.getByText('failed').closest('.sl-chip')!.className).toContain('t-failed');
    expect(screen.getByText('flow · r1 · aorch/r1')).toBeTruthy();
    expect(screen.getByText('1m ago')).toBeTruthy();
  });

  it('approves in place and re-fetches', async () => {
    const { onChanged } = setup(poll({ items }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve' })));
    expect(calls('POST', '/api/runs/r1/approve')[0]![2]).toEqual({ node: 'ok', approved: true });
    expect(onChanged).toHaveBeenCalled();
  });

  it('retries a failed run through resume', async () => {
    setup(poll({ items }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(calls('POST', '/api/runs/r2/resume')).toHaveLength(1);
  });

  it('toasts a failed action and leaves the row', async () => {
    routeApi({ 'POST /api/runs/r1/approve': new Error('run is not paused') });
    const { onChanged } = setup(poll({ items }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve' })));
    expect(await screen.findByText('run is not paused')).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByText('Ship it waits for approval')).toBeTruthy();
  });

  it('links answers to the asking step and open to the run', () => {
    const { onGo } = setup(poll({ items }));
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(onGo).toHaveBeenLastCalledWith({ tab: 'runs', id: 'r3', node: 'code' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[1]!);
    expect(onGo).toHaveBeenLastCalledWith({ tab: 'runs', id: 'r2' });
  });

  it('says when nothing needs you, shows a load error with retry, and a skeleton while loading', () => {
    const { unmount } = renderApp(<NeedsYou poll={poll({ items: [] })} refreshing={false} onGo={() => {}} onChanged={() => {}} />);
    expect(screen.getByText('Nothing needs you')).toBeTruthy();
    unmount();
    const failing = poll(undefined, 'down');
    setup(failing);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failing.refresh).toHaveBeenCalled();
  });

  it('shows the ascii skeleton on first load and on refresh', () => {
    const { unmount } = renderApp(<NeedsYou poll={poll()} refreshing={false} onGo={() => {}} onChanged={() => {}} />);
    expect(screen.getByRole('status', { name: 'Loading what needs you' })).toBeTruthy();
    unmount();
    setup(poll({ items }), true);
    expect(screen.getByRole('status', { name: 'Loading what needs you' })).toBeTruthy();
  });
});
```

`web/src/home/Running.test.tsx`:

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../api';
import type { Poll } from '../hooks';
import { makeRow } from '../test/fixtures';
import { Elapsed } from './Elapsed';
import { fmtClock, nowLine } from './runText';
import { Running } from './Running';

const poll = (data?: RunRow[]): Poll<RunRow[]> => ({ data, error: undefined, fails: 0, refresh: vi.fn(async () => {}) });
const working = makeRow({
  id: 'r1', live: true, pipeline: 'ship', branch: 'aorch/r1',
  steps: [{ id: 'plan', status: 'done', bot: 'planner' }, { id: 'code', status: 'running', bot: 'coder' }],
  current: { node: 'code', bot: 'Bolt', title: 'Implement' }, bots: ['planner', 'coder'],
});

describe('Running', () => {
  it('shows each live run with meta, step track, faces, what is happening and a clock', () => {
    const onGo = vi.fn();
    render(<Running poll={poll([working, makeRow({ id: 'r2', live: false, status: 'running' })])} refreshing={false} onGo={onGo} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('r1 · aorch/r1 · workflow')).toBeTruthy();
    expect(screen.getByText('Bolt is working on Implement')).toBeTruthy();
    expect(screen.getByRole('img', { name: '1 of 2 steps done, 1 working' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Bolt' }).getAttribute('data-mood')).toBe('working');
    expect(screen.getByText(/^started /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ship' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'runs', id: 'r1' });
  });

  it('describes planning, plans and waiting steps', () => {
    expect(nowLine(makeRow({ kind: 'team', steps: [] }))).toBe('Maestro is planning');
    expect(nowLine(makeRow({ kind: 'team', steps: [], planReady: true }))).toBe('The plan waits for your approval');
    expect(nowLine(makeRow({ kind: 'team', steps: [], pending: 2 }))).toBe('Maestro has a question for you');
    expect(nowLine(makeRow({ steps: [{ id: 'ok', status: 'awaiting', bot: 'approval' }], current: { node: 'ok', bot: 'Gate', title: 'Ship it' } }))).toBe('Ship it waits for you');
    expect(nowLine(makeRow({ steps: [{ id: 'a', status: 'done', bot: 'coder' }] }))).toBe('Between steps');
  });

  it('says when nothing is running', () => {
    render(<Running poll={poll([])} refreshing={false} onGo={() => {}} />);
    expect(screen.getByText('Nothing running')).toBeTruthy();
  });
});

describe('Elapsed', () => {
  it('ticks a hidden clock and keeps a static spoken label', () => {
    vi.useFakeTimers();
    const since = Date.now() - 65_000;
    const { container } = render(<Elapsed since={since} />);
    expect(container.querySelector('[aria-hidden="true"]')!.textContent).toBe('1:05');
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector('[aria-hidden="true"]')!.textContent).toBe('1:06');
    expect(screen.getByText('started 1m ago')).toBeTruthy();
    expect(fmtClock(3_725_000)).toBe('1:02:05');
  });
});
```

`web/src/home/Recent.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../api';
import type { Poll } from '../hooks';
import { makeRow } from '../test/fixtures';
import { Recent } from './Recent';
import { recentRuns } from './runText';

const t = Date.now();
const done = (id: string, finishedAt: number, o: Partial<RunRow> = {}) => makeRow({ id, pipeline: id, status: 'done', live: false, startedAt: finishedAt - 90_000, finishedAt, costUsd: 0.25, ...o });

describe('Recent', () => {
  it('keeps the 5 most recently finished runs, probes left out', () => {
    const rows = [done('a', t - 1), done('b', t - 7), done('c', t - 3, { status: 'error' }), done('d', t - 4, { status: 'stopped' }), done('e', t - 5), done('f', t - 6), done('p', t, { probe: true }), makeRow({ id: 'live' })];
    expect(recentRuns(rows).map((r) => r.id)).toEqual(['a', 'c', 'd', 'e', 'f']);
  });
  it('shows result, title, duration and cost', () => {
    const poll: Poll<RunRow[]> = { data: [done('ship', t - 1)], error: undefined, fails: 0, refresh: vi.fn(async () => {}) };
    render(<Recent poll={poll} refreshing={false} onGo={() => {}} />);
    expect(screen.getByText('ship')).toBeTruthy();
    expect(screen.getByText('1m 30s · $0.25')).toBeTruthy();
    expect(screen.getByText('done')).toBeTruthy();
  });
  it('says when nothing has finished yet', () => {
    render(<Recent poll={{ data: [], error: undefined, fails: 0, refresh: async () => {} }} refreshing={false} onGo={() => {}} />);
    expect(screen.getByText('No finished runs yet')).toBeTruthy();
  });
});
```

`web/src/home/Home.test.tsx`:

```tsx
import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type RunRow } from '../api';
import { calls, FakeEventSource, makeRow, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { Home } from './Home';

let rows: RunRow[] = [];
beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.stubGlobal('EventSource', FakeEventSource);
  rows = [makeRow({ id: 'r0', status: 'done', live: false, finishedAt: Date.now() })];
  routeApi({
    'GET /api/runs': () => rows,
    'GET /api/attention': { items: [] },
    'GET /api/workspaces': [],
    'GET /api/activity': { lines: [], cursor: null },
    'GET /api/http/tree': { root: { path: '', name: '', collections: [], requests: [] }, environments: [], activeEnv: null, workspace: 'api' },
    'GET /api/http/history': [],
  });
});

describe('Home', () => {
  it('lays out the sections in the one-column order', async () => {
    renderApp(<Home onGo={() => {}} />);
    await act(async () => {});
    const names = screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby') && document.getElementById(r.getAttribute('aria-labelledby')!)!.textContent);
    expect(names.slice(0, 4)).toEqual(['Needs you', 'Start a run', 'Running', 'Recent']);
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeTruthy();
  });

  it('polls every 10 s while nothing is live and every 2 s while a run is live, with no EventSource', async () => {
    vi.useFakeTimers();
    renderApp(<Home onGo={() => {}} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    const n = () => calls('GET', '/api/runs').length;
    const a = () => calls('GET', '/api/attention').length;
    const start = n();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(n()).toBe(start);
    await act(() => vi.advanceTimersByTimeAsync(8000));
    expect(n()).toBe(start + 1);
    rows = [makeRow({ id: 'r1', live: true })];
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    const live = n();
    const liveA = a();
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(n() - live).toBe(2);
    expect(a() - liveA).toBe(2);
    expect(FakeEventSource.all).toHaveLength(0);
  });

  it('shows skeletons while refreshing', async () => {
    let finish!: () => void;
    renderApp(<Home onGo={() => {}} />);
    await act(async () => {});
    routeApi({ 'GET /api/runs': () => new Promise<RunRow[]>((r) => (finish = () => r(rows))), 'GET /api/attention': { items: [] }, 'GET /api/workspaces': [], 'GET /api/activity': { lines: [], cursor: null } });
    await act(async () => screen.getByRole('button', { name: 'Refresh' }).click());
    expect(screen.getByRole('status', { name: 'Loading running runs' })).toBeTruthy();
    await act(async () => finish());
    expect(screen.queryByRole('status', { name: 'Loading running runs' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project web web/src/home`
Expected: FAIL — `NeedsYou`, `Running`, `Recent`, `Elapsed`, `runText` missing.

- [ ] **Step 3: Write the implementation**

`web/src/home/runText.ts`:

```ts
import type { RunRow } from '../api';

export const runTitle = (r: { kind: string; pipeline: string }): string => (r.kind === 'team' ? 'Team run' : r.pipeline);

/** "What's happening now" for a live run, from its current step (no free text). */
export function nowLine(r: RunRow): string {
  if (r.kind === 'team' && !r.steps.length) return r.planReady ? 'The plan waits for your approval' : r.pending ? 'Maestro has a question for you' : 'Maestro is planning';
  if (!r.current) return 'Between steps';
  const status = r.steps.find((s) => s.id === r.current!.node)?.status;
  return status === 'awaiting' ? `${r.current.title} waits for you` : `${r.current.bot} is working on ${r.current.title}`;
}

/** The face that breathes: the current step's bot, or Maestro while a team plans. */
export function workingBot(r: RunRow): string | undefined {
  if (r.current) return r.steps.find((s) => s.id === r.current!.node)?.bot;
  return r.kind === 'team' && !r.steps.length ? 'orchestrator' : undefined;
}

const FINISHED = new Set(['done', 'error', 'stopped']);
export function recentRuns(rows: RunRow[]): RunRow[] {
  return rows
    .filter((r) => !r.probe && FINISHED.has(r.status))
    .sort((a, b) => (b.finishedAt ?? b.lastTs) - (a.finishedAt ?? a.lastTs))
    .slice(0, 5);
}

/** Bots of running steps in live runs. */
export function busyBots(rows: RunRow[]): Set<string> {
  return new Set(rows.filter((r) => r.live).flatMap((r) => r.steps.filter((s) => s.status === 'running').map((s) => s.bot)));
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
```

`web/src/home/Elapsed.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ago } from '../api';
import { fmtClock } from './runText';

/** A live elapsed clock (hidden from screen readers) with a static "started … ago" label. */
export function Elapsed(props: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="elapsed">
      <span aria-hidden="true">{fmtClock(now - props.since)}</span>
      <span className="sl-sr">started {ago(props.since)}</span>
    </span>
  );
}
```

`web/src/home/NeedsYou.tsx`:

```tsx
import { useState } from 'react';
import { ago, api, type AttentionAction, type AttentionItem } from '../api';
import { Button } from '../components/arc/button/button';
import { Loading } from '../components/Loading';
import type { Poll, Route } from '../hooks';
import { useNotify } from '../ui/notify';
import { EmptyState } from '../ui/studio/EmptyState';
import { InlineError } from '../ui/studio/InlineError';
import { ListRow } from '../ui/studio/ListRow';
import { Panel } from '../ui/studio/Panel';
import { StatusChip } from '../ui/studio/StatusChip';

const KIND_LABEL: Record<AttentionItem['kind'], string> = { plan_ready: 'plan ready', question: 'question', approval: 'approval', planning_error: 'planning failed', paused: 'paused', interrupted: 'interrupted', failed: 'failed' };
const ACTION_LABEL: Record<AttentionAction, string> = { answer: 'Answer', review: 'Review plan', approve: 'Approve', resume: 'Resume', retry: 'Retry', open: 'Open' };
const PRIMARY = new Set<AttentionAction>(['answer', 'review', 'approve']);

/** Where a link action goes: a worker's question or an approval opens its step; everything else opens the run. */
export function linkFor(item: AttentionItem, a: AttentionAction): Route {
  return (a === 'answer' || a === 'open') && item.node ? { tab: 'runs', id: item.runId, node: item.node } : { tab: 'runs', id: item.runId };
}

export function NeedsYou(props: { poll: Poll<{ items: AttentionItem[] }>; refreshing: boolean; onGo: (r: Route) => void; onChanged: () => void }) {
  const notify = useNotify();
  const [busy, setBusy] = useState<string>();
  const { data, error, refresh } = props.poll;
  const items = data?.items ?? [];

  async function post(item: AttentionItem, path: 'approve' | 'resume', body: unknown) {
    setBusy(item.id);
    try {
      await api('POST', `/api/runs/${encodeURIComponent(item.runId)}/${path}`, body);
      props.onChanged();
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(undefined);
    }
  }
  const act = (item: AttentionItem, a: AttentionAction) => {
    if (a === 'approve') return void post(item, 'approve', { node: item.node, approved: true });
    if (a === 'resume' || a === 'retry') return void post(item, 'resume', {});
    props.onGo(linkFor(item, a));
  };

  return (
    <Panel title="Needs you" count={data ? items.length : undefined} className="s-needs">
      <Loading loading={(data === undefined && !error) || props.refreshing} lines={3} label="Loading what needs you">
        {error && !data ? (
          <InlineError message={error} onRetry={() => void refresh()} />
        ) : !items.length ? (
          <EmptyState title="Nothing needs you" description="Questions, plans and approvals from your runs show up here." action={<Button variant="secondary" size="sm" onClick={() => props.onGo({ tab: 'runs' })}>Open Runs</Button>} />
        ) : (
          <ul className="sl-list">
            {items.map((it) => (
              <ListRow
                key={it.id}
                lead={<StatusChip tone={it.kind === 'failed' || it.kind === 'planning_error' ? 'failed' : 'needs'} label={KIND_LABEL[it.kind]} />}
                title={it.title}
                meta={it.meta}
                age={ago(it.ts)}
                actions={it.actions.map((a) => (
                  <Button key={a} size="sm" variant={PRIMARY.has(a) ? 'primary' : 'secondary'} disabled={busy === it.id} onClick={() => act(it, a)}>
                    {ACTION_LABEL[a]}
                  </Button>
                ))}
              />
            ))}
          </ul>
        )}
      </Loading>
    </Panel>
  );
}
```

`web/src/home/Running.tsx`:

```tsx
import type { RunRow } from '../api';
import { Button } from '../components/arc/button/button';
import { Loading } from '../components/Loading';
import type { Poll, Route } from '../hooks';
import { EmptyState } from '../ui/studio/EmptyState';
import { FaceStack } from '../ui/studio/FaceStack';
import { InlineError } from '../ui/studio/InlineError';
import { ListRow } from '../ui/studio/ListRow';
import { Panel } from '../ui/studio/Panel';
import { StepTrack } from '../ui/studio/StepTrack';
import { Elapsed } from './Elapsed';
import { nowLine, runTitle, workingBot } from './runText';

export function Running(props: { poll: Poll<RunRow[]>; refreshing: boolean; onGo: (r: Route) => void }) {
  const { data, error, refresh } = props.poll;
  const live = (data ?? []).filter((r) => r.live);
  return (
    <Panel title="Running" count={data ? live.length : undefined} className="s-running">
      <Loading loading={(data === undefined && !error) || props.refreshing} lines={3} label="Loading running runs">
        {error && !data ? (
          <InlineError message={error} onRetry={() => void refresh()} />
        ) : !live.length ? (
          <EmptyState title="Nothing running" description="Runs you start appear here while they work." action={<Button variant="secondary" size="sm" onClick={() => props.onGo({ tab: 'runs' })}>Open Runs</Button>} />
        ) : (
          <ul className="sl-list">
            {live.map((r) => (
              <ListRow
                key={r.id}
                lead={<FaceStack bots={r.bots.length ? r.bots : r.kind === 'team' ? ['orchestrator'] : []} working={workingBot(r)} />}
                title={runTitle(r)}
                onOpen={() => props.onGo({ tab: 'runs', id: r.id })}
                meta={`${r.id} · ${r.branch} · ${r.kind}`}
                age={<Elapsed since={r.startedAt} />}
                extra={
                  <>
                    <StepTrack steps={r.steps} planning={r.kind === 'team' && !r.steps.length} />
                    <span className="run-now">{nowLine(r)}</span>
                  </>
                }
              />
            ))}
          </ul>
        )}
      </Loading>
    </Panel>
  );
}
```

`web/src/home/Recent.tsx`:

```tsx
import { fmtDur, fmtUsd, type RunRow } from '../api';
import { Button } from '../components/arc/button/button';
import { Loading } from '../components/Loading';
import type { Poll, Route } from '../hooks';
import { EmptyState } from '../ui/studio/EmptyState';
import { InlineError } from '../ui/studio/InlineError';
import { ListRow } from '../ui/studio/ListRow';
import { Panel } from '../ui/studio/Panel';
import { StatusChip, toneFor } from '../ui/studio/StatusChip';
import { recentRuns, runTitle } from './runText';

export function Recent(props: { poll: Poll<RunRow[]>; refreshing: boolean; onGo: (r: Route) => void }) {
  const { data, error, refresh } = props.poll;
  const rows = recentRuns(data ?? []);
  return (
    <Panel title="Recent" className="s-recent">
      <Loading loading={(data === undefined && !error) || props.refreshing} lines={3} label="Loading recent runs">
        {error && !data ? (
          <InlineError message={error} onRetry={() => void refresh()} />
        ) : !rows.length ? (
          <EmptyState title="No finished runs yet" description="Finished runs show their result, time and cost here." action={<Button variant="secondary" size="sm" onClick={() => props.onGo({ tab: 'runs' })}>Open Runs</Button>} />
        ) : (
          <ul className="sl-list">
            {rows.map((r) => (
              <ListRow
                key={r.id}
                lead={<StatusChip tone={toneFor(r.status)} label={r.status} />}
                title={runTitle(r)}
                onOpen={() => props.onGo({ tab: 'runs', id: r.id })}
                meta={`${fmtDur((r.finishedAt ?? r.lastTs) - r.startedAt)} · ${fmtUsd(r.costUsd)}`}
              />
            ))}
          </ul>
        )}
      </Loading>
    </Panel>
  );
}
```

Replace `web/src/home/Home.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { AttentionItem, RunRow } from '../api';
import { Button } from '../components/arc/button/button';
import { usePoll, type Route } from '../hooks';
import { ScreenHeader } from '../ui/studio/ScreenHeader';
import { NeedsYou } from './NeedsYou';
import { Recent } from './Recent';
import { Running } from './Running';
import { StartRun } from './StartRun';
import './home.css';

export const LIVE_MS = 2000;
export const IDLE_MS = 10_000;

/** Home polls (no EventSource): runs and attention every 2 s while a run is live, every 10 s otherwise. */
export function Home(props: { onGo: (r: Route) => void }) {
  const [ms, setMs] = useState(IDLE_MS);
  const runs = usePoll<RunRow[]>('/api/runs', ms);
  const attention = usePoll<{ items: AttentionItem[] }>('/api/attention', ms);
  const anyLive = !!runs.data?.some((r) => r.live);
  useEffect(() => setMs(anyLive ? LIVE_MS : IDLE_MS), [anyLive]);
  const [refreshing, setRefreshing] = useState(false);
  const { refresh: refreshRuns } = runs;
  const { refresh: refreshAttention } = attention;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshRuns(), refreshAttention()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshRuns, refreshAttention]);
  const liveCount = runs.data?.filter((r) => r.live).length ?? 0;
  const needs = attention.data?.items.length ?? 0;

  return (
    <div className="home">
      <ScreenHeader
        meta={`${liveCount} running · ${needs} need${needs === 1 ? 's' : ''} you`}
        title="Home"
        summary="What needs you, what is running, and a place to start the next run."
        actions={
          <Button variant="secondary" size="sm" disabled={refreshing} onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />
      <div className="home-grid">
        <NeedsYou poll={attention} refreshing={refreshing} onGo={props.onGo} onChanged={() => void Promise.all([refreshAttention(), refreshRuns()])} />
        <StartRun onGo={props.onGo} onStarted={() => void refreshRuns()} />
        <Running poll={runs} refreshing={refreshing} onGo={props.onGo} />
        <Recent poll={runs} refreshing={refreshing} onGo={props.onGo} />
      </div>
    </div>
  );
}
```

Append to `web/src/home/home.css`:

```css
.run-now { font-size: 12px; color: var(--mut); }
.elapsed { font-family: var(--font-code); font-size: 11px; color: var(--mut); }
@media (min-width: 1200px) {
  .home-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(320px, 1fr); align-items: start; gap: 16px 20px; }
  .home-grid > .s-needs { grid-column: 1; grid-row: 1; }
  .home-grid > .s-start { grid-column: 1; grid-row: 2; }
  .home-grid > .s-running { grid-column: 1; grid-row: 3; }
  .home-grid > .s-recent { grid-column: 1; grid-row: 4; }
  .home-grid > .s-activity { grid-column: 2; grid-row: 1 / span 2; }
  .home-grid > .s-saved { grid-column: 2; grid-row: 3; }
  .home-grid > .s-crew { grid-column: 2; grid-row: 4; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project web web/src/home`
Expected: PASS. In "polls every 10 s …", the switch to 2 s restarts the poll loop (one immediate fetch inside the 10 s advance), so the next 4 s add exactly two fetches of each path.

- [ ] **Step 5: Commit**

```bash
git add web/src/home
git commit -m "feat(web): Home shows what needs you, running runs and recent results"
```

---

### Task 16: Home — Live activity, Saved requests, Crew

**Files:**
- Create: `web/src/home/ActivityFeed.tsx`, `web/src/home/SavedRequests.tsx`, `web/src/home/CrewStrip.tsx`
- Modify: `web/src/home/Home.tsx` (full rewrite), `web/src/home/home.css` (append), `web/src/home/Home.test.tsx` (layout test)
- Test: `web/src/home/ActivityFeed.test.tsx`, `web/src/home/SavedRequests.test.tsx`, `web/src/home/CrewStrip.test.tsx`

**Interfaces:**
- Consumes: `ActivityLine`, `ApiError`, `api`, `ago` (Task 10); `httpApi.tree(ws?)`, `httpApi.history(ws, request, limit)`, `HttpTree`, `HistoryRow`, `TreeCollection` (`web/src/http/client.ts`); `pickWorkspace`, `WorkspaceRow` (Task 14); `busyBots` (Task 15); `useCrew`; `Face`; `AsciiReveal` from `ascii-reveal`; `useReducedMotionPref` from `web/src/components/Loading.tsx`; `BACKOFF_AFTER`, `BACKOFF_MS`.
- Produces:
  - `useActivity(paused: boolean): { lines: ActivityLine[]; fresh: Set<string>; error?: string; loaded: boolean; refresh: () => Promise<void> }` (polls every 3 s while visible and not paused; resumes from the last cursor).
  - `ActivityFeed(props: { feed: ReturnType<typeof useActivity>; paused: boolean; onPause: (p: boolean) => void; refreshing: boolean })`.
  - `savedRows(tree: HttpTree, history: HistoryRow[]): SavedRow[]`; `SavedRequests(props: { onGo: (r: Route) => void; refreshKey: number })`.
  - `CrewStrip(props: { runs: RunRow[] | undefined })`.

- [ ] **Step 1: Write the failing tests**

`web/src/home/ActivityFeed.test.tsx`:

```tsx
import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type ActivityLine } from '../api';
import { routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { ActivityFeed, useActivity } from './ActivityFeed';

const L = (n: number, o: Partial<ActivityLine> = {}): ActivityLine => ({ id: `r1:${n}`, ts: Date.now() - 1000, runId: 'r1', who: 'Implement', text: `line ${n}`, kind: 'working', bot: 'coder', ...o });
let replies: Record<string, unknown> = {};
const paths = () => vi.mocked(api).mock.calls.map((c) => c[1]);
function Harness() {
  const [paused, setPaused] = useState(false);
  const feed = useActivity(paused);
  return <ActivityFeed feed={feed} paused={paused} onPause={setPaused} refreshing={false} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api).mockReset();
  replies = {};
  routeApi({ 'GET /api/activity': (_: unknown, path: string) => replies[path] ?? { lines: [], cursor: null } });
});

describe('Live activity', () => {
  it('shows lines newest first in a polite log and decodes only new arrivals', async () => {
    replies['/api/activity?limit=50'] = { lines: [L(2), L(1)], cursor: 'c1' };
    replies['/api/activity?since=c1'] = { lines: [L(3, { text: 'newer' })], cursor: 'c2' };
    renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    const log = screen.getByRole('log', { name: 'Live activity' });
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect([...log.querySelectorAll('.sl-sr')].map((n) => n.textContent)).toEqual(['line 2', 'line 1']);
    expect(log.querySelector('[data-ascii-reveal]')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect([...log.querySelectorAll('.sl-sr')].map((n) => n.textContent)).toEqual(['newer', 'line 2', 'line 1']);
    const decoding = log.querySelectorAll('[data-ascii-reveal]');
    expect(decoding).toHaveLength(1);
    expect(decoding[0]!.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it('decodes at most the newest five new lines', async () => {
    replies['/api/activity?limit=50'] = { lines: [], cursor: 'c1' };
    replies['/api/activity?since=c1'] = { lines: [7, 6, 5, 4, 3, 2, 1].map((n) => L(n)), cursor: 'c2' };
    renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole('log').querySelectorAll('[data-ascii-reveal]')).toHaveLength(5);
  });

  it('stops polling while paused and fetches what was missed on resume', async () => {
    replies['/api/activity?limit=50'] = { lines: [L(1)], cursor: 'c1' };
    renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    const before = paths().length;
    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(paths().length).toBe(before);
    replies['/api/activity?since=c1'] = { lines: [L(2, { text: 'missed' })], cursor: 'c2' };
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Resume' })));
    expect(paths().at(-1)).toBe('/api/activity?since=c1');
    expect(screen.getByText('missed', { selector: '.sl-sr' })).toBeTruthy();
  });

  it('stops polling while the browser tab is hidden', async () => {
    renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    const before = paths().length;
    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(paths().length).toBe(before);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    expect(paths().length).toBe(before + 1);
  });

  it('shows a load error inline with a retry, and an empty state', async () => {
    routeApi({ 'GET /api/activity': new Error('down') });
    renderApp(<Harness />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('alert').textContent).toContain('down');
    routeApi({ 'GET /api/activity': { lines: [], cursor: null } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(screen.getByText('No activity yet')).toBeTruthy();
  });
});
```

`web/src/home/SavedRequests.test.tsx`:

```tsx
import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, ApiError } from '../api';
import type { HistoryRow, HttpTree } from '../http/client';
import { calls, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { SavedRequests, savedRows } from './SavedRequests';

const tree: HttpTree = {
  root: { path: '', name: '', requests: [{ id: 'users/list', name: 'List users', method: 'GET', url: '{{base}}/users' }], collections: [{ path: 'admin', name: 'admin', collections: [], requests: [{ id: 'admin/create', name: 'Create user', method: 'POST', url: '{{base}}/users' }] }] },
  environments: [], activeEnv: null, workspace: 'api',
};
const hist = (id: number, request: string, status: number, ts: number) => ({ id, ts, request, status, ok: status < 400, method: 'GET', url: '', ms: 1, size: 1, workspace: 'api', source: 'ui', runId: null, data: {} }) as unknown as HistoryRow;
const WS = [{ id: 'api', name: 'API', path: '/p/api', isDefault: true, exists: true, repos: [] }, { id: 'web', name: 'Web', path: '/p/web', isDefault: false, exists: true, repos: [] }];
const t = Date.now();

beforeEach(() => {
  vi.mocked(api).mockReset();
  localStorage.clear();
  routeApi({ 'GET /api/workspaces': WS, 'GET /api/http/tree': tree, 'GET /api/http/history': [hist(2, 'users/list', 200, t - 60_000), hist(1, 'users/list', 500, t - 120_000)] });
});

describe('Saved requests', () => {
  it('pairs each request with its newest history row', () => {
    expect(savedRows(tree, [hist(1, 'users/list', 500, 1), hist(2, 'users/list', 200, 2)])).toEqual([
      { id: 'users/list', name: 'List users', method: 'GET', last: { status: 200, ts: 2, ok: true } },
      { id: 'admin/create', name: 'Create user', method: 'POST' },
    ]);
  });

  it('lists method, name, last status and time, or never sent; rows open the API tab', async () => {
    const onGo = vi.fn();
    renderApp(<SavedRequests onGo={onGo} refreshKey={0} />);
    expect(await screen.findByText('List users')).toBeTruthy();
    expect(screen.getByText('200 · 1m ago')).toBeTruthy();
    expect(screen.getByText('never sent')).toBeTruthy();
    expect(calls('GET', '/api/http/history?ws=api&limit=100')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
    expect(onGo).toHaveBeenCalledWith({ tab: 'api' });
  });

  it('reads the API tab’s workspace', async () => {
    localStorage.setItem('aorch.api.ws', 'web');
    renderApp(<SavedRequests onGo={() => {}} refreshKey={0} />);
    await screen.findByText('List users');
    expect(calls('GET', '/api/http/tree?ws=web')).toHaveLength(1);
  });

  it('reads the default workspace’s requests when the stored id is stale', async () => {
    localStorage.setItem('aorch.api.ws', 'removed');
    renderApp(<SavedRequests onGo={() => {}} refreshKey={0} />);
    await screen.findByText('List users');
    expect(calls('GET', '/api/http/tree?ws=api')).toHaveLength(1);
  });

  it('shows the no-workspace state on 409 and an inline error otherwise', async () => {
    routeApi({ 'GET /api/workspaces': [], 'GET /api/http/tree': new ApiError('no workspace', 409), 'GET /api/http/history': [] });
    const { unmount } = renderApp(<SavedRequests onGo={() => {}} refreshKey={0} />);
    expect(await screen.findByText('No workspace yet')).toBeTruthy();
    unmount();
    routeApi({ 'GET /api/workspaces': WS, 'GET /api/http/tree': new ApiError('disk full', 500), 'GET /api/http/history': [] });
    renderApp(<SavedRequests onGo={() => {}} refreshKey={0} />);
    expect((await screen.findByRole('alert')).textContent).toContain('disk full');
    routeApi({ 'GET /api/workspaces': WS, 'GET /api/http/tree': { ...tree, root: { ...tree.root, requests: [], collections: [] } }, 'GET /api/http/history': [] });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(screen.getByText('No saved requests')).toBeTruthy();
  });
});
```

`web/src/home/CrewStrip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeRow } from '../test/fixtures';
import { CrewStrip } from './CrewStrip';

describe('Crew strip', () => {
  it('breathes the bots of running steps in live runs and dims the rest', () => {
    const runs = [makeRow({ live: true, steps: [{ id: 'code', status: 'running', bot: 'coder' }, { id: 'rev', status: 'queued', bot: 'reviewer' }] }), makeRow({ id: 'r2', live: false, status: 'running', steps: [{ id: 'p', status: 'running', bot: 'planner' }] })];
    const { container } = render(<CrewStrip runs={runs} />);
    expect(screen.getByRole('region', { name: 'Crew' })).toBeTruthy();
    const bolt = screen.getByRole('img', { name: 'Bolt, busy' });
    expect(bolt.getAttribute('data-mood')).toBe('working');
    expect(bolt.closest('li')!.className).not.toContain('idle');
    expect(screen.getByRole('img', { name: 'Scout' }).closest('li')!.className).toContain('idle');
    expect(container.querySelectorAll('li.crew-face:not(.idle)')).toHaveLength(1);
    expect(screen.getByText('Lens')).toBeTruthy();
  });
});
```

Update `web/src/home/Home.test.tsx`'s first test to expect all seven regions in order:

```tsx
    expect(names).toEqual(['Needs you', 'Start a run', 'Running', 'Live activity', 'Recent', 'Saved requests', 'Crew']);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project web web/src/home`
Expected: FAIL — `ActivityFeed`, `SavedRequests`, `CrewStrip` missing.

- [ ] **Step 3: Write the implementation**

`web/src/home/ActivityFeed.tsx`:

```tsx
import { AsciiReveal } from 'ascii-reveal';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ago, api, type ActivityLine } from '../api';
import { Button } from '../components/arc/button/button';
import { Loading, useReducedMotionPref } from '../components/Loading';
import { Face } from '../Face';
import { BACKOFF_AFTER, BACKOFF_MS } from '../hooks';
import { cn } from '../ui/cn';
import { EmptyState } from '../ui/studio/EmptyState';
import { InlineError } from '../ui/studio/InlineError';
import { Panel } from '../ui/studio/Panel';

export const ACTIVITY_POLL_MS = 3000;
export const ACTIVITY_KEEP = 50;
const DECODE_MAX = 5;

function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/** The activity feed: newest lines first, polled every 3 s while the tab is visible and not paused, resumed from the last cursor. */
export function useActivity(paused: boolean) {
  const [lines, setLines] = useState<ActivityLine[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const cursor = useRef<string | null>(null);
  const started = useRef(false);
  const fails = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const path = cursor.current ? `/api/activity?since=${encodeURIComponent(cursor.current)}` : `/api/activity?limit=${ACTIVITY_KEEP}`;
      const r = await api<{ lines: ActivityLine[]; cursor: string | null }>('GET', path);
      const first = !started.current;
      started.current = true;
      cursor.current = r.cursor ?? cursor.current;
      fails.current = 0;
      setLines((cur) => {
        const seen = new Set(cur.map((l) => l.id));
        return [...r.lines.filter((l) => !seen.has(l.id)), ...cur].slice(0, ACTIVITY_KEEP);
      });
      setFresh(first ? new Set() : new Set(r.lines.slice(0, DECODE_MAX).map((l) => l.id)));
      setError(undefined);
    } catch (e) {
      fails.current++;
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  const visible = useVisible();
  useEffect(() => {
    if (paused || !visible) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(loop, fails.current >= BACKOFF_AFTER ? BACKOFF_MS : ACTIVITY_POLL_MS);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [paused, visible, refresh]);

  return { lines, fresh, error, loaded, refresh };
}

const DOT: Record<ActivityLine['kind'], string> = { working: 't-live', needs: 't-needs', done: 't-done', failed: 't-failed', info: '' };

/** Lines decode in with ascii-reveal (at most the newest five); screen readers get only the final text. */
export function ActivityFeed(props: { feed: ReturnType<typeof useActivity>; paused: boolean; onPause: (p: boolean) => void; refreshing: boolean }) {
  const { feed } = props;
  const reduced = useReducedMotionPref();
  return (
    <Panel
      title="Live activity"
      className="s-activity"
      action={
        <Button variant="ghost" size="sm" aria-pressed={props.paused} onClick={() => props.onPause(!props.paused)}>
          {props.paused ? 'Resume' : 'Pause'}
        </Button>
      }
    >
      <Loading loading={!feed.loaded || props.refreshing} lines={6} label="Loading live activity">
        {feed.error ? <InlineError message={feed.error} onRetry={() => void feed.refresh()} /> : null}
        {!feed.lines.length && !feed.error ? (
          <EmptyState title="No activity yet" description="Steps starting, finishing and asking show up here as runs work." />
        ) : feed.lines.length ? (
          <ol className="act-list" role="log" aria-live="polite" aria-label="Live activity">
            {feed.lines.map((l) => {
              const decode = feed.fresh.has(l.id) && !reduced;
              return (
                <li key={l.id} className={cn('act-line', { fresh: feed.fresh.has(l.id) })}>
                  <span className="act-face" aria-hidden="true">
                    {l.bot ? <Face id={l.bot} size={20} /> : <span className={cn('sl-dot act-dot', DOT[l.kind])} />}
                  </span>
                  <span className="act-text">
                    <span className="sl-sr">{l.text}</span>
                    <span aria-hidden="true">
                      {decode ? (
                        <AsciiReveal as="span" preset="decode" duration="fast">
                          {l.text}
                        </AsciiReveal>
                      ) : (
                        l.text
                      )}
                    </span>
                  </span>
                  <time className="sl-age" dateTime={new Date(l.ts).toISOString()} aria-hidden="true">
                    {ago(l.ts)}
                  </time>
                </li>
              );
            })}
          </ol>
        ) : null}
      </Loading>
    </Panel>
  );
}
```

`web/src/home/SavedRequests.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ago, ApiError } from '../api';
import { Button } from '../components/arc/button/button';
import { Loading } from '../components/Loading';
import { usePoll, type Route } from '../hooks';
import { httpApi, type HistoryRow, type HttpTree, type TreeCollection } from '../http/client';
import { EmptyState } from '../ui/studio/EmptyState';
import { InlineError } from '../ui/studio/InlineError';
import { ListRow } from '../ui/studio/ListRow';
import { Panel } from '../ui/studio/Panel';
import { StatusChip } from '../ui/studio/StatusChip';
import { pickWorkspace, type WorkspaceRow } from './workspaces';

const SHOWN = 8;
export interface SavedRow { id: string; name: string; method: string; last?: { status: number; ts: number; ok: boolean | null } }

/** Every saved request in tree order with its newest history row. */
export function savedRows(tree: HttpTree, history: HistoryRow[]): SavedRow[] {
  const newest = new Map<string, HistoryRow>();
  for (const h of history) if (h.request && (newest.get(h.request)?.ts ?? -1) < h.ts) newest.set(h.request, h);
  const out: SavedRow[] = [];
  const walk = (c: TreeCollection) => {
    for (const r of c.requests) {
      const h = newest.get(r.id);
      out.push({ id: r.id, name: r.name, method: r.method, ...(h ? { last: { status: h.status, ts: h.ts, ok: h.ok } } : {}) });
    }
    c.collections.forEach(walk);
  };
  walk(tree.root);
  return out;
}

export function SavedRequests(props: { onGo: (r: Route) => void; refreshKey: number }) {
  const workspaces = usePoll<WorkspaceRow[]>('/api/workspaces', 30_000);
  const known = workspaces.data !== undefined || !!workspaces.error;
  const ws = pickWorkspace(workspaces.data ?? [])?.id;
  const [state, setState] = useState<{ rows?: SavedRow[]; error?: string; none?: boolean }>({});
  const load = useCallback(async () => {
    try {
      const [tree, history] = await Promise.all([httpApi.tree(ws), httpApi.history(ws, undefined, 100)]);
      setState({ rows: savedRows(tree, history) });
    } catch (e) {
      setState(e instanceof ApiError && e.status === 409 ? { none: true } : { error: (e as Error).message });
    }
  }, [ws]);
  useEffect(() => {
    if (known) void load();
  }, [known, load, props.refreshKey]);
  const openApi = () => props.onGo({ tab: 'api' });
  const rows = state.rows ?? [];

  return (
    <Panel title="Saved requests" count={state.rows ? rows.length : undefined} className="s-saved" action={<Button variant="ghost" size="sm" onClick={openApi}>Open API</Button>}>
      <Loading loading={!state.rows && !state.error && !state.none} lines={4} label="Loading saved requests">
        {state.none ? (
          <EmptyState title="No workspace yet" description="Saved requests live in a workspace: run aorch workspace init in your project folder." />
        ) : state.error ? (
          <InlineError message={state.error} onRetry={() => void load()} />
        ) : !rows.length ? (
          <EmptyState title="No saved requests" description="Requests you save in the API tab show up here with their last result." action={<Button variant="secondary" size="sm" onClick={openApi}>Open API</Button>} />
        ) : (
          <ul className="sl-list">
            {rows.slice(0, SHOWN).map((r) => (
              <ListRow
                key={r.id}
                lead={<span className="saved-method">{r.method}</span>}
                title={r.name}
                onOpen={openApi}
                meta={r.last ? `${r.last.status} · ${ago(r.last.ts)}` : 'never sent'}
                actions={r.last ? <StatusChip tone={r.last.ok === false || r.last.status >= 400 ? 'failed' : 'done'} label={r.last.ok === false || r.last.status >= 400 ? 'failed' : 'ok'} /> : null}
              />
            ))}
          </ul>
        )}
        {rows.length > SHOWN ? <p className="sl-meta">{rows.length - SHOWN} more in the API tab</p> : null}
      </Loading>
    </Panel>
  );
}
```

`web/src/home/CrewStrip.tsx`:

```tsx
import type { RunRow } from '../api';
import { useCrew } from '../crewStore';
import { Face } from '../Face';
import { cn } from '../ui/cn';
import { Panel } from '../ui/studio/Panel';
import { busyBots } from './runText';

const MAX = 24;

/** The roster's faces: bots of running steps in live runs breathe, the rest are dimmed. Imported bots show only while busy. */
export function CrewStrip(props: { runs: RunRow[] | undefined }) {
  const { crew } = useCrew();
  const busy = busyBots(props.runs ?? []);
  const ids = Object.keys(crew).filter((id) => !crew[id]!.source || busy.has(id));
  return (
    <Panel title="Crew" count={ids.length} className="s-crew">
      <ul className="crew-strip">
        {ids.slice(0, MAX).map((id) => {
          const on = busy.has(id);
          const name = crew[id]!.name;
          return (
            <li key={id} className={cn('crew-face', { idle: !on })}>
              {on ? <Face id={id} size={36} mood="working" animate="always" label={`${name}, busy`} /> : <Face id={id} size={36} label={name} />}
              <span className="crew-name" aria-hidden="true">
                {name}
              </span>
            </li>
          );
        })}
      </ul>
      {ids.length > MAX ? <p className="sl-meta">{ids.length - MAX} more in Crew</p> : null}
    </Panel>
  );
}
```

The busy face is labelled "Bolt, busy" (the label carries the state for screen readers; the visible name beside it is `aria-hidden` so it is not read twice).

Replace `web/src/home/Home.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { AttentionItem, RunRow } from '../api';
import { Button } from '../components/arc/button/button';
import { usePoll, type Route } from '../hooks';
import { ScreenHeader } from '../ui/studio/ScreenHeader';
import { ActivityFeed, useActivity } from './ActivityFeed';
import { CrewStrip } from './CrewStrip';
import { NeedsYou } from './NeedsYou';
import { Recent } from './Recent';
import { Running } from './Running';
import { SavedRequests } from './SavedRequests';
import { StartRun } from './StartRun';
import './home.css';

export const LIVE_MS = 2000;
export const IDLE_MS = 10_000;

/**
 * Home polls (no EventSource): runs and attention every 2 s while a run is live and every 10 s otherwise, the activity
 * feed every 3 s while visible and not paused. Sections are in the one-column order; CSS places them in two columns at 1200 px.
 */
export function Home(props: { onGo: (r: Route) => void }) {
  const [ms, setMs] = useState(IDLE_MS);
  const runs = usePoll<RunRow[]>('/api/runs', ms);
  const attention = usePoll<{ items: AttentionItem[] }>('/api/attention', ms);
  const anyLive = !!runs.data?.some((r) => r.live);
  useEffect(() => setMs(anyLive ? LIVE_MS : IDLE_MS), [anyLive]);
  const [paused, setPaused] = useState(false);
  const feed = useActivity(paused);
  const [savedKey, setSavedKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const { refresh: refreshRuns } = runs;
  const { refresh: refreshAttention } = attention;
  const { refresh: refreshFeed } = feed;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setSavedKey((k) => k + 1);
    try {
      await Promise.all([refreshRuns(), refreshAttention(), refreshFeed()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshRuns, refreshAttention, refreshFeed]);
  const liveCount = runs.data?.filter((r) => r.live).length ?? 0;
  const needs = attention.data?.items.length ?? 0;

  return (
    <div className="home">
      <ScreenHeader
        meta={`${liveCount} running · ${needs} need${needs === 1 ? 's' : ''} you`}
        title="Home"
        summary="What needs you, what is running, and a place to start the next run."
        actions={
          <Button variant="secondary" size="sm" disabled={refreshing} onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />
      <div className="home-grid">
        <NeedsYou poll={attention} refreshing={refreshing} onGo={props.onGo} onChanged={() => void Promise.all([refreshAttention(), refreshRuns()])} />
        <StartRun onGo={props.onGo} onStarted={() => void refreshRuns()} />
        <Running poll={runs} refreshing={refreshing} onGo={props.onGo} />
        <ActivityFeed feed={feed} paused={paused} onPause={setPaused} refreshing={refreshing} />
        <Recent poll={runs} refreshing={refreshing} onGo={props.onGo} />
        <SavedRequests onGo={props.onGo} refreshKey={savedKey} />
        <CrewStrip runs={runs.data} />
      </div>
    </div>
  );
}
```

Append to `web/src/home/home.css`:

```css
.act-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; max-height: 420px; overflow: auto; }
.act-line { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px 2px; border-top: 1px solid var(--line); }
.act-line:first-child { border-top-color: transparent; }
.act-line.fresh { animation: act-in var(--t-slow) var(--ease); }
@keyframes act-in { from { opacity: 0; transform: translateY(-4px); } }
.act-face { display: grid; place-items: center; }
.act-dot { width: 8px; height: 8px; background: var(--mut); }
.act-dot.t-live { background: var(--acc); } .act-dot.t-needs { background: var(--warn); } .act-dot.t-done { background: var(--ok); } .act-dot.t-failed { background: var(--bad); }
.act-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.saved-method { display: inline-block; min-width: 44px; font-family: var(--font-code); font-size: 11px; color: var(--mut); }
.crew-strip { display: flex; flex-wrap: wrap; gap: 12px; margin: 0; padding: 0; list-style: none; }
.crew-face { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 56px; }
.crew-face.idle .face { opacity: .45; }
.crew-name { max-width: 56px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--mut); }
:root:not([data-theme="dark"]) .crew-face .face { border-radius: 30%; box-shadow: 0 0 0 1px var(--line2); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project web web/src/home`
Expected: PASS.

- [ ] **Step 5: Full suites, typecheck, build**

Run: `npx vitest run --project web && npx vitest run --project node && npm run typecheck && npm run build`
Expected: all green except the three known `/private/var` triggers failures (and flaky-under-load tests pass alone).

- [ ] **Step 6: Chrome check (phase 3 done)**

`npm run build && npm run dev`, then in Chrome at 1440 × 900, 1024 × 768 and 390 × 844 in both themes: Home's seven sections in the right order and columns; start a team run (Meta+Enter) and see it under Running with its step track and breathing face; the activity feed decodes new lines in; Pause/Resume; a stale `aorch.api.ws` (set it in DevTools) falls back to the default workspace; no violet anywhere; reduced motion (DevTools rendering panel) stops every loop.

- [ ] **Step 7: Commit**

```bash
git add web/src/home
git commit -m "feat(web): Home live activity, saved requests and crew"
```

---

## Phase 4 — Runs

### Task 17: Run list

**Files:**
- Create: `web/src/runs/ProgressRing.tsx`, `web/src/runs/RunList.tsx`, `web/src/runs/runs.css`
- Modify: `web/src/Runs.tsx` (lift the list poll, render `RunList`)
- Modify: `web/src/styles.css` (delete `.runs`, `.run-list`, `.run-item`, `.run-item.active`, `.run-main`, `.run-main small, .run-side small`, `.run-side`, and in `@media (max-width: 1000px)` the `.runs` and `.run-list` lines)
- Test: `web/src/runs/RunList.test.tsx`

**Interfaces:**
- Consumes: `RunRow` with `steps` (Task 10); `Poll<T>`; `StatusChip`, `toneFor`, `EmptyState`, `InlineError`; `Loading`; Arc `SegmentedControl`, `Switch`; `ago`, `fmtUsd`.
- Produces:
  - `ProgressRing(props: { done: number; total: number; live?: boolean })` (`data-progress="done/total"`).
  - `type RunFilter = 'all' | 'live' | 'done'`; `filterRuns(rows: RunRow[], f: RunFilter): RunRow[]`.
  - `RunList(props: { poll: Poll<RunRow[]>; probes: boolean; onProbes: (on: boolean) => void; selected?: string; onSelect: (id: string) => void })`.

- [ ] **Step 1: Write the failing test** — create `web/src/runs/RunList.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunRow } from '../api';
import type { Poll } from '../hooks';
import { makeRow } from '../test/fixtures';
import { filterRuns, RunList } from './RunList';

const poll = (data?: RunRow[], error?: string): Poll<RunRow[]> => ({ data, error, fails: 0, refresh: vi.fn(async () => {}) });
const rows = [
  makeRow({ id: 'r1', pipeline: 'ship', live: true, steps: [{ id: 'a', status: 'done', bot: 'coder' }, { id: 'b', status: 'running', bot: 'coder' }, { id: 'c', status: 'queued', bot: 'tester' }] }),
  makeRow({ id: 'r2', task: 'Second task', kind: 'team', status: 'running', live: true, pending: 2 }),
  makeRow({ id: 'r3', status: 'done', live: false, task: 'Finished one' }),
  makeRow({ id: 'r4', status: 'error', live: false, probe: true, task: 'Probe replay' }),
];
const setup = (o: { data?: RunRow[]; selected?: string; probes?: boolean } = {}) => {
  const p = { onSelect: vi.fn(), onProbes: vi.fn() };
  render(<RunList poll={poll(o.data ?? rows)} probes={o.probes ?? false} selected={o.selected} {...p} />);
  return p;
};

describe('RunList', () => {
  it('filters All / Live / Done', () => {
    expect(filterRuns(rows, 'live').map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(filterRuns(rows, 'done').map((r) => r.id)).toEqual(['r3', 'r4']);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('Finished one')).toBeTruthy();
    expect(screen.queryByText('Second task')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(screen.getByText('Second task')).toBeTruthy();
  });

  it('shows a progress ring, status, title, badges, task, cost and age per row', () => {
    const { container } = render(<RunList poll={poll(rows)} probes={false} onProbes={() => {}} onSelect={() => {}} />);
    expect(container.querySelector('[data-progress="1/3"]')).toBeTruthy();
    expect(screen.getByText('ship')).toBeTruthy();
    expect(screen.getByText('? 2')).toBeTruthy();
    expect(screen.getAllByText('Team').length).toBeGreaterThan(0);
    expect(screen.getByText('probe')).toBeTruthy();
    expect(screen.getAllByText(/\$0\.12 · /).length).toBe(4);
  });

  it('selects a run and draws the moving border only on a selected live run', () => {
    const { container, rerender } = render(<RunList poll={poll(rows)} probes={false} onProbes={() => {}} selected="r1" onSelect={() => {}} />);
    expect(container.querySelector('.run-row[aria-current="true"] .run-live-border')).toBeTruthy();
    rerender(<RunList poll={poll(rows)} probes={false} onProbes={() => {}} selected="r3" onSelect={() => {}} />);
    expect(container.querySelector('.run-live-border')).toBeNull();
    const p = setup({ data: rows });
    fireEvent.click(screen.getAllByText('Second task').at(-1)!);
    expect(p.onSelect).toHaveBeenCalledWith('r2');
  });

  it('toggles probe replays', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('switch', { name: 'show probe replays' }));
    expect(p.onProbes).toHaveBeenCalledWith(true);
  });

  it('says when there are no runs at all, or none for the filter', () => {
    setup({ data: [] });
    expect(screen.getByText('No runs yet')).toBeTruthy();
  });

  it('says so when a filter matches nothing', () => {
    setup({ data: [rows[2]!] });
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(screen.getByText('No live runs.')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project web web/src/runs/RunList.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`web/src/runs/ProgressRing.tsx`:

```tsx
import { cn } from '../ui/cn';

const R = 8;
const C = 2 * Math.PI * R;

/** Steps done out of all steps, as a ring (decorative: the row's status chip carries the text). */
export function ProgressRing(props: { done: number; total: number; live?: boolean }) {
  const frac = props.total ? props.done / props.total : 0;
  return (
    <svg className={cn('ring', { live: !!props.live })} width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" data-progress={`${props.done}/${props.total}`}>
      <circle className="ring-track" cx="10" cy="10" r={R} />
      <circle className="ring-fill" cx="10" cy="10" r={R} strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90 10 10)" />
    </svg>
  );
}
```

`web/src/runs/RunList.tsx`:

```tsx
import { useState } from 'react';
import { ago, fmtUsd, type RunRow } from '../api';
import SegmentedControl from '../components/arc/segmented-control/segmented-control';
import { Switch } from '../components/arc/switch/switch';
import { Loading } from '../components/Loading';
import type { Poll } from '../hooks';
import { cn } from '../ui/cn';
import { EmptyState } from '../ui/studio/EmptyState';
import { InlineError } from '../ui/studio/InlineError';
import { StatusChip, toneFor } from '../ui/studio/StatusChip';
import { ProgressRing } from './ProgressRing';

export type RunFilter = 'all' | 'live' | 'done';
const FINISHED = new Set(['done', 'error', 'stopped']);
export const filterRuns = (rows: RunRow[], f: RunFilter): RunRow[] => (f === 'live' ? rows.filter((r) => r.live) : f === 'done' ? rows.filter((r) => FINISHED.has(r.status)) : rows);

function RunListRow({ r, selected, onSelect }: { r: RunRow; selected: boolean; onSelect: (id: string) => void }) {
  const done = r.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const active = r.status === 'running' || r.status === 'paused';
  const waiting = active && (r.pending > 0 || r.planReady);
  return (
    <li>
      <button type="button" className={cn('run-row', { selected })} aria-current={selected ? 'true' : undefined} onClick={() => onSelect(r.id)}>
        {selected && r.live ? (
          <svg className="run-live-border" aria-hidden="true">
            <rect x="0.5" y="0.5" rx="9.5" />
          </svg>
        ) : null}
        <ProgressRing done={done} total={r.steps.length} live={r.live && r.status === 'running'} />
        <span className="run-row-main">
          <span className="run-row-title">
            <b>{r.kind === 'team' ? 'Team run' : r.pipeline}</b>
            {r.kind === 'team' ? <StatusChip tone="neutral" label="Team" /> : null}
            {r.probe ? (
              <span title="Evolve probe replay">
                <StatusChip tone="neutral" label="probe" />
              </span>
            ) : null}
            {waiting ? (
              <span title={r.planReady ? 'A plan is waiting for your approval' : 'A question is waiting for you'}>
                <StatusChip tone="needs" label={r.planReady ? 'plan' : `? ${r.pending}`} />
              </span>
            ) : null}
          </span>
          <span className="run-row-task">{r.task.split('\n')[0]!.slice(0, 60)}</span>
        </span>
        <span className="run-row-side">
          <StatusChip tone={toneFor(r.status)} label={r.status} pulse={r.live && r.status === 'running'} />
          <span className="sl-meta">
            {fmtUsd(r.costUsd)} · {ago(r.startedAt)}
          </span>
        </span>
      </button>
    </li>
  );
}

export function RunList(props: { poll: Poll<RunRow[]>; probes: boolean; onProbes: (on: boolean) => void; selected?: string; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<RunFilter>('all');
  const { data, error, refresh } = props.poll;
  const rows = filterRuns(data ?? [], filter);
  return (
    <aside className="run-list" aria-label="Runs">
      <div className="run-list-head">
        <h2>Runs</h2>
        <SegmentedControl label="Filter runs" options={[{ value: 'all', label: 'All' }, { value: 'live', label: 'Live' }, { value: 'done', label: 'Done' }]} value={filter} onValueChange={(v) => setFilter(v as RunFilter)} />
      </div>
      <div className="run-list-probes" title="Evolve probe replays are experiments and are hidden by default; aorch probes --clean deletes finished ones">
        <Switch label="show probe replays" checked={props.probes} onCheckedChange={(c) => props.onProbes(c === true)} />
      </div>
      <Loading loading={data === undefined && !error} lines={6} label="Loading runs">
        {error && !data ? (
          <InlineError message={error} onRetry={() => void refresh()} />
        ) : !rows.length ? (
          data?.length ? (
            <p className="sl-meta run-list-none">No {filter === 'live' ? 'live' : 'finished'} runs.</p>
          ) : (
            <EmptyState title="No runs yet" description="Start a run from Home, or build a workflow and press Run." />
          )
        ) : (
          <ul className="sl-list run-rows">
            {rows.map((r) => (
              <RunListRow key={r.id} r={r} selected={props.selected === r.id} onSelect={props.onSelect} />
            ))}
          </ul>
        )}
      </Loading>
    </aside>
  );
}
```

`web/src/runs/runs.css`:

```css
.runs { display: grid; grid-template-columns: 300px minmax(0, 1fr); height: 100%; min-height: 0; }
.run-list { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow: auto; padding: 14px 10px; background: var(--s1); border-right: 1px solid var(--line); }
.run-list-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 0 4px; }
.run-list-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--ink); }
.run-list-probes { padding: 0 4px; font-size: 12px; color: var(--mut); }
.run-list-none { padding: 8px 4px; }
.run-rows { display: flex; flex-direction: column; gap: 2px; }
.run-row { position: relative; display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 10px; align-items: center; width: 100%; padding: 8px; border: 1px solid transparent; border-radius: 10px; background: none; color: var(--ink); font: inherit; text-align: left; cursor: pointer; transition: background-color var(--t-fast) var(--ease); }
.run-row:hover { background: var(--s2); }
.run-row.selected { background: var(--s2); border-color: var(--line2); }
.run-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.run-row-title { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
.run-row-task { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--mut); }
.run-row-side { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
/* a live selected run's border marches (static under reduced motion: the root rule stops the loop) */
.run-live-border { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.run-live-border rect { width: calc(100% - 1px); height: calc(100% - 1px); fill: none; stroke: var(--acc); stroke-width: 1; stroke-dasharray: 6 4; animation: run-march 1s linear infinite; }
@keyframes run-march { to { stroke-dashoffset: -10; } }
.ring-track { fill: none; stroke: var(--s3); stroke-width: 2.5; }
.ring-fill { fill: none; stroke: var(--ok); stroke-width: 2.5; stroke-linecap: round; }
.ring.live .ring-fill { stroke: var(--acc); }
```

In `web/src/Runs.tsx`:
- Add `import { RunList } from './runs/RunList';` and `import './runs/runs.css';`; remove the now unused `Switch`, `cn`, `ago` imports.
- Replace the whole `<aside className="run-list"> … </aside>` block with `<RunList poll={list} probes={probes} onProbes={setProbes} selected={props.selected} onSelect={props.onSelect} />`.

Delete the old list rules from `web/src/styles.css` listed under **Files**.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project web web/src/runs web/src/Runs.test.tsx web/src/rules.test.ts`
Expected: PASS (the existing Runs tests keep passing: the `? 1` chip, "Second task" click, inline error with Retry).

- [ ] **Step 5: Commit**

```bash
git add web/src/runs web/src/Runs.tsx web/src/styles.css
git commit -m "feat(web): Studio run list with filters, progress rings and a live border"
```

---

### Task 18: Run page — header, banners, centre, step links

**Files:**
- Create: `web/src/runs/RunHeader.tsx`, `web/src/runs/RunBanners.tsx`, `web/src/runs/RunCentre.tsx`, `web/src/runs/Inspector.tsx` (the current tabs moved as they are)
- Modify: `web/src/Runs.tsx` (full rewrite), `web/src/App.tsx` (Runs props), `web/src/Canvas.tsx` (edge classes, status chip), `web/src/styles.css` (edge styles; delete `.run-detail`, `.run-head`, `.run-head h3`, `.run-graph`, `.run-graph .canvas`), `web/src/runs/runs.css` (append)
- Test: `web/src/Runs.test.tsx` (fixture + new cases), `web/src/Canvas.test.tsx` (two cases), `web/src/App.test.tsx` (one case)

**Interfaces:**
- Consumes: `useRunStream`, `TeamPanel` (`send: (path: 'answers' | 'plan' | 'mode' | 'swap', body: unknown) => Promise<boolean>`), `Canvas` (`onSelect?: (id?: string) => void`), `StatusChip`, `toneFor`, `StepTrack`, `EmptyState`, `Loading`.
- Produces:
  - `type RunAct = (path: string, body?: unknown) => Promise<boolean>` (exported from `web/src/Runs.tsx`).
  - `interface RunsProps { selected?: string; node?: string; onSelect: (id?: string) => void; onSelectNode?: (node?: string) => void }`.
  - `RunHeader(props: { run: RunView; onAct: RunAct; extra?: ReactNode })`, `RunBanners(props: { run: RunView; streamError?: string; onAct: RunAct })`, `RunCentre(props: { run: RunView; selected?: string; onSelect: (id?: string) => void; onAct: RunAct })`, `Inspector(props: { run: RunView; events: StoredEvent[]; selected?: string; onAct: RunAct })`.
  - App passes `node={screen.node}` and maps `onSelectNode` to `#/runs/<id>/<node>`.

- [ ] **Step 1: Write the failing tests**

In `web/src/Runs.test.tsx`, replace the `awaitingRun` fixture (the approval banner now shows only for approval steps) and the `'POST /api/runs/r1/approve'` expectation:

```tsx
const base = makeRun();
const awaitingRun = makeRun({
  pipeline: { ...base.pipeline, nodes: [...base.pipeline.nodes, { id: 'ship', kind: 'approval', title: 'Ship it', x: 780, y: 0 }], edges: [...base.pipeline.edges, { from: 'gate', to: 'ship' }] },
  nodes: { ...base.nodes, gate: { status: 'done', attempts: 1, costUsd: 0, loops: 0 }, ship: { status: 'awaiting', attempts: 0, costUsd: 0, loops: 0 } },
});
```

and in `'approves an awaiting step and shows the returned state'` change the expected body to `{ node: 'ship', approved: true }`. Then append these cases inside `describe('Runs', …)`:

```tsx
  it('shows approval banners only for approval steps', async () => {
    const gateWaits = makeRun({ nodes: { ...makeRun().nodes, gate: { status: 'awaiting', attempts: 0, costUsd: 0, loops: 0 } } });
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', gateWaits));
    await screen.findByRole('heading', { name: /plan-code-review/ });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('puts the status, an interrupted chip, task, cost of budget and branch in the header', async () => {
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', makeRun({ live: false, pipeline: { ...makeRun().pipeline, settings: { ...makeRun().pipeline.settings, maxCostUsd: 5 } } })));
    await screen.findByRole('heading', { name: /plan-code-review/ });
    expect(screen.getByText('interrupted')).toBeTruthy();
    expect(screen.getByText(/\$0\.12 of \$5\.00 · aorch\/r1/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('draws a step track above the graph', async () => {
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
    expect(await screen.findByRole('img', { name: '1 of 3 steps done, 1 working' })).toBeTruthy();
  });

  it('replaces the graph with the Team panel before the plan is approved', async () => {
    const team = makeRun({ kind: 'team', planning: true, pipeline: { ...makeRun().pipeline, name: 'team', nodes: [], edges: [] }, nodes: {} });
    const { container } = renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', team));
    expect(await screen.findByText('Maestro is planning…')).toBeTruthy();
    expect(container.querySelector('.run-graph')).toBeNull();
    expect(screen.getByRole('group', { name: 'Team mode' })).toBeTruthy();
  });

  it('selects the step named in the route and reports clicks on steps', async () => {
    const onSelectNode = vi.fn();
    const { container } = renderApp(<Runs selected="r1" node="plan" onSelect={() => {}} onSelectNode={onSelectNode} />);
    act(() => FakeEventSource.all[0]!.emit('state', makeRun({ status: 'done', live: false })));
    expect(await screen.findByLabelText('Why (optional)')).toBeTruthy();
    fireEvent.pointerDown(container.querySelector('[data-id="code"] .node-body')!, { pointerId: 1 });
    expect(onSelectNode).toHaveBeenLastCalledWith('code');
  });
```

Append to `web/src/App.test.tsx` inside `describe('App shell', …)`:

```tsx
  it('passes the step named in the route to Runs', () => {
    location.hash = '#/runs/r5/code';
    render(<App />);
    expect(screen.getByText(/runs screen r5 code/)).toBeTruthy();
  });
```

Append to `web/src/Canvas.test.tsx` inside `describe('Canvas', …)`:

```tsx
  it('marks run edges: done solid, working animated, next dashed', () => {
    const st = (s: string) => ({ status: s, attempts: 1, costUsd: 0, loops: 0 }) as (typeof run.nodes)[string];
    const { container, rerender } = render(<Canvas nodes={nodes} edges={edges} statuses={{ plan: st('done'), code: st('done'), gate: st('running') }} />);
    const edge = (from: string, to: string) => container.querySelector(`[data-edge="${from}→${to}"] + path.edge`)!;
    expect(edge('plan', 'code').classList.contains('done')).toBe(true);
    expect(edge('code', 'gate').classList.contains('flow')).toBe(true);
    rerender(<Canvas nodes={nodes} edges={edges} statuses={{ plan: st('done'), code: st('queued'), gate: st('queued') }} />);
    expect(edge('plan', 'code').classList.contains('next')).toBe(true);
    expect(edge('code', 'gate').getAttribute('class')).toBe('edge');
  });

  it('shows a step status chip on run cards only', () => {
    const { container, rerender } = render(<Canvas nodes={nodes} edges={edges} statuses={run.nodes} />);
    expect(container.querySelector('[data-id="code"] .sl-chip.t-live')!.textContent).toBe('running');
    rerender(<Canvas nodes={nodes} edges={edges} />);
    expect(container.querySelector('.sl-chip')).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project web web/src/Runs.test.tsx web/src/Canvas.test.tsx`
Expected: FAIL — no step track, no edge classes, no `node` prop, approval banner shown for the gate.

- [ ] **Step 3: Canvas edge classes and status chip** — in `web/src/Canvas.tsx`:
- Add `import { StatusChip, toneFor } from './ui/studio/StatusChip';`.
- Replace the edge class computation with:

```tsx
            const st = props.statuses?.[e.from]?.status;
            const to = props.statuses?.[e.to]?.status;
            const edgeClass = cn('edge', {
              sel: selEdge === id,
              done: st === 'done' && !!to && to !== 'queued' && to !== 'running',
              flow: st === 'done' && to === 'running',
              next: st === 'done' && to === 'queued',
            });
```

and use `className={edgeClass}` on the visible path.
- Replace `<span className="status-pill">{st.status}</span>` with `<StatusChip tone={toneFor(st.status)} label={st.status} pulse={st.status === 'running'} />`.

Add to `web/src/styles.css` after `.edge.flow`:

```css
.edge.done { stroke: var(--ok); }
.edge.next { stroke-dasharray: 4 4; }
```

- [ ] **Step 4: Write the run page parts**

`web/src/runs/RunHeader.tsx`:

```tsx
import type { ReactNode } from 'react';
import { fmtUsd, type RunView } from '../api';
import { Button } from '../components/arc/button/button';
import type { RunAct } from '../Runs';
import { StatusChip, toneFor } from '../ui/studio/StatusChip';

export function RunHeader({ run: r, onAct, extra }: { run: RunView; onAct: RunAct; extra?: ReactNode }) {
  const interrupted = r.status === 'running' && !r.live;
  const cap = r.pipeline.settings.maxCostUsd;
  return (
    <header className="run-head">
      <div className="run-head-main">
        <div className="run-head-title">
          <h2>{r.kind === 'team' ? 'Team run' : r.pipeline.name}</h2>
          <StatusChip tone={toneFor(r.status)} label={r.status} pulse={r.live && r.status === 'running'} />
          {r.kind === 'team' ? <StatusChip tone="neutral" label="Team" /> : null}
          {interrupted ? (
            <span title="No process is driving this run. Resume it.">
              <StatusChip tone="needs" label="interrupted" />
            </span>
          ) : null}
        </div>
        <p className="run-head-task">{r.task.split('\n')[0]!.slice(0, 120)}</p>
        <p className="sl-meta">
          {fmtUsd(r.costUsd)}
          {cap ? ` of ${fmtUsd(cap)}` : ''} · {r.branch}
          {r.notes.length ? ` · ${r.notes.length} vault notes` : ''}
        </p>
      </div>
      <div className="run-head-actions">
        {extra}
        {/* a paused run, or a team run waiting on a card or its plan (the server reports it live), can be ended too */}
        {(r.live && r.status === 'running') || r.status === 'paused' ? (
          <Button variant="danger" onClick={() => void onAct('stop')}>
            Stop
          </Button>
        ) : null}
        {!r.live && ['stopped', 'running', 'error'].includes(r.status) ? (
          <Button variant="primary" onClick={() => void onAct('resume')}>
            {r.status === 'error' ? 'Retry failed' : 'Resume'}
          </Button>
        ) : null}
      </div>
    </header>
  );
}
```

`web/src/runs/RunBanners.tsx`:

```tsx
import type { RunView } from '../api';
import { Button } from '../components/arc/button/button';
import type { RunAct } from '../Runs';

/** Stream error, run error, one banner per approval step waiting (a worker waiting on its question shows in the question cards), Coach findings. */
export function RunBanners({ run: r, streamError, onAct }: { run: RunView; streamError?: string; onAct: RunAct }) {
  const nameOf = (id: string) => {
    const n = r.pipeline.nodes.find((x) => x.id === id);
    return n ? `${n.title ?? n.role ?? n.kind} (${id})` : id;
  };
  const approvals = r.pipeline.nodes.filter((n) => n.kind === 'approval' && r.nodes[n.id]?.status === 'awaiting');
  return (
    <>
      {streamError ? (
        <div className="alert error" role="alert">
          {streamError}
        </div>
      ) : null}
      {r.error ? <div className="alert error">{r.error}</div> : null}
      {approvals.map((n) => (
        <div key={n.id} className="alert wait">
          <div>
            <b>Awaiting approval:</b> {nameOf(n.id)}
            <span className="muted small"> — the run is paused and holds no process; approve to continue.</span>
          </div>
          <div className="row">
            <Button variant="primary" onClick={() => void onAct('approve', { node: n.id, approved: true })}>
              Approve
            </Button>
            <Button variant="danger" onClick={() => void onAct('approve', { node: n.id, approved: false })}>
              Reject
            </Button>
          </div>
        </div>
      ))}
      {r.coach?.length ? (
        <div className="coach">
          <b>Coach</b>
          {r.coach.map((f, i) => (
            <div key={i} className="finding">
              <b>{f.title}</b> <span className="muted">{f.detail}</span>
              <div className="small">→ {f.action}</div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
```

`web/src/runs/RunCentre.tsx`:

```tsx
import type { RunView } from '../api';
import { Canvas } from '../Canvas';
import type { RunAct } from '../Runs';
import { TeamPanel } from '../Team';
import { StepTrack } from '../ui/studio/StepTrack';

/** Team runs before approval: the Team panel in place of the graph. Otherwise the step track above the plan graph. */
export function RunCentre({ run: r, selected, onSelect, onAct }: { run: RunView; selected?: string; onSelect: (id?: string) => void; onAct: RunAct }) {
  const beforeApproval = r.kind === 'team' && r.pipeline.nodes.length === 0;
  const planning = beforeApproval && r.planning && !r.pending.length && (r.status === 'running' || r.status === 'paused');
  const steps = r.pipeline.nodes.map((n) => ({ id: n.id, title: n.title ?? n.role ?? n.kind, status: r.nodes[n.id]?.status ?? 'queued' }));
  return (
    <div className="run-centre">
      {r.kind === 'team' ? <TeamPanel run={r} send={(path, body) => onAct(path, body)} /> : null}
      {planning ? (
        <div className="run-planning">
          <StepTrack steps={[]} planning />
          <p className="sl-meta">Maestro is planning…</p>
        </div>
      ) : null}
      {beforeApproval ? null : (
        <>
          <StepTrack steps={steps} className="run-steptrack" />
          <div className="run-graph">
            <Canvas nodes={r.pipeline.nodes} edges={r.pipeline.edges} statuses={r.nodes} selected={selected} onSelect={onSelect} />
          </div>
        </>
      )}
    </div>
  );
}
```

`web/src/runs/Inspector.tsx` (the current tabs, moved; Task 19 rebuilds the Step tab):

```tsx
import { useEffect, useState } from 'react';
import { api, describeEvent, fmtDur, fmtUsd, type RunView, type StoredEvent } from '../api';
import { Badge, type BadgeTone } from '../components/arc/badge/badge';
import { Button } from '../components/arc/button/button';
import { CodeBlock } from '../components/arc/code-block/code-block';
import { Input } from '../components/arc/input/input';
import { JsonViewer } from '../components/arc/json-viewer/json-viewer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/arc/tabs/tabs';
import { Timeline, type TimelineEvent } from '../components/arc/timeline/timeline';
import type { RunAct } from '../Runs';
import { Diff } from '../ui/Diff';

export type Pane = 'node' | 'timeline' | 'branch';
const STATUS_TONE: Record<string, BadgeTone> = { running: 'info', done: 'success', error: 'danger', paused: 'warning', stopped: 'neutral' };
const TONE: Record<string, TimelineEvent['tone']> = { done: 'success', error: 'danger' };

export function Inspector({ run: r, events, selected, onAct }: { run: RunView; events: StoredEvent[]; selected?: string; onAct: RunAct }) {
  const [pane, setPane] = useState<Pane>('node');
  const [diff, setDiff] = useState<string>();
  // one draft note per step, so a note typed under one step can never be sent with another
  const [fbNotes, setFbNotes] = useState<Record<string, string>>({});
  const fbKey = `${r.id}\0${selected ?? ''}`;
  const fbNote = fbNotes[fbKey] ?? '';
  const setFbNote = (t: string) => setFbNotes((cur) => ({ ...cur, [fbKey]: t }));

  // a different run starts on the step pane; picking a step shows it
  useEffect(() => {
    setPane('node');
    setDiff(undefined);
  }, [r.id]);
  useEffect(() => {
    if (selected) setPane('node');
  }, [selected]);

  // diff for the selected step's commit, or the whole branch; refetched only when what picks it changes
  const commit = selected ? r.nodes[selected]?.commit : undefined;
  // the branch diff follows every step's commit, so it stays live as later steps commit
  const branchKey = pane === 'branch' ? Object.values(r.nodes).map((n) => n.commit ?? '').join(',') : '';
  useEffect(() => {
    let cancelled = false;
    const load = (path: string) =>
      api<{ diff: string }>('GET', path)
        .then((d) => !cancelled && setDiff(d.diff))
        .catch(() => !cancelled && setDiff(''));
    if (pane === 'branch') void load(`/api/runs/${r.id}/diff`);
    else if (selected && commit) void load(`/api/runs/${r.id}/diff?node=${encodeURIComponent(selected)}`);
    else setDiff(undefined);
    return () => {
      cancelled = true;
    };
  }, [r.id, selected, pane, commit, branchKey]);

  const nameOf = (id: string) => {
    const n = r.pipeline.nodes.find((x) => x.id === id);
    return n ? `${n.title ?? n.role ?? n.kind} (${id})` : id;
  };
  const node = selected ? r.nodes[selected] : undefined;
  const pnode = r.pipeline.nodes.find((n) => n.id === selected);
  async function feedback(rating: 'up' | 'down') {
    const note = fbNote.trim();
    if (await onAct('feedback', { node: selected, rating, ...(note ? { note } : {}) })) setFbNote('');
  }
  const timeline: TimelineEvent[] = events.flatMap((e) => {
    const d = describeEvent(e.event, nameOf);
    return d ? [{ id: String(e.seq), at: e.ts, title: d.text, tone: TONE[d.tone] ?? 'neutral', detail: <JsonViewer data={e.event} label="Event" defaultExpandDepth={1} maxHeight={240} /> }] : [];
  });

  return (
    <Tabs value={pane} onValueChange={(v) => setPane(v as Pane)}>
      <TabsList>
        <TabsTrigger value="node">Step</TabsTrigger>
        <TabsTrigger value="branch">Branch diff</TabsTrigger>
        <TabsTrigger value="timeline">{`Timeline (${events.length})`}</TabsTrigger>
      </TabsList>
      <TabsContent value="timeline">
        <Timeline label="Run events" events={timeline} now={Date.now()} maxHeight={480} />
      </TabsContent>
      <TabsContent value="branch">{diff ? <Diff text={diff} /> : <p className="muted pad">No committed changes on this branch yet.</p>}</TabsContent>
      <TabsContent value="node">
        {node && selected ? (
          <div className="node-detail">
            <h4>
              {nameOf(selected)} <Badge tone={STATUS_TONE[node.status] ?? 'neutral'}>{node.status}</Badge>
            </h4>
            <p className="muted small">
              {node.attempts} attempt{node.attempts === 1 ? '' : 's'}
              {node.loops ? ` · ${node.loops} fix loop${node.loops === 1 ? '' : 's'}` : ''}
              {node.costUsd ? ` · ${fmtUsd(node.costUsd)}` : ''}
              {node.startedAt && node.finishedAt ? ` · ${fmtDur(node.finishedAt - node.startedAt)}` : ''}
              {node.verdict ? ` · VERDICT ${node.verdict}` : ''}
              {node.commit ? ' · commit ' : ''}
              {node.commit ? <code>{node.commit.slice(0, 7)}</code> : null}
            </p>
            {node.error ? <div className="alert error">{node.error}</div> : null}
            {node.live ? (
              <>
                <h5>Live output</h5>
                <pre className="out live">{node.live}</pre>
              </>
            ) : null}
            {pnode?.kind === 'gate' && node.gate ? (
              <>
                <h5>
                  Gate · {pnode.command} · {node.gate.ok ? 'passed' : `failed (exit ${node.gate.exitCode})`}
                </h5>
                <CodeBlock code={node.gate.output || '(no output)'} filename={pnode.command} language="text" maxLines={40} />
              </>
            ) : null}
            {node.output && pnode?.kind === 'agent' ? (
              <>
                <h5>Output</h5>
                <CodeBlock code={node.output} language="text" maxLines={40} />
              </>
            ) : null}
            {diff ? (
              <>
                <h5>Changes this step committed</h5>
                <Diff text={diff} />
              </>
            ) : null}
            {pnode?.kind === 'agent' && !pnode.readOnly && node.status === 'done' && !node.commit ? <p className="muted small">This step finished without changing any files.</p> : null}
            {pnode?.kind === 'agent' && (node.status === 'done' || node.status === 'error') && !r.probe ? (
              <div className="row feedback" title="Evolve learns from this: a note says why">
                <span className="muted small">Was this step good?{node.feedback ? ` You said ${node.feedback.rating === 'up' ? 'good' : 'bad'}.` : ''}</span>
                <Input label="Why (optional)" maxLength={500} value={fbNote} onChange={(e) => setFbNote(e.target.value)} />
                <Button variant="secondary" size="sm" onClick={() => feedback('up')}>
                  Good
                </Button>
                <Button variant="secondary" size="sm" onClick={() => feedback('down')}>
                  Bad
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted pad">Click a step in the graph to see its output, diff and gate results.</p>
        )}
      </TabsContent>
    </Tabs>
  );
}
```

Replace `web/src/Runs.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api, type RunRow, type RunView } from './api';
import { Loading } from './components/Loading';
import { usePoll } from './hooks';
import { useRunStream } from './runStream';
import { Inspector } from './runs/Inspector';
import { RunBanners } from './runs/RunBanners';
import { RunCentre } from './runs/RunCentre';
import { RunHeader } from './runs/RunHeader';
import { RunList } from './runs/RunList';
import { useNotify } from './ui/notify';
import { EmptyState } from './ui/studio/EmptyState';
import './runs/runs.css';

/** Post an action to the selected run. Resolves true when it went through; a failure is toasted. */
export type RunAct = (path: string, body?: unknown) => Promise<boolean>;

export interface RunsProps {
  selected?: string;
  /** A step of the selected run (from #/runs/<id>/<node>). */
  node?: string;
  onSelect: (id?: string) => void;
  onSelectNode?: (node?: string) => void;
}

export function Runs(props: RunsProps) {
  const notify = useNotify();
  const [probes, setProbes] = useState(false);
  const list = usePoll<RunRow[]>(probes ? '/api/runs?all=1' : '/api/runs', 2000);
  const { run, setRun, events, error } = useRunStream(props.selected);
  const [selNode, setSelNode] = useState<string | undefined>(props.node);
  // the route names the step; a different run starts with the route's step (none when it names none)
  useEffect(() => setSelNode(props.node), [props.selected, props.node]);
  const pick = (id?: string) => {
    setSelNode(id);
    props.onSelectNode?.(id);
  };

  const act: RunAct = async (path, body = {}) => {
    try {
      setRun(await api<RunView>('POST', `/api/runs/${props.selected}/${path}`, body));
      void list.refresh();
      return true;
    } catch (e) {
      notify.fail(e);
      return false;
    }
  };

  const page = run ? (
    <>
      <RunHeader run={run} onAct={act} />
      <RunBanners run={run} streamError={error} onAct={act} />
      <RunCentre run={run} selected={selNode} onSelect={pick} onAct={act} />
      <Inspector run={run} events={events} selected={selNode} onAct={act} />
    </>
  ) : props.selected && error ? (
    <div className="alert error" role="alert">
      {error}
    </div>
  ) : props.selected ? (
    <Loading loading lines={4} label="Loading run" />
  ) : (
    <EmptyState title="No run selected" description="Select a run to follow it live." />
  );

  return (
    <div className="runs">
      <RunList poll={list} probes={probes} onProbes={setProbes} selected={props.selected} onSelect={props.onSelect} />
      <section className="run-detail">{page}</section>
    </div>
  );
}
```

In `web/src/App.tsx` replace the Runs line with:

```tsx
          {screen.tab === 'runs' ? (
            <Runs
              selected={screen.id}
              node={screen.node}
              onSelect={(id) => go(id ? { tab: 'runs', id } : { tab: 'runs' })}
              onSelectNode={(node) => screen.id && go({ tab: 'runs', id: screen.id, ...(node ? { node } : {}) })}
            />
          ) : null}
```

Append to `web/src/runs/runs.css`:

```css
.run-detail { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: auto; }
.run-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 16px 20px 10px; }
.run-head-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.run-head-title { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.run-head-title h2 { margin: 0; font-size: 18px; font-weight: 600; color: var(--ink); }
.run-head-task { margin: 0; color: var(--ink); }
.run-head-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.run-centre { display: flex; flex-direction: column; gap: 10px; }
.run-planning { display: flex; flex-direction: column; gap: 8px; margin: 0 20px; }
.run-steptrack { margin: 0 20px; }
.run-graph { display: flex; height: 320px; flex: none; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.run-graph .canvas { flex: 1; }
```

Delete `.run-detail`, `.run-head`, `.run-head h3`, `.run-graph` and `.run-graph .canvas` from `web/src/styles.css`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run --project web web/src/Runs.test.tsx web/src/Canvas.test.tsx web/src/App.test.tsx web/src/Team.test.tsx web/src/Builder.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/runs web/src/Runs.tsx web/src/Runs.test.tsx web/src/App.tsx web/src/Canvas.tsx web/src/Canvas.test.tsx web/src/styles.css
git commit -m "feat(web): run page header, banners and centre with step track and step links"
```

---

### Task 19: Inspector rebuild and responsive Runs layouts

**Files:**
- Create: `web/src/runs/fileStats.ts`, `web/src/runs/FileBars.tsx`, `web/src/runs/StepPane.tsx`
- Modify: `web/src/runs/Inspector.tsx` (full rewrite), `web/src/Runs.tsx` (full rewrite: layouts), `web/src/runs/runs.css` (layout rules)
- Test: `web/src/runs/Inspector.test.tsx`, `web/src/runs/fileStats.test.ts`, `web/src/Runs.test.tsx` (layout and stale-link cases)

**Interfaces:**
- Consumes: Task 18's `RunAct`, `RunHeader` (`extra`), `RunBanners`, `RunCentre`, `RunList`; `useMediaQuery`, `PHONE`, `BELOW_WIDE` (Task 7); `crewFor`, `useCrew`; `Face`, `moodFor`; `StatusChip`, `toneFor`; Arc `Drawer`, `DrawerContent`, `SegmentedControl`, `Button`; lucide `ArrowLeft`.
- Produces:
  - `interface FileStat { file: string; add: number; del: number }`; `fileStats(diff: string): FileStat[]`.
  - `FileBars(props: { diff: string })`.
  - `StepPane(props: { run: RunView; nodeId: string; diff?: string; note: string; onNote: (t: string) => void; onAct: RunAct })`.
  - `Inspector` keeps its props; Step tab = `StepPane`.
  - Runs layouts: ≥1200 px three panes (list · centre · Inspector aside); 900–1199 px list + centre with the Inspector in a right Drawer (opened by picking a step or the header's Inspector button); <900 px a stack (the list, or the run page with Back and a Graph / Inspector switch).

- [ ] **Step 1: Write the failing tests**

`web/src/runs/fileStats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fileStats } from './fileStats';

describe('fileStats', () => {
  it('counts added and removed lines per file, ignoring headers', () => {
    const diff = ['diff --git a/src/a.ts b/src/a.ts', 'index 1..2 100644', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,2 +1,3 @@', '+one', '+two', '-three', ' same', 'diff --git a/README.md b/README.md', '--- a/README.md', '+++ b/README.md', '-gone'].join('\n');
    expect(fileStats(diff)).toEqual([{ file: 'src/a.ts', add: 2, del: 1 }, { file: 'README.md', add: 0, del: 1 }]);
    expect(fileStats('')).toEqual([]);
  });
});
```

`web/src/runs/Inspector.test.tsx`:

```tsx
import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), api: vi.fn() }));
import { api, type RunView } from '../api';
import { makeRun, routeApi } from '../test/fixtures';
import { renderApp } from '../test/render';
import { Inspector } from './Inspector';

const act0 = vi.fn(async () => true);
const show = (run: RunView, selected?: string) => renderApp(<Inspector run={run} events={[]} selected={selected} onAct={act0} />);
const DIFF = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n+one\n+two\n-three';

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({ 'GET /api/runs/r1/diff': { diff: DIFF } });
});

describe('Inspector step pane', () => {
  it('shows the bot face and name, the status chip, and a caret only while the step runs', () => {
    const { container, unmount } = show(makeRun(), 'code');
    expect(screen.getByRole('heading', { name: /Bolt · coder/ })).toBeTruthy();
    expect(container.querySelector('.sl-chip.t-live')!.textContent).toBe('running');
    expect(container.querySelector('.out.live .caret')).toBeTruthy();
    unmount();
    const done = makeRun({ nodes: { ...makeRun().nodes, code: { ...makeRun().nodes.code!, status: 'done', live: 'last words' } } });
    const again = show(done, 'code');
    expect(again.container.querySelector('.out.live .caret')).toBeNull();
  });

  it('says why Maestro picked the bot on team runs only', () => {
    const plan = { goal: 'g', success: [], assignments: [{ bot: 'coder', goal: 'c', mode: 'write' as const, why: 'Bolt knows this code' }], limits: { allowWrites: true }, answers: [] };
    const { unmount } = show(makeRun({ kind: 'team', plan }), 'code');
    expect(screen.getByText('Bolt knows this code')).toBeTruthy();
    expect(screen.getByText('Why Maestro picked it')).toBeTruthy();
    unmount();
    show(makeRun({ plan }), 'code');
    expect(screen.queryByText('Why Maestro picked it')).toBeNull();
  });

  it('draws per-file bars for the step’s committed diff', async () => {
    const withCommit = makeRun({ nodes: { ...makeRun().nodes, code: { ...makeRun().nodes.code!, status: 'done', commit: 'abc1234' } } });
    routeApi({ 'GET /api/runs/r1/diff?node=code': { diff: DIFF } });
    show(withCommit, 'code');
    expect(await screen.findByText('src/a.ts')).toBeTruthy();
    expect(screen.getByText('+2 −1')).toBeTruthy();
  });

  it('says so when the linked step is not in the run', () => {
    show(makeRun(), 'ghost');
    expect(screen.getByRole('note').textContent).toContain('This step is not in this run');
  });

  it('hints to pick a step when none is selected', async () => {
    show(makeRun());
    await waitFor(() => expect(screen.getByText('Click a step in the graph to see its output, diff and gate results.')).toBeTruthy());
    await act(async () => {});
  });
});
```

Append to `web/src/Runs.test.tsx` inside `describe('Runs', …)`:

```tsx
  it('says so when the route names a step that is not in the run', async () => {
    renderApp(<Runs selected="r1" node="ghost" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
    expect((await screen.findByRole('note')).textContent).toContain('This step is not in this run');
  });

  it('keeps three panes from 1200 px: the Inspector is its own column', async () => {
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
    expect(await screen.findByRole('complementary', { name: 'Inspector' })).toBeTruthy();
  });

  it('moves the Inspector into a drawer between 900 and 1199 px', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 1199px)', media: q, addEventListener() {}, removeEventListener() {} }));
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
    await screen.findByRole('heading', { name: /plan-code-review/ });
    expect(screen.queryByRole('tab', { name: 'Branch diff' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Inspector' }));
    expect(await screen.findByRole('dialog', { name: 'Inspector' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Branch diff' })).toBeTruthy();
  });

  it('stacks the list and the run page under 900 px', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 899px)' || q === '(max-width: 1199px)', media: q, addEventListener() {}, removeEventListener() {} }));
    const onSelect = vi.fn();
    const { rerender } = renderApp(<Runs onSelect={onSelect} />);
    expect(await screen.findByText('Second task')).toBeTruthy();
    rerender(<Runs selected="r1" onSelect={onSelect} />);
    act(() => FakeEventSource.all.at(-1)!.emit('state', makeRun()));
    await screen.findByRole('heading', { name: /plan-code-review/ });
    expect(screen.queryByText('Second task')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Inspector' }));
    expect(screen.getByRole('tab', { name: 'Step' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Runs/ }));
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project web web/src/runs web/src/Runs.test.tsx`
Expected: FAIL — `fileStats` missing; no caret, no "Why Maestro picked it", no Inspector aside or drawer.

- [ ] **Step 3: Write the implementation**

`web/src/runs/fileStats.ts`:

```ts
export interface FileStat { file: string; add: number; del: number }

/** Per-file added/removed line counts from a unified diff (headers and hunk markers are not counted). */
export function fileStats(diff: string): FileStat[] {
  const out: FileStat[] = [];
  let cur: FileStat | undefined;
  for (const l of diff.split('\n')) {
    const m = /^diff --git a\/.+? b\/(.+)$/.exec(l);
    if (m) {
      cur = { file: m[1]!, add: 0, del: 0 };
      out.push(cur);
      continue;
    }
    if (!cur || l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) cur.add++;
    else if (l.startsWith('-')) cur.del++;
  }
  return out;
}
```

`web/src/runs/FileBars.tsx`:

```tsx
import { fileStats } from './fileStats';

/** One row per changed file: name, +/− counts and a bar split into added (green) and removed (red). */
export function FileBars(props: { diff: string }) {
  const stats = fileStats(props.diff);
  if (!stats.length) return null;
  const max = Math.max(...stats.map((s) => s.add + s.del), 1);
  return (
    <ul className="file-bars" aria-label="Changed files">
      {stats.map((s) => (
        <li key={s.file}>
          <span className="file-name">{s.file}</span>
          <span className="file-count">{`+${s.add} −${s.del}`}</span>
          <span className="file-bar" aria-hidden="true">
            <span className="file-add" style={{ width: `${(s.add / max) * 100}%` }} />
            <span className="file-del" style={{ width: `${(s.del / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
```

`web/src/runs/StepPane.tsx`:

```tsx
import { fmtDur, fmtUsd, type RunView } from '../api';
import { Button } from '../components/arc/button/button';
import { CodeBlock } from '../components/arc/code-block/code-block';
import { Input } from '../components/arc/input/input';
import { crewFor, useCrew } from '../crewStore';
import { Face, moodFor } from '../Face';
import type { RunAct } from '../Runs';
import { Diff } from '../ui/Diff';
import { StatusChip, toneFor } from '../ui/studio/StatusChip';
import { FileBars } from './FileBars';

export function StepPane(p: { run: RunView; nodeId: string; diff?: string; note: string; onNote: (t: string) => void; onAct: RunAct }) {
  const { crew } = useCrew();
  const r = p.run;
  const node = r.nodes[p.nodeId];
  const pnode = r.pipeline.nodes.find((n) => n.id === p.nodeId);
  if (!node || !pnode)
    return (
      <p className="sl-note" role="note">
        This step is not in this run. Click a step in the graph to see its output, diff and gate results.
      </p>
    );
  const bot = crewFor(pnode, crew);
  const running = node.status === 'running';
  // "why Maestro picked it" is the plan assignment's reason, team runs only
  const why = r.kind === 'team' ? r.plan?.assignments.find((a) => a.bot === pnode.role)?.why : undefined;
  async function feedback(rating: 'up' | 'down') {
    const note = p.note.trim();
    if (await p.onAct('feedback', { node: p.nodeId, rating, ...(note ? { note } : {}) })) p.onNote('');
  }

  return (
    <div className="node-detail">
      <div className="step-head">
        <Face id={bot} size={32} mood={moodFor(node.status)} animate={running ? 'always' : undefined} />
        <div className="step-head-main">
          <h4>
            {crew[bot]?.name ?? bot} · {pnode.title ?? pnode.role ?? pnode.kind} <span className="sl-meta">{p.nodeId}</span>
          </h4>
          <StatusChip tone={toneFor(node.status)} label={node.status} pulse={running} />
        </div>
      </div>
      <p className="sl-meta">
        {node.attempts} attempt{node.attempts === 1 ? '' : 's'}
        {node.loops ? ` · ${node.loops} fix loop${node.loops === 1 ? '' : 's'}` : ''}
        {node.costUsd ? ` · ${fmtUsd(node.costUsd)}` : ''}
        {node.startedAt && node.finishedAt ? ` · ${fmtDur(node.finishedAt - node.startedAt)}` : ''}
        {node.verdict ? ` · VERDICT ${node.verdict}` : ''}
        {node.commit ? ` · commit ${node.commit.slice(0, 7)}` : ''}
      </p>
      {why ? (
        <p className="step-why">
          <span className="sl-meta">Why Maestro picked it</span> <span>{why}</span>
        </p>
      ) : null}
      {node.error ? <div className="alert error">{node.error}</div> : null}
      {node.live ? (
        <>
          <h5>Live output</h5>
          <pre className="out live">
            {node.live}
            {running ? <span className="caret" aria-hidden="true" /> : null}
          </pre>
        </>
      ) : null}
      {pnode.kind === 'gate' && node.gate ? (
        <>
          <h5>
            Gate · {pnode.command} · {node.gate.ok ? 'passed' : `failed (exit ${node.gate.exitCode})`}
          </h5>
          <CodeBlock code={node.gate.output || '(no output)'} filename={pnode.command} language="text" maxLines={40} />
        </>
      ) : null}
      {node.output && pnode.kind === 'agent' ? (
        <>
          <h5>Output</h5>
          <CodeBlock code={node.output} language="text" maxLines={40} />
        </>
      ) : null}
      {p.diff ? (
        <>
          <h5>Changes this step committed</h5>
          <FileBars diff={p.diff} />
          <Diff text={p.diff} />
        </>
      ) : null}
      {pnode.kind === 'agent' && !pnode.readOnly && node.status === 'done' && !node.commit ? <p className="sl-meta">This step finished without changing any files.</p> : null}
      {pnode.kind === 'agent' && (node.status === 'done' || node.status === 'error') && !r.probe ? (
        <div className="row feedback" title="Evolve learns from this: a note says why">
          <span className="sl-meta">Was this step good?{node.feedback ? ` You said ${node.feedback.rating === 'up' ? 'good' : 'bad'}.` : ''}</span>
          <Input label="Why (optional)" maxLength={500} value={p.note} onChange={(e) => p.onNote(e.target.value)} />
          <Button variant="secondary" size="sm" onClick={() => void feedback('up')}>
            Good
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void feedback('down')}>
            Bad
          </Button>
        </div>
      ) : null}
    </div>
  );
}
```

Replace `web/src/runs/Inspector.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api, describeEvent, type RunView, type StoredEvent } from '../api';
import { JsonViewer } from '../components/arc/json-viewer/json-viewer';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/arc/tabs/tabs';
import { Timeline, type TimelineEvent } from '../components/arc/timeline/timeline';
import type { RunAct } from '../Runs';
import { Diff } from '../ui/Diff';
import { StepPane } from './StepPane';

export type Pane = 'node' | 'timeline' | 'branch';
const TONE: Record<string, TimelineEvent['tone']> = { done: 'success', error: 'danger' };

/** Step (the selected step), Branch diff (the whole branch, live as steps commit) and Timeline (run events with JSON detail). */
export function Inspector({ run: r, events, selected, onAct }: { run: RunView; events: StoredEvent[]; selected?: string; onAct: RunAct }) {
  const [pane, setPane] = useState<Pane>('node');
  const [diff, setDiff] = useState<string>();
  // one draft note per step, so a note typed under one step can never be sent with another
  const [notes, setNotes] = useState<Record<string, string>>({});
  const noteKey = `${r.id}\0${selected ?? ''}`;

  useEffect(() => {
    setPane('node');
    setDiff(undefined);
  }, [r.id]);
  useEffect(() => {
    if (selected) setPane('node');
  }, [selected]);

  const commit = selected ? r.nodes[selected]?.commit : undefined;
  const branchKey = pane === 'branch' ? Object.values(r.nodes).map((n) => n.commit ?? '').join(',') : '';
  useEffect(() => {
    let cancelled = false;
    const load = (path: string) =>
      api<{ diff: string }>('GET', path)
        .then((d) => !cancelled && setDiff(d.diff))
        .catch(() => !cancelled && setDiff(''));
    if (pane === 'branch') void load(`/api/runs/${r.id}/diff`);
    else if (selected && commit) void load(`/api/runs/${r.id}/diff?node=${encodeURIComponent(selected)}`);
    else setDiff(undefined);
    return () => {
      cancelled = true;
    };
  }, [r.id, selected, pane, commit, branchKey]);

  const nameOf = (id: string) => {
    const n = r.pipeline.nodes.find((x) => x.id === id);
    return n ? `${n.title ?? n.role ?? n.kind} (${id})` : id;
  };
  const timeline: TimelineEvent[] = events.flatMap((e) => {
    const d = describeEvent(e.event, nameOf);
    return d ? [{ id: String(e.seq), at: e.ts, title: d.text, tone: TONE[d.tone] ?? 'neutral', detail: <JsonViewer data={e.event} label="Event" defaultExpandDepth={1} maxHeight={240} /> }] : [];
  });

  return (
    <Tabs value={pane} onValueChange={(v) => setPane(v as Pane)}>
      <TabsList aria-label="Inspector">
        <TabsTrigger value="node">Step</TabsTrigger>
        <TabsTrigger value="branch">Branch diff</TabsTrigger>
        <TabsTrigger value="timeline">{`Timeline (${events.length})`}</TabsTrigger>
      </TabsList>
      <TabsContent value="timeline">
        <Timeline label="Run events" events={timeline} now={Date.now()} maxHeight={480} />
      </TabsContent>
      <TabsContent value="branch">{diff ? <Diff text={diff} /> : <p className="sl-meta pad">No committed changes on this branch yet.</p>}</TabsContent>
      <TabsContent value="node">
        {selected ? (
          <StepPane run={r} nodeId={selected} diff={diff} note={notes[noteKey] ?? ''} onNote={(t) => setNotes((cur) => ({ ...cur, [noteKey]: t }))} onAct={onAct} />
        ) : (
          <p className="sl-meta pad">Click a step in the graph to see its output, diff and gate results.</p>
        )}
      </TabsContent>
    </Tabs>
  );
}
```

Replace `web/src/Runs.tsx`:

```tsx
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type RunRow, type RunView } from './api';
import { Button } from './components/arc/button/button';
import { Drawer, DrawerContent } from './components/arc/drawer/drawer';
import SegmentedControl from './components/arc/segmented-control/segmented-control';
import { Loading } from './components/Loading';
import { usePoll } from './hooks';
import { useRunStream } from './runStream';
import { Inspector } from './runs/Inspector';
import { RunBanners } from './runs/RunBanners';
import { RunCentre } from './runs/RunCentre';
import { RunHeader } from './runs/RunHeader';
import { RunList } from './runs/RunList';
import { cn } from './ui/cn';
import { useNotify } from './ui/notify';
import { EmptyState } from './ui/studio/EmptyState';
import { BELOW_WIDE, PHONE, useMediaQuery } from './ui/studio/useMediaQuery';
import './runs/runs.css';

/** Post an action to the selected run. Resolves true when it went through; a failure is toasted. */
export type RunAct = (path: string, body?: unknown) => Promise<boolean>;

export interface RunsProps {
  selected?: string;
  /** A step of the selected run (from #/runs/<id>/<node>). */
  node?: string;
  onSelect: (id?: string) => void;
  onSelectNode?: (node?: string) => void;
}

type PhoneView = 'graph' | 'inspector';

/** Three panes from 1200 px; list + centre with the Inspector in a drawer from 900 px; a stack below. One EventSource: the selected run's. */
export function Runs(props: RunsProps) {
  const notify = useNotify();
  const [probes, setProbes] = useState(false);
  const list = usePoll<RunRow[]>(probes ? '/api/runs?all=1' : '/api/runs', 2000);
  const { run, setRun, events, error } = useRunStream(props.selected);
  const [selNode, setSelNode] = useState<string | undefined>(props.node);
  const belowWide = useMediaQuery(BELOW_WIDE);
  const phone = useMediaQuery(PHONE);
  const [drawer, setDrawer] = useState(false);
  const [phoneView, setPhoneView] = useState<PhoneView>('graph');

  useEffect(() => setSelNode(props.node), [props.selected, props.node]);
  useEffect(() => {
    setDrawer(false);
    setPhoneView('graph');
  }, [props.selected]);
  const pick = (id?: string) => {
    setSelNode(id);
    props.onSelectNode?.(id);
    if (id) {
      setDrawer(true);
      setPhoneView('inspector');
    }
  };

  const act: RunAct = async (path, body = {}) => {
    try {
      setRun(await api<RunView>('POST', `/api/runs/${props.selected}/${path}`, body));
      void list.refresh();
      return true;
    } catch (e) {
      notify.fail(e);
      return false;
    }
  };

  const listPane = <RunList poll={list} probes={probes} onProbes={setProbes} selected={props.selected} onSelect={props.onSelect} />;
  const placeholder =
    props.selected && error ? (
      <div className="alert error" role="alert">
        {error}
      </div>
    ) : props.selected ? (
      <Loading loading lines={4} label="Loading run" />
    ) : (
      <EmptyState title="No run selected" description="Select a run to follow it live." />
    );
  const inspector = run ? <Inspector run={run} events={events} selected={selNode} onAct={act} /> : null;
  const centre = run ? <RunCentre run={run} selected={selNode} onSelect={pick} onAct={act} /> : null;

  if (phone) {
    if (!props.selected) return <div className="runs stacked">{listPane}</div>;
    return (
      <div className="runs stacked">
        <section className="run-detail">
          <div className="run-back">
            <Button variant="ghost" size="sm" onClick={() => props.onSelect(undefined)}>
              <ArrowLeft size={14} aria-hidden="true" /> Runs
            </Button>
          </div>
          {run ? (
            <>
              <RunHeader run={run} onAct={act} />
              <RunBanners run={run} streamError={error} onAct={act} />
              <div className="run-phone-switch">
                <SegmentedControl label="Run view" options={[{ value: 'graph', label: 'Graph' }, { value: 'inspector', label: 'Inspector' }]} value={phoneView} onValueChange={(v) => setPhoneView(v as PhoneView)} />
              </div>
              {phoneView === 'graph' ? centre : <div className="run-inspector-inline">{inspector}</div>}
            </>
          ) : (
            placeholder
          )}
        </section>
      </div>
    );
  }

  return (
    <div className={cn('runs', { mid: belowWide })}>
      {listPane}
      <section className="run-detail">
        {run ? (
          <>
            <RunHeader
              run={run}
              onAct={act}
              extra={
                belowWide ? (
                  <Button variant="secondary" onClick={() => setDrawer(true)}>
                    Inspector
                  </Button>
                ) : null
              }
            />
            <RunBanners run={run} streamError={error} onAct={act} />
            {centre}
          </>
        ) : (
          placeholder
        )}
      </section>
      {belowWide ? (
        <Drawer open={drawer && !!run} onOpenChange={setDrawer}>
          <DrawerContent side="right" title="Inspector">
            {inspector}
          </DrawerContent>
        </Drawer>
      ) : run ? (
        <aside className="run-inspector" aria-label="Inspector">
          {inspector}
        </aside>
      ) : null}
    </div>
  );
}
```

In `web/src/runs/runs.css` replace the first `.runs` rule with the layouts and add the Inspector parts:

```css
.runs { display: grid; grid-template-columns: 300px minmax(0, 1fr) minmax(320px, 420px); height: 100%; min-height: 0; }
.runs.mid { grid-template-columns: 280px minmax(0, 1fr); }
.runs.stacked { display: block; height: auto; min-height: 100%; }
.runs.stacked .run-list { border-right: 0; }
.run-inspector { min-height: 0; overflow: auto; padding: 12px 14px; background: var(--s1); border-left: 1px solid var(--line); }
.run-inspector-inline { padding: 0 12px 16px; }
.run-back { padding: 8px 12px 0; }
.run-phone-switch { padding: 0 20px 8px; }
.step-head { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; }
.step-head-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.step-head h4 { margin: 0; font-size: 14px; letter-spacing: 0; text-transform: none; color: var(--ink); }
.step-why { margin: 6px 0; display: flex; flex-direction: column; gap: 2px; }
.caret { display: inline-block; width: 7px; height: 1em; margin-left: 2px; vertical-align: text-bottom; background: var(--acc); animation: caret-blink 1s steps(1) infinite; }
@keyframes caret-blink { 50% { opacity: 0; } }
.file-bars { display: flex; flex-direction: column; gap: 4px; margin: 0 0 8px; padding: 0; list-style: none; }
.file-bars li { display: grid; grid-template-columns: minmax(0, 1fr) auto 80px; gap: 8px; align-items: center; }
.file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-code); font-size: 12px; }
.file-count { font-family: var(--font-code); font-size: 11px; color: var(--mut); }
.file-bar { display: flex; height: 6px; overflow: hidden; border-radius: 2px; background: var(--s3); }
.file-add { background: var(--ok); }
.file-del { background: var(--bad); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project web web/src/runs web/src/Runs.test.tsx web/src/App.test.tsx web/src/rules.test.ts`
Expected: PASS. The heading test matches `Bolt · coder` because `makeRun`'s `code` node has role `coder` and no title.

- [ ] **Step 5: Full suites, typecheck, build**

Run: `npx vitest run --project web && npx vitest run --project node && npm run typecheck && npm run build`
Expected: all green except the three known `/private/var` triggers failures (flaky-under-load tests pass alone).

- [ ] **Step 6: Chrome check (phase 4 done, Plan A done)**

`npm run build && npm run dev`, then in Chrome in both themes at 1440 × 900 (three panes), 1024 × 768 (Inspector drawer) and 390 × 844 (stack with Back and Graph / Inspector), and at 200% zoom and 320 px width (no horizontal scroll): a live workflow run (moving border on the selected row, striped working segment, caret blinking in live output, edges solid / animated / dashed), a team run before approval (Team panel in the centre, question cards, plan review with swap select), `#/runs/<id>/<node>` deep links, approve/reject banners, feedback, Branch diff staying live, Timeline JSON detail, reduced motion stopping every loop. Builder, Graph, Crew, Triggers and the Evolve drawer show no violet, no blue primary, no grey skeleton and readable contrast.

- [ ] **Step 7: Commit**

```bash
git add web/src/runs web/src/Runs.tsx web/src/Runs.test.tsx
git commit -m "feat(web): Studio Inspector with per-file bars and responsive Runs layouts"
```

---

## Spec coverage map (self-review)

| Spec section | Task(s) |
| --- | --- |
| §1 Tokens, cascade, text-safe accent, Arc bridge | 1 |
| §1 Theme selection | 2 |
| §1 No purple, gradients and motion, contrast, loading | 1 (reduced motion), 3 |
| §1 Shared Studio parts | 4, 5 (+ `InlineError` in 14) |
| §1 Parity pass | 3 (styles, Loading in Runs/Crew/Triggers), 9 (topbar removed) |
| §2 Rail, bottom bar | 7, 9 |
| §2 Settings drawer, connection | 8, 9 |
| §2 Routing (incl. `crew/<bot>`, `graph/<note>` parsed), ⌘K, toasts, leave guards | 6, 9 |
| §3 Home sections, polling, loading, empty states | 9 (frame), 14, 15, 16 |
| §3 Server: `/api/runs` additions, `/api/attention`, `/api/activity`, `/api/roster/preview` | 10, 11, 12, 13 |
| §4 Runs: list, header, banners, centre (Team panel), Inspector, layouts | 17, 18, 19 |
| §6 Accessibility (log + live region, clocks, pulsing chips keep text, breakpoints) | 7, 15, 16, 17–19 |
| §7 Error handling (inline errors, backoff, toasts) | 6 (`fails`), 8, 14–19 |
| §8 Testing | every task |
| §9 Plan B (Builder, Graph, Crew, Triggers, Evolve, Team-panel parity, deleting `.studio`) | out of scope |

