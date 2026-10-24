# Web dashboard on React + Arc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SolidJS web dashboard with a React 19 one built from Arc's free components, with the same screens, routes and server API.

**Architecture:** The React app is built next to the Solid one in `web/app/` (tested with Vitest + jsdom as each screen lands), while `web/src/` keeps building and serving. The last task deletes `web/src/`, moves `web/app/` to `web/src/`, and points Vite at React. Arc components are copied once into `web/app/components/arc/` by a dev-time script and committed; screens use them directly or through a few small wrappers in `web/app/ui/`.

**Tech Stack:** React 19.3.1, Vite 8, `@vitejs/plugin-react` 6.1.2, Arc (uiarc.dev, MIT, free registry), `motion`, `lucide-react`, Radix primitives (pulled in by Arc), Vitest 5 + jsdom 30 + `@testing-library/react` 16.

**Spec:** `docs/superpowers/specs/2026-10-23-web-react-arc-design.md`

## Global Constraints

- Same screens, same `#/<tab>[/<id>]` routes, same `api.ts`, same server endpoints. No backend change.
- Arc **free** components only. No Pro registry, no `ARC_PRO_TOKEN`.
- Arc files are fetched only by `scripts/arc-add.mjs` at dev time and committed under `web/app/components/arc/` (later `web/src/components/arc/`) with Arc's MIT licence file. The built app makes no request to `uiarc.dev` or any host other than its own server.
- No browser `confirm()`/`alert()`/`prompt()` anywhere in the new app. Destructive actions use `ConfirmButton` (inline two-step) or an Arc `Dialog`.
- Load failures show inline (alert or `EmptyState` with retry); action failures show as a toast (`useNotify().fail`).
- `usePoll` backs off to 15 s after 3 consecutive failures and returns to its interval after a success.
- Radix `Select` cannot take an empty-string value: every "none / default / follow" option uses the sentinel `NONE = '__none'` (from `web/app/ui/cn.ts`) and is mapped back to `''`/`undefined` before it reaches state or the API.
- Theme: Arc `foundation.css` drives all colour tokens; `data-theme` is `light` | `dark` on `<html>` (saved in `localStorage['aorch.theme']`, default from `prefers-color-scheme`), `data-accent="violet"`.
- `web/app/tsconfig.json` (and, after switch-over, `web/tsconfig.json`) uses `strict: true`, `jsx: react-jsx`, and **`noUncheckedIndexedAccess: false`** so vendored Arc sources typecheck unmodified.
- Spec §3 components deliberately not used here, because no current screen needs them: `dropdown-menu`, `popover` (Builder keeps its palette list and inline inspector), `avatar`, `avatar-group`, `slider` (the crew track adds them with Blobatar faces), a delete-run `Dialog` (the dashboard has no delete-run action today), a Crew built-in/custom/imported `Tabs` (nothing is imported until the crew track), a Team phase `Stepper` and a Graph note `Card`. The Arc `Card` is used for crew packs instead.
- Commits have no Claude attribution lines (owner rule).
- Work on branch `feature/web-react-arc`, created from `worktree-crew-track` (which holds the spec).

## Porting rules (every screen task follows these)

The Solid source file named in a task is the reference for markup, copy and behaviour. Translate it with this table; anything not listed stays as written (same copy, same class names, same order).

| Solid | React |
|---|---|
| `const [x, setX] = createSignal(v)`; read `x()` | `const [x, setX] = useState(v)`; read `x` |
| `createMemo(() => f())` | `useMemo(() => f(), [deps])` |
| `createEffect(on(src, fn))` | `useEffect(() => fn(src), [src])` with an explicit cleanup return |
| `onMount(fn)` / `onCleanup(fn)` | `useEffect(() => { fn(); return cleanup; }, [])` |
| `let el!: HTMLDivElement` + `ref={el}` | `const el = useRef<HTMLDivElement>(null)`; use `el.current!` |
| `<Show when={c} fallback={f}>…</Show>` | `{c ? … : f}` |
| `<Show when={v}>{(x) => …x()…}</Show>` | `{v ? …v… : null}` |
| `<For each={xs}>{(x, i) => …}</For>`, `<Index>` | `{xs.map((x, i) => <… key={stableId}>)}`; keys: node/run/trigger `id`, edges `` `${from}→${to}` ``, events `seq` |
| `class=` / `classList={{ a: c }}` | `className=` / `className={cn('base', { a: c })}` |
| `onInput={(e) => f(e.currentTarget.value)}` | `onChange={(e) => f(e.target.value)}` (inputs are controlled: always pass `value`) |
| `style={{ 'background-size': v }}` | `style={{ backgroundSize: v }}` |
| SVG `marker-end`, `text-anchor`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`, `stroke-opacity`, `stroke-dasharray`, `shape-rendering`, `font-family`, `font-weight`, `font-size` | `markerEnd`, `textAnchor`, `strokeWidth`, `strokeLinecap`, `strokeLinejoin`, `strokeOpacity`, `strokeDasharray`, `shapeRendering`, `fontFamily`, `fontWeight`, `fontSize` |
| `tabindex`, `maxLength`, `spellcheck` | `tabIndex`, `maxLength`, `spellCheck` |
| `rows="5"` | `rows={5}` |

Arc component imports (relative to a file in `web/app/`):

```ts
import { Button } from './components/arc/button/button';
import { Badge } from './components/arc/badge/badge';
import { Input } from './components/arc/input/input';
import { Textarea } from './components/arc/textarea/textarea';
import { Select } from './components/arc/select/select';
import { Checkbox } from './components/arc/checkbox/checkbox';
import { Switch } from './components/arc/switch/switch';
import SegmentedControl from './components/arc/segmented-control/segmented-control';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/arc/tabs/tabs';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { Drawer, DrawerContent, useDrawerItem } from './components/arc/drawer/drawer';
import { EmptyState } from './components/arc/empty-state/empty-state';
import { Skeleton } from './components/arc/skeleton/skeleton';
import { Tooltip } from './components/arc/tooltip/tooltip';
import { CodeBlock } from './components/arc/code-block/code-block';
import { CopyButton } from './components/arc/copy-button/copy-button';
import { JsonViewer } from './components/arc/json-viewer/json-viewer';
import { Timeline, type TimelineEvent } from './components/arc/timeline/timeline';
import { Stepper } from './components/arc/stepper/stepper';
import { RadioCards } from './components/arc/radio-cards/radio-cards';
import { ChatThread } from './components/arc/chat-thread/chat-thread';
import { Accordion } from './components/arc/accordion/accordion';
import { Card } from './components/arc/card/card';
import { SortableDataTable, type DataColumn } from './components/arc/sortable-data-table/sortable-data-table';
import { SearchField } from './components/arc/search-field/search-field';
import { CommandPalette, type CommandItem } from './components/arc/command-palette/command-palette';
import { ThemeSwitch } from './components/arc/theme-switch/theme-switch';
import { ToastStackProvider, ToastStack, useToastStack } from './components/arc/toast-stack/toast-stack';
```

Arc API facts the tasks rely on (verified from the registry sources):
- `Input`, `Textarea`, `Select` require a visible `label`. `Select` takes `options: {value,label,disabled?}[]`, `value`, `onValueChange`.
- `Checkbox`/`Switch`: `label`, `checked`, `onCheckedChange(checked: boolean | 'indeterminate')`.
- `SegmentedControl` is a **default** export, controlled only (`options: {value,label}[]`, `value`, `onValueChange`, `label`), and has no `disabled` prop. Its options are `<button aria-pressed>` inside `role="group"`: tests query them with `getByRole('button', { name })`.
- `RadioCards` options are `role="radio"` inside `role="radiogroup"`. `CommandPalette` results are `<button role="option">`.
- `Button`: `variant: 'primary'|'secondary'|'ghost'|'danger'`, `size: 'sm'|'md'|'lg'`, `loading`.
- `Badge`: `tone: 'neutral'|'success'|'info'|'warning'|'danger'`, `size: 'sm'|'md'`.
- `CommandPalette` is an inline panel (no modal, no open prop); it calls `onSelect` without closing and `onClose` on Esc.
- `Dialog`/`DialogContent title description`, `Drawer`/`DrawerContent title side` render their own portal, overlay and close button.
- `Timeline` needs `events`, `now`, `label`; shows newest first; `detail` makes a row expandable.
- `Stepper`: `steps: {id,label,description?,error?}[]`, `current` (index; `steps.length` = complete).
- `RadioCards`: `options: {value,label,description?}[]`, `value`, `onValueChange`, `layout: 'list'|'grid'`.
- `ChatThread`: `participants`, `currentUserId`, `messages`, `composer={false}` for read-only.
- `Accordion`: data-driven `items: {title,content}[]`, `defaultOpen` index (`-1` = closed).
- `SortableDataTable<T extends Record<string, unknown>>`: `rows`, `columns: {key,label,sortable?,render?(value,row),numeric?,width?}[]`, `rowKey`, `caption`, `emptyMessage`.
- `ToastStackProvider` + `<ToastStack/>` + `useToastStack().toast({ type, title, description })`.
- `ThemeSwitch`: controlled `theme`, `onThemeChange(next)`, `iconOnly`; it does not apply the theme.

## Review Focus

- **Radix `Select` given `''` as a value throws at render.** Any select with a "default / none / follow its bot / unsaved" choice must use `NONE`. Builder (agent, fixNode, saved pipelines), Crew (agent) and Triggers (workspace, agent) tests each render that select with the empty choice selected and assert no throw.
- **A live stream event arrives before the `/events` snapshot.** The Solid code dropped the snapshot then (`cur.length ? cur : e`), losing history. `mergeEvents` keeps both, sorted by `seq` and de-duplicated (test in Task 8).
- **Switching runs quickly.** The old run's `EventSource` must close and its late messages must be ignored (test in Task 8).
- **A server that goes away.** `usePoll` must not hammer it (back-off test in Task 1) and the shell must show "offline" (test in Task 12).
- **Typing in a polled table.** Triggers rows refresh every 5 s; rows are keyed by `id` so a focused control keeps focus (test in Task 11 re-polls while a switch has focus).

---

### Task 1: Toolchain, test harness and core hooks

**Files:**
- Modify: `package.json` (devDependencies, `typecheck` script)
- Create: `vitest.config.ts`
- Create: `web/app/tsconfig.json`
- Create: `web/app/api.ts` (copy of `web/src/api.ts`, unchanged)
- Create: `web/app/hooks.ts`
- Create: `web/app/test/setup.ts`
- Test: `web/app/hooks.test.tsx`

**Interfaces:**
- Produces:
  - `usePoll<T>(path: string | null, ms: number): { data: T | undefined; error: string | undefined; refresh: () => Promise<void> }`
  - `BACKOFF_MS = 15_000`, `BACKOFF_AFTER = 3`
  - `type Tab = 'builder' | 'runs' | 'graph' | 'crew' | 'triggers'`, `TABS: Tab[]`, `TAB_LABEL: Record<Tab, string>`
  - `interface Route { tab: Tab; id?: string }`, `parseHash(h: string): Route`, `hashFor(r: Route): string`, `useHashRoute(): [Route, (r: Route) => void]`

- [ ] **Step 1: Create the branch and install dependencies**

```bash
git switch -c feature/web-react-arc
npm install
npm install --save-dev react@19.3.1 react-dom@19.3.1 @types/react@19.3.0 @types/react-dom@19.3.0 @vitejs/plugin-react@6.1.2 @testing-library/react@16.3.3 jsdom@30.1.3
```

- [ ] **Step 2: Add the Vitest projects config**

`vitest.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Two projects: the server tests in node, the React dashboard in jsdom.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'node', include: ['test/**/*.test.ts'], environment: 'node' } },
      {
        plugins: [react()],
        test: { name: 'web', include: ['web/app/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: ['web/app/test/setup.ts'] },
      },
    ],
  },
});
```

- [ ] **Step 3: Add the web app tsconfig and the typecheck script**

`web/app/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "noEmit": true,
    "skipLibCheck": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": [".", "../../src/types.ts"]
}
```

In `package.json` change `typecheck` to:

```json
"typecheck": "tsc --noEmit && tsc --noEmit -p web/tsconfig.json && tsc --noEmit -p web/app/tsconfig.json",
```

Copy the API client: `cp web/src/api.ts web/app/api.ts` (same depth, so its `../../src/types.js` import still resolves).

- [ ] **Step 4: Add the jsdom setup file**

`web/app/test/setup.ts`:

```ts
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom lacks these; Radix, motion and the canvas code call them.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  location.hash = '';
});
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } root = null; rootMargin = ''; thresholds = []; }
globalThis.ResizeObserver ??= Observer as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= Observer as unknown as typeof IntersectionObserver;
Element.prototype.scrollIntoView ??= function () {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
document.elementFromPoint ??= () => null;
```

- [ ] **Step 5: Write the failing hook tests**

`web/app/hooks.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { BACKOFF_MS, hashFor, parseHash, usePoll, useHashRoute } from './hooks';

const apiMock = vi.mocked(api);

describe('usePoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMock.mockReset();
  });

  it('fetches now and then every interval', async () => {
    apiMock.mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => usePoll<{ n: number }>('/api/x', 1000));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.data).toEqual({ n: 1 });
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(apiMock).toHaveBeenCalledTimes(4);
    expect(apiMock).toHaveBeenCalledWith('GET', '/api/x');
  });

  it('keeps the last good value and exposes the error', async () => {
    apiMock.mockResolvedValueOnce({ n: 1 }).mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => usePoll<{ n: number }>('/api/x', 1000));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.data).toEqual({ n: 1 });
    expect(result.current.error).toBe('down');
  });

  it('backs off after three failures and recovers after a success', async () => {
    apiMock.mockRejectedValue(new Error('down'));
    renderHook(() => usePoll('/api/x', 1000));
    await act(() => vi.advanceTimersByTimeAsync(2000)); // calls at 0, 1000, 2000 -> 3 failures
    expect(apiMock).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(BACKOFF_MS - 1));
    expect(apiMock).toHaveBeenCalledTimes(3);
    apiMock.mockResolvedValue({});
    await act(() => vi.advanceTimersByTimeAsync(1)); // 4th call succeeds
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(apiMock).toHaveBeenCalledTimes(5);
  });

  it('does nothing while the path is null', async () => {
    renderHook(() => usePoll(null, 1000));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('ignores a reply for a path it no longer polls', async () => {
    let resolveOld!: (v: unknown) => void;
    apiMock.mockImplementationOnce(() => new Promise((r) => (resolveOld = r))).mockResolvedValue({ which: 'new' });
    const { result, rerender } = renderHook(({ p }) => usePoll<{ which: string }>(p, 1000), { initialProps: { p: '/api/old' } });
    rerender({ p: '/api/new' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    resolveOld({ which: 'old' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.data).toEqual({ which: 'new' });
  });
});

describe('hash routes', () => {
  it('parses and formats', () => {
    expect(parseHash('#/runs/r-1')).toEqual({ tab: 'runs', id: 'r-1' });
    expect(parseHash('#/crew')).toEqual({ tab: 'crew' });
    expect(parseHash('')).toEqual({ tab: 'builder' });
    expect(parseHash('#/nope')).toEqual({ tab: 'builder' });
    expect(hashFor({ tab: 'builder', id: 'my flow' })).toBe('#/builder/my%20flow');
    expect(parseHash(hashFor({ tab: 'builder', id: 'my flow' }))).toEqual({ tab: 'builder', id: 'my flow' });
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
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run --project web web/app/hooks.test.tsx`
Expected: FAIL, "Failed to resolve import './hooks'".

- [ ] **Step 7: Implement the hooks**

`web/app/hooks.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export const BACKOFF_MS = 15_000;
export const BACKOFF_AFTER = 3;

export interface Poll<T> {
  data: T | undefined;
  error: string | undefined;
  refresh: () => Promise<void>;
}

/** GET `path` now and every `ms`. Keeps the last good value; after three failures in a row waits 15 s between tries. `null` pauses. */
export function usePoll<T>(path: string | null, ms: number): Poll<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const fails = useRef(0);
  const current = useRef(path);
  current.current = path;

  const tick = useCallback(async () => {
    const p = current.current;
    if (!p) return;
    try {
      const d = await api<T>('GET', p);
      if (current.current !== p) return;
      fails.current = 0;
      setError(undefined);
      setData(d);
    } catch (e) {
      if (current.current !== p) return;
      fails.current++;
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      await tick();
      if (!stopped) timer = setTimeout(loop, fails.current >= BACKOFF_AFTER ? BACKOFF_MS : ms);
    };
    void loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [path, ms, tick]);

  return { data, error, refresh: tick };
}

export type Tab = 'builder' | 'runs' | 'graph' | 'crew' | 'triggers';
export const TABS: Tab[] = ['builder', 'runs', 'graph', 'crew', 'triggers'];
export const TAB_LABEL: Record<Tab, string> = { builder: 'Builder', runs: 'Runs', graph: 'Graph', crew: 'Crew', triggers: 'Triggers' };

export interface Route {
  tab: Tab;
  /** Runs: the run id. Builder: a saved workflow name to open. */
  id?: string;
}

export function parseHash(h: string): Route {
  const [t, id] = h.replace(/^#\/?/, '').split('/');
  const tab = (TABS as string[]).includes(t ?? '') ? (t as Tab) : 'builder';
  return id ? { tab, id: decodeURIComponent(id) } : { tab };
}

export const hashFor = (r: Route): string => (r.id ? `#/${r.tab}/${encodeURIComponent(r.id)}` : `#/${r.tab}`);

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r: Route) => {
    location.hash = hashFor(r);
    setRoute(r);
  }, []);
  return [route, go];
}
```

- [ ] **Step 8: Run the tests and the existing suite**

Run: `npx vitest run --project web web/app/hooks.test.tsx && npm test && npm run typecheck`
Expected: all PASS (the node project still runs every server test).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts web/app
git commit -m "web: React toolchain, jsdom test project, usePoll and hash routes"
```

---

### Task 2: Arc components, theme bridge and theme hook

**Files:**
- Create: `scripts/arc-add.mjs`
- Create: `web/app/components/arc/**` (generated, committed) and `web/app/components/arc/LICENSE`
- Create: `web/app/theme.css`, `web/app/theme.ts`
- Create: `web/app/styles.css` (copy of `web/src/styles.css` without its first two `:root` blocks)
- Modify: `package.json` (Arc runtime deps)
- Test: `test/arc-add.test.ts`, `web/app/theme.test.ts`, `web/app/arc.test.tsx`

**Interfaces:**
- Produces:
  - `targetPath(root: string, target: string): string`, `itemUrl(ref: string): string` (from `scripts/arc-add.mjs`)
  - `type Theme = 'light' | 'dark'`, `initialTheme(): Theme`, `applyTheme(t: Theme): void`, `useTheme(): [Theme, (t: Theme) => void]`

- [ ] **Step 1: Write the failing script test**

`test/arc-add.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs dev script without types
import { itemUrl, targetPath } from '../scripts/arc-add.mjs';

describe('arc-add', () => {
  it('maps registry targets under the arc folder', () => {
    expect(targetPath('/r', '@components/arc/tabs/tabs.tsx')).toBe(join('/r', 'tabs/tabs.tsx'));
    expect(targetPath('/r', '@components/arc/lib/motion-tokens.ts')).toBe(join('/r', 'lib/motion-tokens.ts'));
  });
  it('refuses targets outside the arc folder', () => {
    expect(() => targetPath('/r', '@components/arc/../../etc/x')).toThrow(/unsafe/);
    expect(() => targetPath('/r', '@components/other/x.tsx')).toThrow(/unexpected/);
  });
  it('builds item urls', () => {
    expect(itemUrl('tabs')).toBe('https://uiarc.dev/r/tabs.json');
    expect(itemUrl('https://uiarc.dev/r/button.json')).toBe('https://uiarc.dev/r/button.json');
  });
});
```

Run: `npx vitest run --project node test/arc-add.test.ts`
Expected: FAIL, cannot find `../scripts/arc-add.mjs`.

- [ ] **Step 2: Write the script**

`scripts/arc-add.mjs`:

```js
#!/usr/bin/env node
// Dev-time only: copies Arc (uiarc.dev, MIT) registry items into web/app/components/arc/.
// The dashboard never fetches anything from uiarc.dev at build or run time; the copied files are committed.
// Usage: node scripts/arc-add.mjs tabs button ...
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const REGISTRY = 'https://uiarc.dev/r/';
const PREFIX = '@components/arc/';
export const OUT_DIR = ['web', 'app', 'components', 'arc'];

export function targetPath(root, target) {
  if (!target.startsWith(PREFIX)) throw new Error(`unexpected target ${target}`);
  const rel = normalize(target.slice(PREFIX.length));
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`unsafe target ${target}`);
  return join(root, rel);
}

export const itemUrl = (ref) => (ref.startsWith('https://') ? ref : `${REGISTRY}${ref}.json`);

async function main(names) {
  if (!names.length) throw new Error('usage: node scripts/arc-add.mjs <item> [item...]');
  const root = join(process.cwd(), ...OUT_DIR);
  const seen = new Set();
  const deps = new Set();
  const queue = names.map(itemUrl);
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    if (!url.startsWith(REGISTRY)) throw new Error(`refusing a registry outside uiarc.dev: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const item = await res.json();
    for (const d of item.dependencies ?? []) deps.add(d);
    for (const r of item.registryDependencies ?? []) queue.push(itemUrl(r));
    for (const f of item.files ?? []) {
      const out = targetPath(root, f.target);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, f.content);
      console.log('wrote', out.slice(process.cwd().length + 1));
    }
  }
  console.log(`\nnpm dependencies: ${[...deps].sort().join(' ') || '(none)'}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
```

Run: `npx vitest run --project node test/arc-add.test.ts`
Expected: PASS.

- [ ] **Step 3: Fetch the Arc components and their dependencies**

```bash
node scripts/arc-add.mjs arc-foundation tabs tooltip toast-stack badge command-palette timeline stepper code-block json-viewer dialog empty-state radio-cards segmented-control chat-thread drawer switch select input textarea button card accordion sortable-data-table theme-switch checkbox search-field skeleton
curl -fsSL https://raw.githubusercontent.com/kuratlielia/arc-library/HEAD/LICENSE -o web/app/components/arc/LICENSE
```

The script prints a final `npm dependencies:` line. Install exactly that list as runtime dependencies (expected: `@radix-ui/react-accordion @radix-ui/react-checkbox @radix-ui/react-dialog @radix-ui/react-select @radix-ui/react-switch @radix-ui/react-tabs @radix-ui/react-tooltip lucide-react motion`):

```bash
npm install --save-dev <the printed list>
```

(They go in devDependencies like `solid-js` does today: the web bundle is built, not shipped as a package.)

Check nothing reaches the network at run time:

```bash
grep -rnE "fetch\(|XMLHttpRequest|sendBeacon|https?://" web/app/components/arc --include=*.ts --include=*.tsx | grep -v "www.w3.org/2000/svg"
```

Expected: no output other than doc comments. Any real call site: stop and report it.

- [ ] **Step 4: Write the failing theme and Arc smoke tests**

`web/app/theme.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, initialTheme } from './theme';

describe('theme', () => {
  beforeEach(() => localStorage.clear());
  it('prefers the saved choice', () => {
    localStorage.setItem('aorch.theme', 'light');
    expect(initialTheme()).toBe('light');
  });
  it('falls back to the system setting', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('light'), media: q, addEventListener() {}, removeEventListener() {} }));
    expect(initialTheme()).toBe('light');
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
    expect(initialTheme()).toBe('dark');
  });
  it('sets theme and accent on the root element', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.accent).toBe('violet');
  });
});
```

`web/app/arc.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { Button } from './components/arc/button/button';
import { Tabs, TabsList, TabsTrigger } from './components/arc/tabs/tabs';

it('renders Arc components under jsdom', () => {
  function Demo() {
    const [v, setV] = useState('a');
    return (
      <>
        <Tabs value={v} onValueChange={setV}>
          <TabsList aria-label="demo">
            <TabsTrigger value="a">A</TabsTrigger>
            <TabsTrigger value="b">B</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button>value {v}</Button>
      </>
    );
  }
  render(<Demo />);
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'B' }));
  fireEvent.click(screen.getByRole('tab', { name: 'B' }));
  expect(screen.getByRole('button', { name: /value/ }).textContent).toContain('value b');
});
```

Run: `npx vitest run --project web web/app/theme.test.ts web/app/arc.test.tsx`
Expected: theme test FAILS (no `./theme`); the Arc smoke test PASSES (if it fails, the jsdom setup is missing a shim: add it to `test/setup.ts`, do not edit Arc files).

- [ ] **Step 5: Implement the theme hook and the CSS bridge**

`web/app/theme.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'aorch.theme';

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Arc's foundation.css keys its palettes on these two attributes. */
export function applyTheme(t: Theme): void {
  const el = document.documentElement;
  el.dataset.theme = t;
  el.dataset.accent = 'violet';
  el.style.colorScheme = t;
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const set = useCallback((t: Theme) => {
    setTheme(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* storage unavailable */
    }
  }, []);
  return [theme, set];
}
```

`web/app/theme.css`:

```css
/* aorch's own tokens, now driven by Arc's foundation (components/arc/foundation.css), so the hand-built
   pieces (canvas, graph, diff) follow the same light/dark theme as the Arc components.
   --border and --accent are Arc's own names and need no mapping. */
:root {
  --bg: var(--background);
  --panel: var(--surface);
  --panel-2: var(--surface-muted);
  --text: var(--foreground);
  --muted: var(--text-secondary);
  --accent-fg: var(--accent-foreground);
  --done: var(--success);
  --run: var(--accent);
  --wait: var(--warning);
  --err: var(--danger);
  --queued: var(--text-muted);
  --skip: var(--border-strong);
  --grid: var(--border-subtle);
  --shadow: var(--shadow-raised);
  --sans: var(--font-body);
  --mono: ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
}
body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-body);
}
```

Create `web/app/styles.css` as a copy of `web/src/styles.css` with its first `:root { … }` block and the `@media (prefers-color-scheme: light) { :root { … } }` block removed (lines 1–40 today); every other rule stays.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run --project web && npm run typecheck`
Expected: PASS. If `tsc -p web/app/tsconfig.json` reports errors inside `components/arc/`, record them in the commit message and fix only by adding a missing `@types`/dependency, never by editing Arc sources.

- [ ] **Step 7: Commit**

```bash
git add scripts/arc-add.mjs test/arc-add.test.ts web/app package.json package-lock.json
git commit -m "web: vendor Arc free components, theme bridge and theme hook"
```

---

### Task 3: Crew store and bot faces

**Files:**
- Create: `web/app/crew.ts` (data half of `web/src/bots.tsx`)
- Create: `web/app/Face.tsx` (drawing half of `web/src/bots.tsx`)
- Test: `web/app/crew.test.ts`, `web/app/Face.test.tsx`

**Interfaces:**
- Consumes: `api` from `web/app/api.ts`.
- Produces:
  - types `Pixels`, `Look`, `MarkInfo`, `BotDef` (same fields as `web/src/bots.tsx:4-11`)
  - `interface CrewEntry { name: string; title: string; hue: string; pixels?: Pixels; mark?: MarkInfo }`
  - `interface CrewState { crew: Record<string, CrewEntry>; style: string; shapes: Record<string, string[]>; glyphs: Record<string, string[]> }`
  - `MARK_STYLES: string[]`, `getCrew(): CrewState`, `subscribeCrew(f): () => void`, `applyCrew(bots: BotDef[], extra?: { style?: string; shapes?: Record<string, string[]>; glyphs?: Record<string, string[]> }): void`, `loadCrewDefs(force?: boolean): Promise<void>`, `useCrew(): CrewState`, `crewFor(node: { kind: string; role?: string }, crew?: Record<string, CrewEntry>): string`
  - `Sprite(props: { pixels: Pixels; size?: number; label?: string })`, `Mark(props: { style: string; mark: MarkInfo; hue: string; size?: number; label?: string; progress?: number })`, `Face(props: { role: string; size?: number })`

- [ ] **Step 1: Write the failing tests**

`web/app/crew.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { applyCrew, crewFor, getCrew, loadCrewDefs, subscribeCrew, type BotDef } from './crew';

const bot = (id: string, name: string): BotDef => ({ id, name, title: id, kind: 'agent', persona: '', look: { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: '#123456', accent: 'auto' } });

describe('crewFor', () => {
  it('maps nodes to bots like the terminal does', () => {
    const crew = getCrew().crew;
    expect(crewFor({ kind: 'agent', role: 'reviewer' }, crew)).toBe('reviewer');
    expect(crewFor({ kind: 'agent', role: 'orchestrator' }, crew)).toBe('coder');
    expect(crewFor({ kind: 'gate' }, crew)).toBe('tester');
    expect(crewFor({ kind: 'approval' }, crew)).toBe('approval');
    expect(crewFor({ kind: 'agent', role: 'qa-bot' }, crew)).toBe('tester');
    expect(crewFor({ kind: 'agent', role: 'security audit' }, crew)).toBe('reviewer');
    expect(crewFor({ kind: 'agent', role: 'designer' }, crew)).toBe('architect');
    expect(crewFor({ kind: 'agent', role: 'research' }, crew)).toBe('planner');
    expect(crewFor({ kind: 'agent', role: 'whatever' }, crew)).toBe('coder');
  });
});

describe('crew store', () => {
  beforeEach(() => vi.mocked(api).mockReset());
  it('notifies subscribers on apply', () => {
    const f = vi.fn();
    const off = subscribeCrew(f);
    applyCrew([bot('coder', 'Bolt'), bot('scribe', 'Quill')], { style: 'sigil' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(getCrew().crew.scribe?.name).toBe('Quill');
    expect(getCrew().style).toBe('sigil');
    off();
  });
  it('keeps the current crew when loading fails', async () => {
    applyCrew([bot('coder', 'Bolt')]);
    vi.mocked(api).mockRejectedValue(new Error('down'));
    await loadCrewDefs(true);
    expect(getCrew().crew.coder?.name).toBe('Bolt');
  });
});
```

`web/app/Face.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { applyCrew, type BotDef } from './crew';
import { Face } from './Face';

const look = { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: '#3fb97c', accent: 'auto' };
const coder: BotDef = { id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: '', look, pixels: { grid: ['#.', '.#'], colors: { '#': '#3fb97c' } }, mark: { shape: 'bolt', symbol: 'BLT', initials: 'BO' } };

it('draws the pixel look in the pebble style', () => {
  applyCrew([coder], { style: 'pebble' });
  const { container } = render(<Face role="coder" size={40} />);
  expect(screen.getByRole('img', { name: 'Bolt' })).toBeTruthy();
  expect(container.querySelectorAll('rect')).toHaveLength(2);
});

it('draws initials in the orbit style', () => {
  applyCrew([coder], { style: 'orbit' });
  render(<Face role="coder" />);
  expect(screen.getByRole('img', { name: 'Bolt' }).textContent).toContain('BO');
});

it('falls back to the coder for an unknown role', () => {
  applyCrew([coder], { style: 'pebble' });
  render(<Face role="nobody" />);
  expect(screen.getByRole('img', { name: 'Bolt' })).toBeTruthy();
});
```

Run: `npx vitest run --project web web/app/crew.test.ts web/app/Face.test.tsx`
Expected: FAIL, cannot resolve `./crew`.

- [ ] **Step 2: Implement the store**

`web/app/crew.ts` (copy the four type declarations from `web/src/bots.tsx:4-11` verbatim at the top):

```ts
import { useSyncExternalStore } from 'react';
import { api } from './api';

// Pixels, Look, MarkInfo, BotDef: copied verbatim from web/src/bots.tsx:4-11

export interface CrewEntry { name: string; title: string; hue: string; pixels?: Pixels; mark?: MarkInfo }
export interface CrewState { crew: Record<string, CrewEntry>; style: string; shapes: Record<string, string[]>; glyphs: Record<string, string[]> }

export const MARK_STYLES = ['sigil', 'tile', 'ticker', 'orbit'];

const BUILTIN: Record<string, CrewEntry> = {
  orchestrator: { name: 'Maestro', title: 'orchestrator', hue: '#9b7bff' },
  planner: { name: 'Scout', title: 'planner', hue: '#5b9dff' },
  architect: { name: 'Brick', title: 'architect', hue: '#38c5d6' },
  coder: { name: 'Bolt', title: 'coder', hue: '#3fb97c' },
  tester: { name: 'Probe', title: 'tester', hue: '#e3ab3a' },
  reviewer: { name: 'Lens', title: 'reviewer', hue: '#e46fa8' },
  approval: { name: 'Gate', title: 'approver', hue: '#9aa6b8' },
};

let state: CrewState = { crew: BUILTIN, style: 'pebble', shapes: {}, glyphs: {} };
const subscribers = new Set<() => void>();

export const getCrew = (): CrewState => state;
export function subscribeCrew(f: () => void): () => void {
  subscribers.add(f);
  return () => subscribers.delete(f);
}

/** Replace the live crew (the server's list, so your own bots appear everywhere a bot does). */
export function applyCrew(bots: BotDef[], extra?: { style?: string; shapes?: Record<string, string[]>; glyphs?: Record<string, string[]> }): void {
  const crew: Record<string, CrewEntry> = {};
  for (const b of bots) crew[b.id] = { name: b.name, title: b.title, hue: b.look.color, pixels: b.pixels, mark: b.mark };
  state = { crew, style: extra?.style ?? state.style, shapes: extra?.shapes ?? state.shapes, glyphs: extra?.glyphs ?? state.glyphs };
  for (const f of subscribers) f();
}

let loaded: Promise<void> | undefined;
/** Fetch the crew once (and again when `force`). Failures leave the current crew in place. */
export function loadCrewDefs(force = false): Promise<void> {
  if (!loaded || force) {
    loaded = api<{ bots: BotDef[]; style?: string; shapes?: Record<string, string[]>; glyphs?: Record<string, string[]> }>('GET', '/api/crew')
      .then((r) => applyCrew(r.bots, r))
      .catch(() => undefined);
  }
  return loaded;
}

export const useCrew = (): CrewState => useSyncExternalStore(subscribeCrew, getCrew);

/** Same mapping as the terminal's crewFor: which bot runs a given node. */
export function crewFor(node: { kind: string; role?: string }, crew: Record<string, CrewEntry> = state.crew): string {
  const named = (node.role ?? '').toLowerCase();
  if (named in crew && named !== 'orchestrator') return named;
  if (node.kind === 'gate') return 'tester';
  if (node.kind === 'approval') return 'approval';
  if (/test|qa/.test(named)) return 'tester';
  if (/review|audit/.test(named)) return 'reviewer';
  if (/arch|design/.test(named)) return 'architect';
  if (/plan|research|spec/.test(named)) return 'planner';
  return 'coder';
}
```

- [ ] **Step 3: Implement the faces**

`web/app/Face.tsx`: port `Sprite`, `ink`, `spark` and `Mark` from `web/src/bots.tsx:63-145` with the porting rules (nested `<Show>` chains become a `switch (props.style)` returning one `<svg>` per style: `'sigil'`, `'tile'`, `'ticker'`, default = orbit). `shapes` and `glyphs` come from `useCrew()`. `Pebble` is renamed `Face`:

```tsx
export function Face(props: { role: string; size?: number }) {
  const { crew, style } = useCrew();
  const c = crew[props.role] ?? crew.coder ?? { name: 'Bolt', title: 'coder', hue: '#3fb97c' };
  const size = props.size ?? 40;
  if (MARK_STYLES.includes(style) && c.mark) return <Mark style={style} mark={c.mark} hue={c.hue} size={size} label={c.name} />;
  if (c.pixels) return <Sprite pixels={c.pixels} size={size} label={c.name} />;
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} role="img" aria-label={c.name}>
      <path d="M16 3c7 0 12.5 5 12.5 12.5 0 7.6-5 13.5-12.5 13.5S3.5 23.1 3.5 15.5C3.5 8 9 3 16 3z" fill={c.hue} />
      <circle cx="11.5" cy="18.5" r="1.9" fill="#0d1117" />
      <circle cx="20.5" cy="18.5" r="1.9" fill="#0d1117" />
    </svg>
  );
}
```

`Sprite` key per rect: `` `${x}-${y}` ``.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run --project web web/app/crew.test.ts web/app/Face.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/crew.ts web/app/Face.tsx web/app/crew.test.ts web/app/Face.test.tsx
git commit -m "web: crew store and bot faces for React"
```

---

### Task 4: Shared UI pieces, test helpers and the command menu

**Files:**
- Create: `web/app/ui/cn.ts`, `web/app/ui/ConfirmButton.tsx`, `web/app/ui/notify.ts`, `web/app/ui/Diff.tsx`
- Create: `web/app/CommandMenu.tsx`
- Create: `web/app/test/fixtures.ts`, `web/app/test/render.tsx`
- Test: `web/app/ui/ui.test.tsx`, `web/app/CommandMenu.test.tsx`

**Interfaces:**
- Consumes: `usePoll`, `Tab`, `TABS`, `TAB_LABEL`, `Route` (Task 1); `RunRow` from `api.ts`.
- Produces:
  - `cn(...parts: (string | false | null | undefined | Record<string, boolean>)[]): string`, `NONE = '__none'`, `fromNone(v: string): string`
  - `ConfirmButton(props: { label: string; prompt: string; confirmLabel: string; onConfirm: () => void | Promise<unknown>; variant?: 'danger' | 'secondary'; disabled?: boolean })`
  - `useNotify(): { ok(title: string, description?: string): void; info(title: string): void; fail(e: unknown): void }`
  - `Diff(props: { text: string })`
  - `CommandMenu(props: { open: boolean; onOpenChange: (o: boolean) => void; onGo: (r: Route) => void })`
  - Test helpers: `routeApi(routes: Record<string, unknown>)`, `makeRun(o?: Partial<RunView>): RunView`, `makeRow(o?: Partial<RunRow>): RunRow`, `FakeEventSource`, `renderApp(ui: ReactElement)`

- [ ] **Step 1: Write the test helpers**

`web/app/test/fixtures.ts`:

```ts
import { vi } from 'vitest';
import { api, type RunRow, type RunView } from '../api';

type Handler = unknown | ((body: unknown, path: string) => unknown);

/**
 * Answer `api(method, path, body)` from a table keyed "METHOD /path" (exact, then without the query string).
 * A handler may be a value, an Error (thrown) or a function of the body. Unknown routes throw.
 * The calling test file must `vi.mock('../api', …)` (or './api') with `api: vi.fn()`.
 */
export function routeApi(routes: Record<string, Handler>) {
  vi.mocked(api).mockImplementation(async (method: string, path: string, body?: unknown) => {
    const exact = `${method} ${path}`;
    const bare = `${method} ${path.split('?')[0]}`;
    const h = exact in routes ? routes[exact] : bare in routes ? routes[bare] : undefined;
    if (h === undefined) throw new Error(`no route for ${exact}`);
    const v = typeof h === 'function' ? (h as (b: unknown, p: string) => unknown)(body, path) : h;
    if (v instanceof Error) throw v;
    if (v instanceof Promise) return v as never;
    return structuredClone(v) as never;
  });
}

export const calls = (method: string, path: string) => vi.mocked(api).mock.calls.filter((c) => c[0] === method && c[1] === path);

export function makeRun(o: Partial<RunView> = {}): RunView {
  return {
    id: 'r1', status: 'running', live: true, task: 'Add rate limiting', repo: '/repo', workdir: '/wt', baseSha: 'abc', branch: 'aorch/r1',
    autoApprove: false, kind: 'workflow', mode: 'live', planning: false, round: 0, pending: [], answers: [], setupDone: true, setupArtifacts: [],
    spawned: 0, costUsd: 0.12, startedAt: Date.now() - 60_000, notes: [], actions: [],
    pipeline: {
      name: 'plan-code-review', version: 1, mode: 'pipeline', settings: { parallel: 4, nodeTimeoutMs: 1_800_000, pipeMode: 'ancestors' },
      nodes: [
        { id: 'plan', kind: 'agent', role: 'planner', x: 0, y: 0, readOnly: true },
        { id: 'code', kind: 'agent', role: 'coder', x: 260, y: 0 },
        { id: 'gate', kind: 'gate', command: 'npm test', x: 520, y: 0, fixNode: 'code' },
      ],
      edges: [{ from: 'plan', to: 'code' }, { from: 'code', to: 'gate' }],
    },
    nodes: {
      plan: { status: 'done', attempts: 1, costUsd: 0.05, loops: 0, output: 'the plan' },
      code: { status: 'running', attempts: 1, costUsd: 0.07, loops: 0, live: 'editing…' },
      gate: { status: 'queued', attempts: 0, costUsd: 0, loops: 0 },
    },
    ...o,
  } as RunView;
}

export function makeRow(o: Partial<RunRow> = {}): RunRow {
  return { id: 'r1', pipeline: 'plan-code-review', task: 'Add rate limiting', repo: '/repo', status: 'running', startedAt: Date.now() - 60_000, costUsd: 0.12, live: true, nodes: {}, kind: 'workflow', mode: 'live', pending: 0, planReady: false, ...o };
}

/** Stand-in for EventSource: tests push `state` / `event` messages with emit(). */
export class FakeEventSource {
  static all: FakeEventSource[] = [];
  closed = false;
  private listeners: Record<string, ((m: MessageEvent) => void)[]> = {};
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, f: (m: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(f);
  }
  emit(type: string, data: unknown) {
    for (const f of this.listeners[type] ?? []) f(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
  close() {
    this.closed = true;
  }
}
```

`web/app/test/render.tsx`:

```tsx
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { ToastStack, ToastStackProvider } from '../components/arc/toast-stack/toast-stack';

function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastStackProvider>
      {children}
      <ToastStack />
    </ToastStackProvider>
  );
}

/** Render inside the providers the app shell supplies (toasts). `rerender` keeps them. */
export const renderApp = (ui: ReactElement) => render(ui, { wrapper: Providers });
```

- [ ] **Step 2: Write the failing UI tests**

`web/app/ui/ui.test.tsx`:

```tsx
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render';
import { ConfirmButton } from './ConfirmButton';
import { cn, fromNone, NONE } from './cn';
import { Diff } from './Diff';
import { useNotify } from './notify';

describe('cn', () => {
  it('joins strings and truthy keys', () => {
    expect(cn('a', false, undefined, { b: true, c: false }, 'd')).toBe('a b d');
    expect(fromNone(NONE)).toBe('');
    expect(fromNone('x')).toBe('x');
  });
});

describe('ConfirmButton', () => {
  it('asks before acting and can be cancelled', async () => {
    const go = vi.fn();
    renderApp(<ConfirmButton label="Delete" prompt="Delete t1?" confirmLabel="Yes, delete" onConfirm={go} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(go).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' })));
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });
});

describe('useNotify', () => {
  it('shows an error toast with the message', async () => {
    function Boom() {
      const n = useNotify();
      return <button onClick={() => n.fail(new Error('server said no'))}>go</button>;
    }
    renderApp(<Boom />);
    await act(async () => fireEvent.click(screen.getByText('go')));
    expect(await screen.findByText('server said no')).toBeTruthy();
  });
});

describe('Diff', () => {
  it('classes diff lines and truncates long diffs', () => {
    const text = ['diff --git a b', '@@ -1 +1 @@', '+added', '-removed', ' same', ...Array(3001).fill('x')].join('\n');
    const { container } = renderApp(<Diff text={text} />);
    expect(container.querySelector('.da')?.textContent).toContain('+added');
    expect(container.querySelector('.dd')?.textContent).toContain('-removed');
    expect(container.textContent).toContain('diff truncated');
  });
});
```

`web/app/CommandMenu.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { CommandMenu } from './CommandMenu';
import { makeRow, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

beforeEach(() => routeApi({ 'GET /api/runs': [makeRow({ id: 'r7', pipeline: 'full-review', task: 'Review PR 12' })], 'GET /api/pipelines': [{ name: 'full-review', nodes: 5 }] }));

it('jumps to tabs, runs and workflows', async () => {
  const go = vi.fn();
  const close = vi.fn();
  renderApp(<CommandMenu open onOpenChange={close} onGo={go} />);
  fireEvent.click(await screen.findByText('Go to Crew'));
  expect(go).toHaveBeenLastCalledWith({ tab: 'crew' });
  expect(close).toHaveBeenLastCalledWith(false);
  await waitFor(() => screen.getByText('Review PR 12'));
  fireEvent.click(screen.getByText('Review PR 12'));
  expect(go).toHaveBeenLastCalledWith({ tab: 'runs', id: 'r7' });
  fireEvent.click(screen.getByText('Open in Builder'));
  expect(go).toHaveBeenLastCalledWith({ tab: 'builder', id: 'full-review' });
});

it('fetches nothing while closed', () => {
  renderApp(<CommandMenu open={false} onOpenChange={() => {}} onGo={() => {}} />);
  expect(screen.queryByText('Go to Crew')).toBeNull();
});
```

Run: `npx vitest run --project web web/app/ui web/app/CommandMenu.test.tsx`
Expected: FAIL, cannot resolve `./ConfirmButton` / `./CommandMenu`.

- [ ] **Step 3: Implement the pieces**

`web/app/ui/cn.ts`:

```ts
type Part = string | false | null | undefined | Record<string, boolean>;

export function cn(...parts: Part[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === 'string') out.push(p);
    else for (const [k, on] of Object.entries(p)) if (on) out.push(k);
  }
  return out.join(' ');
}

/** Radix Select cannot hold '': "none / default / follow" options use this value instead. */
export const NONE = '__none';
export const fromNone = (v: string): string => (v === NONE ? '' : v);
```

`web/app/ui/ConfirmButton.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '../components/arc/button/button';

export interface ConfirmButtonProps {
  label: string;
  prompt: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<unknown>;
  variant?: 'danger' | 'secondary';
  disabled?: boolean;
}

/** A two-step action: the first click asks inline, the second acts. Never a browser dialog. */
export function ConfirmButton(p: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return (
      <Button variant={p.variant ?? 'danger'} size="sm" disabled={p.disabled} onClick={() => setAsking(true)}>
        {p.label}
      </Button>
    );
  return (
    <span className="row confirm" role="group" aria-label={p.prompt}>
      <span className="small">{p.prompt}</span>
      <Button
        variant="danger"
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await p.onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {p.confirmLabel}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}
```

`web/app/ui/notify.ts`:

```ts
import { useMemo } from 'react';
import { useToastStack } from '../components/arc/toast-stack/toast-stack';

/** Toasts for action results. Load failures are shown inline by the screen instead. */
export function useNotify() {
  const { toast } = useToastStack();
  return useMemo(
    () => ({
      ok: (title: string, description?: string) => void toast({ type: 'success', title, description }),
      info: (title: string) => void toast({ type: 'info', title }),
      fail: (e: unknown) => void toast({ type: 'error', title: e instanceof Error ? e.message : String(e) }),
    }),
    [toast],
  );
}
```

`web/app/ui/Diff.tsx`: port `Diff` from `web/src/Runs.tsx:6-20` with the porting rules (keys = line index).

`web/app/CommandMenu.tsx`:

```tsx
import { useMemo } from 'react';
import type { RunRow } from './api';
import { CommandPalette, type CommandItem } from './components/arc/command-palette/command-palette';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { TAB_LABEL, TABS, usePoll, type Route, type Tab } from './hooks';

/** Ctrl/Cmd-K: jump to a tab, a recent run or a saved workflow. Arc's palette is an inline panel, so it sits in a Dialog. */
export function CommandMenu(props: { open: boolean; onOpenChange: (o: boolean) => void; onGo: (r: Route) => void }) {
  const runs = usePoll<RunRow[]>(props.open ? '/api/runs' : null, 10_000);
  const flows = usePoll<{ name: string }[]>(props.open ? '/api/pipelines' : null, 30_000);
  const items = useMemo<CommandItem[]>(
    () => [
      ...TABS.map((t) => ({ id: `tab:${t}`, label: `Go to ${TAB_LABEL[t]}`, group: 'Tabs' })),
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
    if (kind === 'tab') props.onGo({ tab: value as Tab });
    else if (kind === 'run') props.onGo({ tab: 'runs', id: value });
    else props.onGo({ tab: 'builder', id: value });
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <DialogContent title="Jump to" description="Tabs, recent runs and saved workflows">
          <CommandPalette items={items} autoFocus label="Jump to" placeholder="Search tabs, runs, workflows" onSelect={pick} onClose={() => props.onOpenChange(false)} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
```

Note for the test's "Open in Builder" click: the palette renders `description`; click its row.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run --project web && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/ui web/app/CommandMenu.tsx web/app/CommandMenu.test.tsx web/app/test
git commit -m "web: shared confirm button, toasts, diff, test helpers and command menu"
```

---

### Task 5: Canvas

**Files:**
- Create: `web/app/Canvas.tsx` (port of `web/src/Canvas.tsx`, all 291 lines)
- Test: `web/app/Canvas.test.tsx`

**Interfaces:**
- Consumes: `useCrew`, `crewFor` (Task 3); `fmtUsd` from `api.ts`; `cn` (Task 4).
- Produces: `NODE_W = 212`, `NODE_H = 92`, `interface CanvasProps` (identical to `web/src/Canvas.tsx:9-21`), `Canvas(props: CanvasProps)`.

- [ ] **Step 1: Write the failing tests**

`web/app/Canvas.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Canvas } from './Canvas';
import { makeRun } from './test/fixtures';

const run = makeRun();
const nodes = run.pipeline.nodes;
const edges = run.pipeline.edges;

describe('Canvas', () => {
  it('draws nodes, edges and fix loops', () => {
    const { container } = render(<Canvas nodes={nodes} edges={edges} statuses={run.nodes} />);
    expect(container.querySelectorAll('[data-node]')).toHaveLength(3);
    expect(container.querySelectorAll('path.edge')).toHaveLength(2);
    expect(container.textContent).toContain('fix loop 0/2');
    expect(container.textContent).toContain('$ npm test');
  });

  it('selects a node on click and clears on empty canvas click', () => {
    const onSelect = vi.fn();
    const { container } = render(<Canvas nodes={nodes} edges={edges} onSelect={onSelect} />);
    const code = container.querySelector('[data-id="code"] .node-body')!;
    fireEvent.pointerDown(code, { pointerId: 1, clientX: 10, clientY: 10 });
    expect(onSelect).toHaveBeenLastCalledWith('code');
    const canvas = container.querySelector('.canvas')!;
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 5, clientY: 5 });
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });

  it('deletes the selected node with Delete when editable', () => {
    const onDeleteNode = vi.fn();
    const { container } = render(<Canvas editable nodes={nodes} edges={edges} selected="gate" onDeleteNode={onDeleteNode} />);
    fireEvent.keyDown(container.querySelector('.canvas')!, { key: 'Delete' });
    expect(onDeleteNode).toHaveBeenCalledWith('gate');
  });

  it('connects an out port to an in port', () => {
    const onConnect = vi.fn();
    const { container } = render(<Canvas editable nodes={nodes} edges={[]} onConnect={onConnect} />);
    const out = container.querySelector('[data-port-out][data-id="plan"]')!;
    const target = container.querySelector('[data-port-in][data-id="gate"]')!;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
    const canvas = container.querySelector('.canvas')!;
    fireEvent.pointerDown(out, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 300, clientY: 40 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 300, clientY: 40 });
    expect(onConnect).toHaveBeenCalledWith('plan', 'gate');
  });

  it('shows the empty hint without nodes', () => {
    const { container } = render(<Canvas nodes={[]} edges={[]} />);
    expect(container.textContent).toContain('Add a step from the palette');
  });
});
```

Run: `npx vitest run --project web web/app/Canvas.test.tsx`
Expected: FAIL, cannot resolve `./Canvas`.

- [ ] **Step 2: Port the canvas**

Port `web/src/Canvas.tsx` with the porting rules, plus:
- `el` is `useRef<HTMLDivElement>(null)`; `drag` is `useRef<Drag | undefined>(undefined)` (it is never rendered).
- Everything that reads `view()` inside an event handler uses the functional form so stale closures cannot occur, e.g. `setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }))`; `onWheel` becomes `setView((v) => { const k = …; return { k, x: …, y: … }; })`.
- The wheel listener is added in `useEffect(() => { const node = el.current!; node.addEventListener('wheel', onWheel, { passive: false }); return () => node.removeEventListener('wheel', onWheel); }, [])` with `onWheel` defined inside that effect.
- `fit` runs once in `useEffect(() => { requestAnimationFrame(fit); }, [])`.
- Bot name for the agent chip: `const { crew } = useCrew();` then `crew[crewFor(n, crew)]?.name ?? 'bot'`.
- Node class: `cn('node', `s-${st?.status ?? 'idle'}`, `k-${n.kind}`, { selected: props.selected === n.id, issue: !!props.issueNodes?.has(n.id) })`.
- Edge path class: `cn('edge', { sel: selEdge === id, flow: st === 'done' && props.statuses?.[e.to]?.status === 'running' })`.

- [ ] **Step 3: Run tests and typecheck**

Run: `npx vitest run --project web web/app/Canvas.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/app/Canvas.tsx web/app/Canvas.test.tsx
git commit -m "web: port the workflow canvas to React"
```

---

### Task 6: Team panel (question cards, plan approval, mode)

**Files:**
- Create: `web/app/Team.tsx` (port of `web/src/Team.tsx`)
- Test: `web/app/Team.test.tsx`

**Interfaces:**
- Consumes: `RunView`, `Question`, `Answer`, `TeamMode`, `fmtUsd` (`api.ts`); `ConfirmButton` (Task 4).
- Produces:
  - `ModeToggle(props: { mode: TeamMode; onPick: (m: TeamMode) => void; disabled?: boolean })`
  - `TeamPanel(props: { run: RunView; send: (path: 'answers' | 'plan' | 'mode', body: unknown) => Promise<boolean> })`

- [ ] **Step 1: Write the failing tests**

`web/app/Team.test.tsx`:

```tsx
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Question } from './api';
import { TeamPanel } from './Team';
import { makeRun } from './test/fixtures';
import { renderApp } from './test/render';

const q = (id: string, from?: string): Question => ({
  id, ask: `Question ${id}?`, recommended: 'a', allowOther: true, ...(from ? { from } : {}),
  options: [{ id: 'a', label: `Option A of ${id}`, detail: 'the safe one' }, { id: 'b', label: `Option B of ${id}` }],
});
const teamRun = (o = {}) => makeRun({ kind: 'team', planning: true, pipeline: { ...makeRun().pipeline, nodes: [], edges: [] }, nodes: {}, ...o });

describe('TeamPanel', () => {
  it('sends planning answers in one batch once every card has a pick', async () => {
    const send = vi.fn().mockResolvedValue(true);
    renderApp(<TeamPanel run={teamRun({ pending: [q('q1'), q('q2')] })} send={send} />);
    const sendBtn = screen.getByRole('button', { name: 'Send answers' }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Option B of q1/ }));
    fireEvent.change(screen.getAllByLabelText('Or in your own words')[1]!, { target: { value: 'my own' } });
    expect(sendBtn.disabled).toBe(false);
    await act(async () => fireEvent.click(sendBtn));
    expect(send).toHaveBeenCalledWith('answers', { answers: [{ question: 'q1', option: 'b' }, { question: 'q2', text: 'my own' }] });
  });

  it('answers worker questions one at a time and stops at the first failure', async () => {
    const send = vi.fn().mockResolvedValueOnce(false);
    const run = teamRun({ planning: false, pending: [q('w1', 'code'), q('w2', 'code')], userAsks: [{ node: 'code', question: q('w1', 'code'), wait: true }, { node: 'code', question: q('w2', 'code'), wait: true }] });
    renderApp(<TeamPanel run={run} send={send} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use recommendations' })));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('answers', { answers: [{ question: 'w1', option: 'a' }] });
  });

  it('shows the plan and asks before rejecting it', async () => {
    const send = vi.fn().mockResolvedValue(true);
    const plan = { goal: 'Ship rate limiting', success: ['429 with Retry-After'], assignments: [{ bot: 'coder', goal: 'write it', mode: 'write' as const }], limits: { allowWrites: true, maxCostUsd: 5 }, answers: [] };
    renderApp(<TeamPanel run={teamRun({ planning: false, plan })} send={send} />);
    expect(screen.getByText('Ship rate limiting')).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve and start' })));
    expect(send).toHaveBeenLastCalledWith('plan', { approved: true });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, reject' })));
    expect(send).toHaveBeenLastCalledWith('plan', { approved: false });
  });

  it('switches mode', () => {
    const send = vi.fn().mockResolvedValue(true);
    renderApp(<TeamPanel run={teamRun({ planning: false })} send={send} />);
    fireEvent.click(screen.getByRole('button', { name: 'Autonomous' }));
    expect(send).toHaveBeenCalledWith('mode', { mode: 'autonomous' });
  });

  it('forgets picks when the run changes', () => {
    const send = vi.fn().mockResolvedValue(true);
    const { rerender } = renderApp(<TeamPanel run={teamRun({ pending: [q('q1')] })} send={send} />);
    fireEvent.click(screen.getByRole('radio', { name: /Option B of q1/ }));
    expect((screen.getByRole('button', { name: 'Send answers' }) as HTMLButtonElement).disabled).toBe(false);
    rerender(<TeamPanel run={teamRun({ id: 'r2', pending: [q('q1')] })} send={send} />);
    expect((screen.getByRole('button', { name: 'Send answers' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

Run: `npx vitest run --project web web/app/Team.test.tsx`
Expected: FAIL, cannot resolve `./Team`.

- [ ] **Step 2: Port the panel**

Port `web/src/Team.tsx` with the porting rules, plus:
- `ModeToggle` renders `<SegmentedControl label="Team mode" options={MODES.map((m) => ({ value: m.id, label: m.label }))} value={props.mode} onValueChange={(v) => !props.disabled && v !== props.mode && props.onPick(v as TeamMode)} />` (Arc has no `disabled` prop, so changes are ignored while disabled).
- `Card` becomes `QuestionCard`: Arc `RadioCards` with `layout="list"`, `options={q.options.map((o) => ({ value: o.id, label: o.id === q.recommended ? <>{o.label} <Badge tone="info" size="sm">recommended</Badge></> : o.label, description: o.detail }))}`, `value={pick?.option ?? null}`, `onValueChange={(v) => onPick({ option: v })}`, `aria-label={q.ask}`. The "own words" field is Arc `Textarea label="Or in your own words"` with `rows={2}`, `maxLength={2000}`, `value={pick?.text ?? ''}`, `onChange={(e) => onPick(e.target.value ? { text: e.target.value } : undefined)}`.
- Picks reset when the run changes: `useEffect(() => setPicks({}), [props.run.id])`.
- `submit`, `mine`, `recommendations`, `ready`, `planReady`, `active` keep their logic exactly (`web/src/Team.tsx:84-136`), with `setPicks((cur) => …)` functional updates.
- Buttons are Arc `Button`: "Use recommendations" `variant="secondary"`, "Send answers" `variant="primary" loading={busy}`, "Approve and start" `variant="primary"`. The reject pair becomes `<ConfirmButton label="Reject" prompt="Cancel this run?" confirmLabel="Yes, reject" disabled={busy} onConfirm={() => props.send('plan', { approved: false })} />`.
- Plan assignment mode chips are Arc `Badge size="sm"`, tone `warning` for "can edit files", `neutral` for "read only".
- "Dialogue so far": Arc `Accordion` `defaultOpen={-1}` with one item `{ title: `Dialogue so far (${n} answer${n === 1 ? '' : 's'})`, content: <ChatThread … /> }`, where the thread is read-only:

```tsx
const participants = [{ id: 'maestro', name: 'Maestro' }, { id: 'user', name: 'You' }, { id: 'default', name: 'Recommended (auto)' }];
const messages = r.answers.flatMap((a, i) => {
  const card = r.cards?.find((c) => c.id === a.question);
  const said = a.text ?? card?.options.find((o) => o.id === a.option)?.label ?? a.option ?? '';
  const at = r.startedAt + i * 2;
  return [
    { id: `q-${i}`, authorId: 'maestro', text: card?.ask ?? a.question, createdAt: at },
    { id: `a-${i}`, authorId: a.by === 'user' ? 'user' : a.by === 'maestro' ? 'maestro' : 'default', text: said, createdAt: at + 1 },
  ];
});
// <ChatThread participants={participants} currentUserId="user" messages={messages} composer={false} label="Planning dialogue" />
```

- [ ] **Step 3: Run tests and typecheck**

Run: `npx vitest run --project web web/app/Team.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/app/Team.tsx web/app/Team.test.tsx
git commit -m "web: port the team panel to React with Arc radio cards and chat thread"
```

---

### Task 7: Builder

**Files:**
- Create: `web/app/Builder.tsx` (port of `web/src/Builder.tsx`)
- Test: `web/app/Builder.test.tsx`

**Interfaces:**
- Consumes: `Canvas` (Task 5), `ModeToggle` (Task 6), `useCrew`/`crewFor` (Task 3), `useNotify`, `cn`, `NONE`, `fromNone` (Task 4), `api`, `Issue` (`api.ts`), `Pipeline`, `PipelineNode`, `Edge` (`../../src/types`).
- Produces: `Builder(props: { pipeline?: string; onStarted: (runId: string) => void })`.

- [ ] **Step 1: Write the failing tests**

`web/app/Builder.test.tsx`:

```tsx
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { Builder } from './Builder';
import { calls, makeRun, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const pcr = makeRun().pipeline;
const other = { ...pcr, name: 'other', nodes: pcr.nodes.slice(0, 1), edges: [] };

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({
    'GET /api/doctor': { claude: { ok: true }, codex: { ok: false } },
    'GET /api/pipelines': [{ name: 'plan-code-review', nodes: 3 }, { name: 'other', nodes: 1 }],
    'GET /api/pipelines/plan-code-review': { pipeline: pcr },
    'GET /api/pipelines/other': { pipeline: other },
    'POST /api/preflight': { issues: [] },
    'POST /api/runs': { id: 'r42' },
  });
});

describe('Builder', () => {
  it('opens plan-code-review by default, or the workflow it is given', async () => {
    const { unmount } = renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('Pipeline name') as HTMLInputElement).value).toBe('plan-code-review'));
    unmount();
    renderApp(<Builder pipeline="other" onStarted={() => {}} />);
    await waitFor(() => expect((screen.getByLabelText('Pipeline name') as HTMLInputElement).value).toBe('other'));
  });

  it('chains a new step onto the last one and validates once after edits settle', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    // let the load's own validation finish on real timers before faking them
    await waitFor(() => expect(calls('POST', '/api/preflight').length).toBeGreaterThan(0));
    vi.useFakeTimers();
    vi.mocked(api).mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Reviewer/ }));
    fireEvent.change(screen.getByLabelText('Pipeline name'), { target: { value: 'plan-code-review-2' } });
    await act(() => vi.advanceTimersByTimeAsync(350));
    const pre = calls('POST', '/api/preflight');
    expect(pre).toHaveLength(1);
    const body = pre[0]![2] as typeof pcr;
    expect(body.nodes.at(-1)).toMatchObject({ id: 'review', role: 'reviewer', verdict: true });
    expect(body.edges).toContainEqual({ from: 'gate', to: 'review' });
  });

  it('starts a workflow run and a team run with the right body', async () => {
    const onStarted = vi.fn();
    renderApp(<Builder onStarted={onStarted} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    fireEvent.change(screen.getByLabelText(/Git repository/), { target: { value: '/code/app' } });
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Add caching' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start run' })));
    expect(calls('POST', '/api/runs')[0]![2]).toEqual({ pipeline: pcr, task: 'Add caching', repo: '/code/app', autoApprove: false });
    expect(onStarted).toHaveBeenCalledWith('r42');

    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Add caching' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start run' })));
    expect(calls('POST', '/api/runs')[1]![2]).toEqual({ kind: 'team', mode: 'live', task: 'Add caching', repo: '/code/app' });
  });

  it('asks before discarding unsaved changes', async () => {
    renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    fireEvent.change(screen.getByLabelText('Pipeline name'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Pipeline name') as HTMLInputElement).value).toBe('changed');
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect((screen.getByLabelText('Pipeline name') as HTMLInputElement).value).toBe('untitled');
  });

  it('renders the agent select with "follow its bot" chosen without throwing', async () => {
    const { container } = renderApp(<Builder onStarted={() => {}} />);
    await waitFor(() => screen.getByDisplayValue('plan-code-review'));
    fireEvent.pointerDown(container.querySelector('[data-id="code"] .node-body')!, { pointerId: 1 });
    expect(await screen.findByText(/follow .* \(set in Crew\)/)).toBeTruthy();
  });
});
```

Run: `npx vitest run --project web web/app/Builder.test.tsx`
Expected: FAIL, cannot resolve `./Builder`.

- [ ] **Step 2: Port the builder**

Port `web/src/Builder.tsx` with the porting rules, plus:
- `PALETTE`, `BLANK`, `ROLES`, `wouldCycle`, `idBase`, `mut`, `patch`, `addNode`, `connect`, `removeNode`, `save`, `start` keep their logic. `mut` becomes `setPl((cur) => { const p = structuredClone(cur); fn(p); return p; })`; `addNode` calls `setSelected(id)` after `mut`, computing `id` from the current `pl` first.
- `say(m)` and the `.toast` element are removed; messages go through `useNotify()` (`ok` for "Saved …", `fail` for errors, `info` for "Already connected." / "That would create a cycle.").
- Unsaved-change guard replaces `confirm()`:

```tsx
const [pending, setPending] = useState<null | (() => void)>(null);
const guard = (fn: () => void) => (dirty ? setPending(() => fn) : fn());
// <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
//   <DialogContent title="Discard unsaved changes?" description="Your edits to this workflow are not saved.">
//     <div className="row end">
//       <Button variant="secondary" onClick={() => setPending(null)}>Keep editing</Button>
//       <Button variant="danger" onClick={() => { const f = pending; setPending(null); f?.(); }}>Discard</Button>
//     </div>
//   </DialogContent>
// </Dialog>
```

  `pick(name)` = `guard(() => void load(name))`; `fresh()` = `guard(() => { const p = structuredClone(BLANK); setPl(p); setSavedJson(JSON.stringify(p)); setSelected(undefined); })`.
- Initial load: `useEffect` on mount fetches doctor and the list, then loads `props.pipeline ?? 'plan-code-review' ?? first`. A later change of `props.pipeline` runs `guard(() => void load(props.pipeline!))` in `useEffect(…, [props.pipeline])` (skip the first render with a ref).
- Preflight: `useEffect(() => { const h = setTimeout(async () => { try { setIssues((await api<{ issues: Issue[] }>('POST', '/api/preflight', pl)).issues); } catch (e) { setIssues([{ level: 'error', message: (e as Error).message }]); } }, 300); return () => clearTimeout(h); }, [pl]);` (this now cancels properly; the Solid version did not).
- Toolbar: saved-pipelines Arc `Select label="Workflow"` with `options=[{ value: NONE, label: '— unsaved —' }, ...names]`, `value={names.some((n) => n.name === pl.name) ? pl.name : NONE}`, `onValueChange={(v) => v !== NONE && pick(v)}`. Name: Arc `Input label="Pipeline name"`. Save / New / Run are Arc `Button` (`secondary`, `secondary`, `primary`). Issues pill: a `<button>` holding `<Badge tone={errors.length ? 'danger' : issues.length ? 'warning' : 'success'}>`.
- Inspector: `Input`/`Textarea`/`Checkbox`/`Select` from Arc with the same labels as the Solid file. Agent select: `options=[{ value: NONE, label: `follow ${crew[crewFor(n, crew)]?.name ?? 'its bot'} (set in Crew)` }, ...agentIds.map((a) => ({ value: a, label: a + (adapters[a] && !adapters[a].ok ? ' (not installed)' : '') }))]`, `value={n.agent ?? NONE}`, `onValueChange={(v) => patch(n.id, { agent: fromNone(v) || undefined })}`. Fix-node select: `NONE` = "— nobody (fail the run) —", `onValueChange={(v) => patch(n.id, { fixNode: fromNone(v) })}`. Mode select keeps the two disabled options (`disabled: true`). Role keeps a plain Arc `Input` with `list="roles"` and the `<datalist>`.
- Run dialog: Arc `Dialog open={runOpen} onOpenChange={setRunOpen}` + `DialogContent title={teamRun ? 'Start a team run' : `Run “${pl.name}”`}` wrapping the `<form>`. Workflow/Team: `<SegmentedControl label="Run type" options={[{ value: 'workflow', label: 'Workflow' }, { value: 'team', label: 'Team' }]} value={teamRun ? 'team' : 'workflow'} onValueChange={(v) => setTeamRun(v === 'team')} />`. Fields: `Input label="Git repository (absolute path on this machine)"`, `Textarea label="Task"`, `Checkbox label="Auto-approve approval steps (skips the human sign-off)"`. Buttons: Cancel `secondary`, Start run `primary type="submit" loading={busy}`.

- [ ] **Step 3: Run tests and typecheck**

Run: `npx vitest run --project web web/app/Builder.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/app/Builder.tsx web/app/Builder.test.tsx
git commit -m "web: port the workflow builder to React and Arc"
```

---

### Task 8: Run stream and the Runs screen

**Files:**
- Create: `web/app/runStream.ts`
- Create: `web/app/Runs.tsx` (port of `web/src/Runs.tsx:22-298`)
- Test: `web/app/runStream.test.tsx`, `web/app/Runs.test.tsx`

**Interfaces:**
- Consumes: `usePoll` (Task 1), `Canvas` (Task 5), `TeamPanel` (Task 6), `Diff`, `useNotify`, `cn` (Task 4), `api`, `describeEvent`, `fmtUsd`, `fmtDur`, `ago`, `RunRow`, `RunView`, `StoredEvent` (`api.ts`).
- Produces:
  - `mergeEvents(a: StoredEvent[], b: StoredEvent[]): StoredEvent[]`
  - `useRunStream(id: string | undefined): { run: RunView | undefined; setRun: (r: RunView) => void; events: StoredEvent[]; error: string | undefined }`
  - `Runs(props: { selected?: string; onSelect: (id: string) => void })`

- [ ] **Step 1: Write the failing stream tests**

`web/app/runStream.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import type { StoredEvent } from './api';
import { mergeEvents, useRunStream } from './runStream';
import { FakeEventSource, makeRun, routeApi } from './test/fixtures';

const ev = (seq: number, type = 'node.started'): StoredEvent => ({ seq, ts: 1000 + seq, event: { type, node: 'code', attempt: 1 } } as unknown as StoredEvent);

beforeEach(() => {
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

it('merges by seq without duplicates', () => {
  expect(mergeEvents([ev(1), ev(2)], [ev(2), ev(3)]).map((e) => e.seq)).toEqual([1, 2, 3]);
  expect(mergeEvents([ev(3)], [ev(1)]).map((e) => e.seq)).toEqual([1, 3]);
});

it('keeps history when a live event beats the snapshot', async () => {
  let release!: (v: StoredEvent[]) => void;
  routeApi({ 'GET /api/runs/r1/events': () => new Promise<StoredEvent[]>((r) => (release = r)) });
  const { result } = renderHook(() => useRunStream('r1'));
  act(() => FakeEventSource.all[0]!.emit('event', ev(5)));
  await act(async () => release([ev(1), ev(2)]));
  await waitFor(() => expect(result.current.events.map((e) => e.seq)).toEqual([1, 2, 5]));
});

it('follows state, ignores chunks, closes on switch and ignores the old stream', async () => {
  routeApi({ 'GET /api/runs/r1/events': [], 'GET /api/runs/r2/events': [] });
  const { result, rerender } = renderHook(({ id }) => useRunStream(id), { initialProps: { id: 'r1' as string | undefined } });
  const first = FakeEventSource.all[0]!;
  expect(first.url).toBe('/api/runs/r1/stream');
  act(() => first.emit('state', makeRun({ id: 'r1' })));
  act(() => first.emit('event', ev(1, 'node.chunk')));
  expect(result.current.run?.id).toBe('r1');
  expect(result.current.events).toEqual([]);
  rerender({ id: 'r2' });
  expect(first.closed).toBe(true);
  act(() => first.emit('state', makeRun({ id: 'r1' })));
  expect(result.current.run).toBeUndefined();
});
```

Run: `npx vitest run --project web web/app/runStream.test.tsx`
Expected: FAIL, cannot resolve `./runStream`.

- [ ] **Step 2: Implement the stream hook**

`web/app/runStream.ts`:

```ts
import { useEffect, useState } from 'react';
import { api, type RunView, type StoredEvent } from './api';

/** Union by seq, oldest first. */
export function mergeEvents(a: StoredEvent[], b: StoredEvent[]): StoredEvent[] {
  const bySeq = new Map<number, StoredEvent>();
  for (const e of a) bySeq.set(e.seq, e);
  for (const e of b) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((x, y) => x.seq - y.seq);
}

/** Follow one run: the event snapshot plus the live SSE stream (state snapshots and events, chunks skipped). */
export function useRunStream(id: string | undefined) {
  const [run, setRun] = useState<RunView>();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setRun(undefined);
    setEvents([]);
    setError(undefined);
    if (!id) return;
    let closed = false;
    api<StoredEvent[]>('GET', `/api/runs/${id}/events`)
      .then((snap) => !closed && setEvents((cur) => mergeEvents(snap, cur)))
      .catch((e) => !closed && setError((e as Error).message));
    const es = new EventSource(`/api/runs/${id}/stream`);
    es.addEventListener('state', (m) => {
      if (!closed) setRun(JSON.parse((m as MessageEvent).data));
    });
    es.addEventListener('event', (m) => {
      if (closed) return;
      const se = JSON.parse((m as MessageEvent).data) as StoredEvent;
      if (se.event.type === 'node.chunk') return;
      setEvents((cur) => mergeEvents(cur, [se]));
    });
    return () => {
      closed = true;
      es.close();
    };
  }, [id]);

  return { run, setRun, events, error };
}
```

Run: `npx vitest run --project web web/app/runStream.test.tsx`
Expected: PASS.

- [ ] **Step 3: Write the failing Runs tests**

`web/app/Runs.test.tsx`:

```tsx
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { Runs } from './Runs';
import { calls, FakeEventSource, makeRow, makeRun, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const awaitingRun = makeRun({ nodes: { ...makeRun().nodes, gate: { status: 'awaiting', attempts: 0, costUsd: 0, loops: 0 } } });

beforeEach(() => {
  vi.mocked(api).mockReset();
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  routeApi({
    'GET /api/runs': [makeRow(), makeRow({ id: 'r2', task: 'Second task', kind: 'team', pending: 1 })],
    'GET /api/runs/r1/events': [],
    'GET /api/runs/r1/diff': { diff: '+line' },
    'POST /api/runs/r1/approve': makeRun({ status: 'running' }),
    'POST /api/runs/r1/feedback': (b: unknown) => ((b as { rating: string }).rating === 'down' ? new Error('feedback store is read-only') : makeRun()),
  });
});

describe('Runs', () => {
  it('lists runs and selects one', async () => {
    const onSelect = vi.fn();
    renderApp(<Runs onSelect={onSelect} />);
    fireEvent.click(await screen.findByText('Second task'));
    expect(onSelect).toHaveBeenCalledWith('r2');
    expect(screen.getByText('? 1')).toBeTruthy();
  });

  it('follows the selected run live', async () => {
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', makeRun()));
    expect(await screen.findByRole('heading', { name: /plan-code-review/ })).toBeTruthy();
    act(() => FakeEventSource.all[0]!.emit('event', { seq: 1, ts: Date.now(), event: { type: 'run.started' } }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Timeline/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Timeline/ }));
    expect(await screen.findByText('run started')).toBeTruthy();
  });

  it('approves an awaiting step and shows the returned state', async () => {
    renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', awaitingRun));
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Approve' })));
    expect(calls('POST', '/api/runs/r1/approve')[0]![2]).toEqual({ node: 'gate', approved: true });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull());
  });

  it('sends step feedback with its note and toasts failures', async () => {
    const run = makeRun({ status: 'done', live: false });
    const { container } = renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', run));
    fireEvent.pointerDown((await waitFor(() => container.querySelector('[data-id="plan"] .node-body')))!, { pointerId: 1 });
    fireEvent.change(await screen.findByLabelText('Why (optional)'), { target: { value: 'clear plan' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Good' })));
    expect(calls('POST', '/api/runs/r1/feedback')[0]![2]).toEqual({ node: 'plan', rating: 'up', note: 'clear plan' });
    expect((screen.getByLabelText('Why (optional)') as HTMLInputElement).value).toBe('');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Bad' })));
    expect(await screen.findByText('feedback store is read-only')).toBeTruthy();
  });

  it('fetches a step diff once per commit, not on every state update', async () => {
    routeApi({ 'GET /api/runs': [makeRow()], 'GET /api/runs/r1/events': [], 'GET /api/runs/r1/diff?node=plan': { diff: '+x' } });
    const withCommit = makeRun({ nodes: { ...makeRun().nodes, plan: { ...makeRun().nodes.plan!, commit: 'abc1234' } } });
    const { container } = renderApp(<Runs selected="r1" onSelect={() => {}} />);
    act(() => FakeEventSource.all[0]!.emit('state', withCommit));
    fireEvent.pointerDown((await waitFor(() => container.querySelector('[data-id="plan"] .node-body')))!, { pointerId: 1 });
    await waitFor(() => expect(calls('GET', '/api/runs/r1/diff?node=plan')).toHaveLength(1));
    act(() => FakeEventSource.all[0]!.emit('state', { ...withCommit, costUsd: 0.5 }));
    act(() => FakeEventSource.all[0]!.emit('state', { ...withCommit, costUsd: 0.6 }));
    expect(calls('GET', '/api/runs/r1/diff?node=plan')).toHaveLength(1);
  });
});
```

Run: `npx vitest run --project web web/app/Runs.test.tsx`
Expected: FAIL, cannot resolve `./Runs`.

- [ ] **Step 4: Port the Runs screen**

Port `web/src/Runs.tsx:22-298` with the porting rules, plus:
- List: `const [probes, setProbes] = useState(false); const list = usePoll<RunRow[]>(probes ? '/api/runs?all=1' : '/api/runs', 2000); const runs = list.data ?? [];`. The probe checkbox becomes Arc `Switch label="show probe replays"`. Row badges are Arc `Badge size="sm"`: "Team" `info`, "probe" `neutral`, pending/plan `warning`.
- Detail: `const { run, setRun, events, error } = useRunStream(props.selected);`. Reset `selNode`, `diff`, `pane` when `props.selected` changes (`useEffect(…, [props.selected])`).
- Diff effect depends only on what selects a diff: `const commit = selNode ? run?.nodes[selNode]?.commit : undefined;` and `useEffect(() => { … }, [props.selected, selNode, pane, commit, !!run])`; inside, keep the Solid branches (`branch` → `/api/runs/${id}/diff`, node with commit → `?node=`, else `setDiff(undefined)`), and ignore late replies with a `cancelled` flag in the cleanup.
- `act(path, body)` keeps its behaviour but reports failures with `notify.fail(e)` instead of the page alert, and calls `list.refresh()` after success. The stream `error` still shows inline: `<div className="alert error">{error}</div>`.
- No run selected: `<EmptyState title="No run selected" description="Select a run to follow it live." />`. Selected but no state yet: `<Skeleton lines={4} label="Loading run" />`.
- Header status badges: Arc `Badge`, tones `running` → `info`, `done` → `success`, `error` → `danger`, `paused` → `warning`, `stopped` → `neutral`; "interrupted" → `danger`. Stop: `Button variant="danger"`; Resume/Retry: `Button variant="primary"`.
- Pipeline progress, above the graph, when `run.pipeline.nodes.length > 0`: `<Stepper compact label="Steps" steps={run.pipeline.nodes.map((n) => ({ id: n.id, label: n.title ?? n.role ?? n.kind, error: run.nodes[n.id]?.status === 'error' ? (run.nodes[n.id]?.error ?? 'failed') : undefined }))} current={(() => { const i = run.pipeline.nodes.findIndex((n) => !['done', 'skipped'].includes(run.nodes[n.id]?.status ?? '')); return i < 0 ? run.pipeline.nodes.length : i; })()} />`.
- Panes become Arc `Tabs value={pane} onValueChange={(v) => setPane(v as Pane)}` with triggers "Step", "Branch diff", `Timeline (${events.length})` and one `TabsContent` per pane.
- Timeline pane: Arc `Timeline label="Run events" now={Date.now()} maxHeight={480}` with

```ts
const TONE: Record<string, TimelineEvent['tone']> = { done: 'success', error: 'danger' };
const timeline = events.flatMap((e) => {
  const d = describeEvent(e.event, nameOf);
  return d ? [{ id: String(e.seq), at: e.ts, title: d.text, tone: TONE[d.tone] ?? 'neutral', detail: <JsonViewer data={e.event} label="Event" defaultExpandDepth={1} maxHeight={240} /> }] : [];
});
```

- Step pane: agent `output` and gate output use `<CodeBlock code={…} language="text" maxLines={40} />` (gate filename: the command). Live output stays `<pre className="out live">`. Diffs use `Diff` from `ui/Diff`.
- Approvals: each awaiting node renders the `.alert.wait` block with `Button variant="primary"` Approve and `Button variant="danger"` Reject.
- Feedback row: `Input label="Why (optional)" maxLength={500}` and two `Button variant="secondary" size="sm"` (Good / Bad); per-step drafts keep the `fbNotes` map keyed by `` `${props.selected}\0${selNode}` ``.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run --project web web/app/runStream.test.tsx web/app/Runs.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/app/runStream.ts web/app/runStream.test.tsx web/app/Runs.tsx web/app/Runs.test.tsx web/app/test/fixtures.ts
git commit -m "web: port the runs screen with a merged live stream, Arc timeline and stepper"
```

---

### Task 9: Crew and Evolve

**Files:**
- Create: `web/app/Evolve.tsx` (port of `web/src/Evolve.tsx`)
- Create: `web/app/Crew.tsx` (port of `web/src/Crew.tsx`)
- Test: `web/app/Evolve.test.tsx`, `web/app/Crew.test.tsx`

**Interfaces:**
- Consumes: `applyCrew`, `useCrew`, `MARK_STYLES`, `BotDef`, `Pixels` (Task 3); `Face`, `Sprite`, `Mark` (Task 3); `ConfirmButton`, `useNotify`, `NONE`, `fromNone`, `cn` (Task 4).
- Produces: `EvolvePanel(props: { bot: string; name: string; onClose: () => void; onChange?: () => void })`, `Crew()`.

- [ ] **Step 1: Write the failing tests**

`web/app/Evolve.test.tsx`:

```tsx
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { EvolvePanel } from './Evolve';
import { calls, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const edit = (n: number) => ({ n, field: 'guidance', op: 'add', after: `note ${n}`, lessons: [] });
const proposal = (o = {}) => ({ id: 'p1', bot: 'coder', base: 1, status: 'open', label: 'open', createdAt: '2026-10-23T10:00:00Z', stale: false, edits: [edit(1), edit(2)], ...o });
const harness = { bot: 'coder', evolvable: true, current: { version: 1, persona: 'Writes code', guidance: [], skills: [] }, versions: [{ version: 1, at: '2026-10-20T10:00:00Z' }, { version: 2, at: '2026-10-21T10:00:00Z' }], total: 2 };

const routes = (p: unknown) => routeApi({
  'GET /api/harness/coder': harness,
  'GET /api/proposals?bot=coder': { proposals: [p] },
  'GET /api/lessons?bot=coder': { lessons: [] },
  'POST /api/proposals/p1/accept': { harness: { version: 2 } },
  'POST /api/proposals/p1/reject': {},
  'POST /api/harness/coder/rollback': { harness: { version: 3 } },
});

beforeEach(() => vi.mocked(api).mockReset());

it('starts with every edit picked and accepts the picked ones', async () => {
  routes(proposal());
  renderApp(<EvolvePanel bot="coder" name="Bolt" onClose={() => {}} />);
  expect(await screen.findByRole('button', { name: 'Accept all' })).toBeTruthy();
  fireEvent.click(screen.getAllByRole('checkbox')[0]!);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Accept 1 of 2' })));
  expect(calls('POST', '/api/proposals/p1/accept')[0]![2]).toEqual({ pick: [2] });
  expect(await screen.findByText(/harness is now v2/)).toBeTruthy();
});

it('picks nothing when the probe dropped edits', async () => {
  routes(proposal({ composed: { kept: [2], dropped: [1], unprobed: [] } }));
  renderApp(<EvolvePanel bot="coder" name="Bolt" onClose={() => {}} />);
  const accept = (await screen.findByRole('button', { name: /Accept 0 of 2/ })) as HTMLButtonElement;
  expect(accept.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Pick the kept edits' }));
  expect(screen.getByRole('button', { name: 'Accept 1 of 2' })).toBeTruthy();
});

it('asks before rejecting and before rolling back', async () => {
  routes(proposal());
  renderApp(<EvolvePanel bot="coder" name="Bolt" onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, reject' })));
  expect(calls('POST', '/api/proposals/p1/reject')).toHaveLength(1);
  fireEvent.click(screen.getByText(/Versions \(2\)/));
  fireEvent.click(await screen.findByRole('button', { name: 'Roll back to v2' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Roll back' })));
  await waitFor(() => expect(calls('POST', '/api/harness/coder/rollback')[0]![2]).toEqual({ version: 2 }));
});
```

(The harness fixture's current version is 1, so v2 is offered for rollback.)

`web/app/Crew.test.tsx`:

```tsx
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { Crew } from './Crew';
import { calls, routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const look = { body: 'pebble', eyes: 'dots', mouth: 'none', top: 'none', side: 'none', pattern: 'none', color: '#3fb97c', accent: 'auto' };
const bots = [{ id: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', persona: 'Writes the change', look, builtin: true }];

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({
    'GET /api/crew': { bots, packs: [], parts: { body: ['pebble'], eyes: ['dots'], mouth: ['none'], top: ['none'], side: ['none'], pattern: ['none'] }, kinds: [{ kind: 'agent', blurb: 'does a job' }], style: 'pebble', styles: [{ id: 'pebble', blurb: 'pixel bots' }, { id: 'sigil', blurb: 'glyphs' }], shapes: {}, glyphs: {}, evolve: {} },
    'GET /api/bots': { crew: [{ role: 'coder', name: 'Bolt', title: 'coder', kind: 'agent', binding: null }], agents: { claude: { ok: true, models: ['opus'] }, codex: { ok: true, models: [] } } },
    'PUT /api/bots/coder': {},
    'DELETE /api/bots/coder': {},
    'PUT /api/crew/style': {},
    'POST /api/crew/preview': { grid: ['#'], colors: { '#': '#fff' } },
    'PUT /api/crew/quill': {},
  });
});

describe('Crew', () => {
  it('saves a link only when changed; the default agent unlinks (as in the Solid UI)', async () => {
    renderApp(<Crew />);
    expect(await screen.findByText('Bolt')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
    expect(save.disabled).toBe(false);
    await act(async () => fireEvent.click(save));
    // the agent select still shows "default (claude)" (NONE -> ''), and an empty agent means DELETE
    expect(calls('DELETE', '/api/bots/coder')).toHaveLength(1);
    expect(calls('PUT', '/api/bots/coder')).toHaveLength(0);
  });

  it('switches the crew style', async () => {
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: 'sigil' }));
    await waitFor(() => expect(calls('PUT', '/api/crew/style')[0]![2]).toEqual({ style: 'sigil' }));
  });

  it('creates a bot from the editor and debounces the preview', async () => {
    renderApp(<Crew />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New bot' }));
    const name = await screen.findByLabelText('Name');
    vi.mocked(api).mockClear();
    fireEvent.change(name, { target: { value: 'Q' } });
    fireEvent.change(name, { target: { value: 'Qu' } });
    fireEvent.change(name, { target: { value: 'Quill' } });
    await waitFor(() => expect(calls('POST', '/api/crew/preview')).toHaveLength(1));
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!));
    expect(calls('PUT', '/api/crew/quill')[0]![2]).toMatchObject({ id: 'quill', name: 'Quill' });
  });
});
```

Run: `npx vitest run --project web web/app/Evolve.test.tsx web/app/Crew.test.tsx`
Expected: FAIL, cannot resolve `./Evolve` / `./Crew`.

- [ ] **Step 2: Port Evolve**

Port `web/src/Evolve.tsx` with the porting rules, plus:
- Interfaces `LessonRef`, `EditView`, `ProposalView`, `LessonView`, `HarnessView` and `LABEL_TONE` copied verbatim; `LABEL_TONE` maps to Arc Badge tones instead: `{ open: 'info', accepted: 'success', rejected: 'danger', superseded: 'neutral' }`.
- `load`, `toggle`, `run`, `accept`, `reject`, `rollback` keep their logic; `msg` stays as an inline status chip (`<span className="chip" role="status">`) because the tests and the copy depend on it ("…'s harness is now v2; the next run uses it").
- Edit checkboxes: Arc `Checkbox` with `label={`${e.n}. ${e.roleNote ? 'role note' : `${e.field} ${e.op}`}`}`.
- Versions `<details>` becomes Arc `Accordion defaultOpen={-1} items={[{ title: `Versions (${h.total})`, content: … }]}`.
- Reject (both open and stale variants): `<ConfirmButton label="Reject" prompt={`Reject all ${p.edits.length} edits? They will not be proposed again.`} confirmLabel="Yes, reject" disabled={busy} onConfirm={() => reject(p)} />`.
- Rollback per version: `<ConfirmButton variant="secondary" label={`Roll back to v${v.version}`} prompt={`Make a new version that copies v${v.version}?`} confirmLabel="Roll back" disabled={busy} onConfirm={() => rollback(v.version)} />`.
- Accept / Pick the kept edits: Arc `Button` (`primary` / `secondary`). The panel's own Close button is kept (`Button variant="ghost"`).

- [ ] **Step 3: Port Crew**

Port `web/src/Crew.tsx` with the porting rules, plus:
- Style picker: `<SegmentedControl label="Crew style" options={meta.styles.map((s) => ({ value: s.id, label: s.id }))} value={style} onValueChange={(v) => void pickStyle(v)} />` where `style` comes from `useCrew()`.
- `msg` chip is replaced by `useNotify()` (`ok` for the success messages, `fail` for errors).
- Bot cards: the face button renders `<Face role={r.role} size={48} />`. Agent: Arc `Select label="Agent"` with `options=[{ value: NONE, label: 'default (claude)' }, ...Object.keys(agents).map((a) => ({ value: a, label: a + (agents[a].ok ? '' : ' (not available)') }))]`, `value={draft[r.role]?.agent || NONE}`, `onValueChange={(v) => set(r.role, { agent: fromNone(v), model: '' })}`. Model: Arc `Input label="Model"` with `list={`models-${r.role}`}` and its `<datalist>`. Save / Unlink / Evolve: Arc `Button` (`primary` / `secondary` / `secondary`). Version and proposal marks: Arc `Badge size="sm"`.
- `save(r)` keeps the Solid rule: empty agent → `DELETE /api/bots/${role}`, else `PUT` with `{ agent, model }`.
- Bot editor: Arc `Drawer open={!!edit} onOpenChange={(o) => !o && setEdit(null)}` with `DrawerContent side="right" title={isNew ? 'New bot' : `Edit ${shown?.name ?? ''}`}` where `const shown = useDrawerItem(edit)`; fields are Arc `Input label="Name"`, `Input label="Title"`, `Select label="Kind"`, `Textarea label="Persona (becomes this bot's instructions)"`, `Checkbox label="read-only (may not edit files)"`, one `Select` per look part (`label={k}`), the swatch buttons and colour inputs as in Solid. The preview debounce keeps 120 ms with the timer in a `useRef` cleared on unmount.
- Evolve: Arc `Drawer` holding `<EvolvePanel key={evolving.role} bot={…} name={…} onClose={() => setEvolving(null)} onChange={() => void loadDefs()} />`; the Solid `scrollIntoView` calls are dropped (drawers do not need them).
- Packs: each pack is an Arc `Card title={k.name} description={k.blurb} meta={`${k.bots.length} bots`} action={<Button variant="secondary" size="sm" onClick={() => void addPack(k)}>Add to my crew</Button>}` whose children are the sprite/mark row and the names line.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run --project web web/app/Evolve.test.tsx web/app/Crew.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/Evolve.tsx web/app/Evolve.test.tsx web/app/Crew.tsx web/app/Crew.test.tsx
git commit -m "web: port crew and evolve to React with Arc drawers, selects and cards"
```

---

### Task 10: Vault graph

**Files:**
- Create: `web/app/graphLayout.ts` (the `layout` function from `web/src/Graph.tsx:7-61`, plus `W`, `H`)
- Create: `web/app/Graph.tsx` (port of `web/src/Graph.tsx:63-244`)
- Test: `web/app/graphLayout.test.ts`, `web/app/Graph.test.tsx`

**Interfaces:**
- Consumes: `api`, `VaultGraph`, `VaultNote` (`api.ts`); `cn` (Task 4).
- Produces: `W = 1000`, `H = 640`, `layout(nodes: { id: string }[], edges: { from: string; to: string }[]): Map<string, { x: number; y: number }>`, `GraphView()`.

- [ ] **Step 1: Write the failing tests**

`web/app/graphLayout.test.ts`:

```ts
import { expect, it } from 'vitest';
import { layout } from './graphLayout';

const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}` }));
const edges = nodes.slice(1).map((n, i) => ({ from: `n${i}`, to: n.id }));

it('is deterministic and finite', () => {
  const a = layout(nodes, edges);
  const b = layout(nodes, edges);
  expect([...a.entries()]).toEqual([...b.entries()]);
  for (const p of a.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
});

it('handles no nodes and edges to unknown nodes', () => {
  expect(layout([], []).size).toBe(0);
  expect(layout([{ id: 'a' }], [{ from: 'a', to: 'ghost' }]).size).toBe(1);
});
```

`web/app/Graph.test.tsx`:

```tsx
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { GraphView } from './Graph';
import { routeApi } from './test/fixtures';
import { renderApp } from './test/render';

const graph = { nodes: [{ id: 'runs/r1.md', title: 'Run r1', type: 'run', tags: [], degree: 3 }, { id: 'roles/coder.md', title: 'Coder', type: 'role', tags: [], degree: 1 }], edges: [{ from: 'runs/r1.md', to: 'roles/coder.md' }], unresolved: 0 };

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({
    'GET /api/vault/graph': graph,
    'GET /api/vault/note': { path: 'runs/r1.md', title: 'Run r1', type: 'run', tags: [], body: 'body text', links: ['roles/coder'], backlinks: [] },
    'GET /api/vault/search': [{ path: 'roles/coder.md' }],
  });
});

it('draws notes and opens one', async () => {
  renderApp(<GraphView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run r1' }));
  expect(await screen.findByText('body text')).toBeTruthy();
  expect(screen.getByText('2 notes · 1 links · scroll to zoom, drag to pan')).toBeTruthy();
});

it('highlights search hits', async () => {
  const { container } = renderApp(<GraphView />);
  await screen.findByRole('button', { name: 'Run r1' });
  fireEvent.change(screen.getByLabelText('Search the vault'), { target: { value: 'coder' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Search' })));
  await waitFor(() => expect(container.querySelector('.g-node.hit')).toBeTruthy());
  expect(container.querySelectorAll('.g-node.dim')).toHaveLength(1);
});

it('explains an empty vault', async () => {
  routeApi({ 'GET /api/vault/graph': { nodes: [], edges: [], unresolved: 0 } });
  renderApp(<GraphView />);
  expect(await screen.findByText(/The vault is empty/)).toBeTruthy();
});
```

Run: `npx vitest run --project web web/app/graphLayout.test.ts web/app/Graph.test.tsx`
Expected: FAIL, cannot resolve `./graphLayout`.

- [ ] **Step 2: Move the layout and port the view**

`web/app/graphLayout.ts`: `export const W = 1000; export const H = 640;` and `export function layout(…)` copied verbatim from `web/src/Graph.tsx:7-61`.

`web/app/Graph.tsx`: port `GraphView` with the porting rules, plus:
- `pos = useMemo(() => (g ? layout(g.nodes, g.edges) : new Map()), [g])`; `counts` and `neighbors` likewise with `useMemo`.
- `svg = useRef<SVGSVGElement>(null)`; `pan = useRef<…>()`; wheel listener added in `useEffect` with `{ passive: false }` and functional `setView`.
- Toolbar: `<SearchField label="Search the vault" value={q} onValueChange={(v) => { setQ(v); if (!v) setHits(new Set()); }} onKeyDown={(e) => e.key === 'Enter' && void search()} placeholder="Search the vault…" />`, then Arc `Button variant="secondary"` "Search" and "Refresh"; the Solid "Clear" button is dropped because `SearchField` has its own clear control (which calls `onValueChange('')`). Legend counts use Arc `Badge size="sm"`.
- Empty vault: `<EmptyState title="The vault is empty" description="Finish a run and its notes appear here, linked to the pipeline, roles and files it touched." />` (the test matches "The vault is empty").
- Note panel: unchanged markup; the type chip is an Arc `Badge size="sm"`. Empty panel: `<p className="muted pad">Select a note…</p>` as in Solid.

- [ ] **Step 3: Run tests and typecheck**

Run: `npx vitest run --project web web/app/graphLayout.test.ts web/app/Graph.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/app/graphLayout.ts web/app/graphLayout.test.ts web/app/Graph.tsx web/app/Graph.test.tsx
git commit -m "web: port the vault graph to React"
```

---

### Task 11: Triggers

**Files:**
- Create: `web/app/Triggers.tsx` (port of `web/src/Triggers.tsx`)
- Test: `web/app/Triggers.test.tsx`

**Interfaces:**
- Consumes: `usePoll` (Task 1), `ConfirmButton`, `useNotify`, `NONE`, `fromNone`, `cn` (Task 4), `api`, `ago` (`api.ts`).
- Produces: `Triggers()`.

- [ ] **Step 1: Write the failing tests**

`web/app/Triggers.test.tsx`:

```tsx
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
import { api } from './api';
import { calls, routeApi } from './test/fixtures';
import { renderApp } from './test/render';
import { Triggers } from './Triggers';

const trig = (o = {}) => ({ id: 'acme-full-review', repo: 'acme/api', workflow: 'full-review', status: 'idle', last: null, enabled: true, ...o });
const setup = (hasSecret: boolean) => ({ payloadPath: '/api/webhooks/github', hasSecret, secretHint: hasSecret ? 'ab12' : null, secretSource: hasSecret ? 'file' : null, eventsToSelect: ['Pull requests'], contentType: 'application/json' });
let triggers = [trig()];

beforeEach(() => {
  vi.mocked(api).mockReset();
  triggers = [trig()];
  routeApi({
    'GET /api/triggers': () => triggers,
    'GET /api/triggers/deliveries': [],
    'GET /api/triggers/setup': setup(true),
    'GET /api/workspaces': [],
    'GET /api/pipelines': [{ name: 'full-review', nodes: 5 }],
    'GET /api/bots': { agents: { claude: { ok: true, models: [] } } },
    'PATCH /api/triggers/acme-full-review': {},
    'DELETE /api/triggers/acme-full-review': {},
    'POST /api/triggers': (b: unknown) => ({ ...trig(), ...(b as object), id: 'acme-full-review' }),
    'POST /api/triggers/acme-full-review/test': (b: unknown) => ({ matches: true, why: '', fired: (b as { fire: boolean }).fire, runId: (b as { fire: boolean }).fire ? 'r9' : undefined, pr: { repo: 'acme/api', number: 12, title: 'Fix bug', url: 'u' } }),
    'POST /api/triggers/setup/secret': { secret: 'new-secret-value' },
  });
});

describe('Triggers', () => {
  it('pauses and deletes a trigger', async () => {
    renderApp(<Triggers />);
    fireEvent.click(await screen.findByRole('switch', { name: /Pause acme-full-review/ }));
    await waitFor(() => expect(calls('PATCH', '/api/triggers/acme-full-review')[0]![2]).toEqual({ enabled: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' })));
    expect(calls('DELETE', '/api/triggers/acme-full-review')).toHaveLength(1);
  });

  it('saves a new trigger with split lists', async () => {
    renderApp(<Triggers />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New trigger' }));
    fireEvent.change(screen.getByLabelText('Repo'), { target: { value: 'acme/api' } });
    fireEvent.change(screen.getByLabelText('Events'), { target: { value: 'opened, labeled' } });
    fireEvent.change(screen.getByLabelText('Only with labels'), { target: { value: 'aorch' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
    expect(calls('POST', '/api/triggers')[0]![2]).toMatchObject({ repo: 'acme/api', workflow: 'full-review', events: ['opened', 'labeled'], labels: ['aorch'], workspace: '', agent: '' });
  });

  it('dry-runs and fires only after confirming', async () => {
    renderApp(<Triggers />);
    fireEvent.change(await screen.findByLabelText('Pull request'), { target: { value: 'https://github.com/acme/api/pull/12' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Dry run' })));
    expect(await screen.findByText(/Would start a run/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fire for real…' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, fire' })));
    expect(calls('POST', '/api/triggers/acme-full-review/test')[1]![2]).toEqual({ pr: 'https://github.com/acme/api/pull/12', fire: true });
    expect(await screen.findByText(/Started run r9/)).toBeTruthy();
  });

  it('asks before regenerating an existing secret and shows the new one', async () => {
    renderApp(<Triggers />);
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate secret' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Regenerate' })));
    expect(await screen.findByText('new-secret-value')).toBeTruthy();
  });

  it('keeps focus on a row control across polls', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderApp(<Triggers />);
    const sw = await screen.findByRole('switch', { name: /Pause acme-full-review/ });
    sw.focus();
    triggers = [trig({ status: 'active' })];
    await act(() => vi.advanceTimersByTimeAsync(5100));
    expect(document.activeElement).toBe(screen.getByRole('switch', { name: /Pause acme-full-review/ }));
  });
});
```

Run: `npx vitest run --project web web/app/Triggers.test.tsx`
Expected: FAIL, cannot resolve `./Triggers`.

- [ ] **Step 2: Port the screen**

Port `web/src/Triggers.tsx` with the porting rules, plus:
- Types `Delivery`, `Status`, `Trigger`, `Workspace`, `Setup`, `Form`, `TestResult`, `EVENTS`, `blank`, `fromTrigger`, `statusTip` copied verbatim.
- Data: `const list = usePoll<Trigger[]>('/api/triggers', 5000); const rows = list.data ?? [];` and `const log = usePoll<Delivery[]>(`/api/triggers/deliveries?${logFor ? `trigger=${encodeURIComponent(logFor)}&` : ''}limit=50`, 5000);`. Setup is fetched once on mount and again after `regenerate`. Workspaces, pipelines and agents are fetched once on mount as in Solid. `loading` = `list.data === undefined && !list.error`. After every mutation call `await list.refresh(); await log.refresh();`. The test panel's trigger defaults like Solid's `load()` did: `useEffect(() => { if (!testId || !rows.some((t) => t.id === testId)) setTestId(rows[0]?.id ?? ''); }, [rows, testId]);`. The `createStore`/`reconcile` code is removed: React keeps row DOM (and focus) because rows are keyed by `id`.
- Messages: `useNotify()` replaces the `msg` chip (`ok` for "… saved", "… deleted", "copied"; `fail` for errors).
- Triggers table: Arc `SortableDataTable<TriggerRow>` where `type TriggerRow = Trigger & Record<string, unknown>`, `rows={rows as TriggerRow[]}`, `rowKey="id"`, `caption="Triggers"`, columns in the Solid order: `status` (render the dot span), `id` (sortable; id plus status), `repo` (sortable; "repo → workflow" plus "comments" chip), `workspace`, `agent` (render `who(row)`), `events`, `last` (render last delivery), `enabled` (render `<Switch aria-label={`${row.enabled === false ? 'Enable' : 'Pause'} ${row.id}`} checked={row.enabled !== false} onCheckedChange={() => void toggle(row)} />`), `actions` (render Test / Log / Edit as `Button variant="ghost" size="sm"` and `<ConfirmButton label="Delete" prompt={`Delete ${row.id}?`} confirmLabel="Yes, delete" onConfirm={() => remove(row.id)} />`). "Test" sets `testId`; "Log" sets `logFor`; "Edit" opens the form.
- Form: Arc `Input` (`Repo`, `Workflow` with `list="trig-workflows"`, `Model` with `list="trig-models"`, `Events` with `list="trig-events"`, `Only with labels`, `Id`), Arc `Select label="Workspace"` (only when workspaces exist; `NONE` = "none"; keep the "(not found)" option for an unknown saved id), Arc `Select label="Agent"` (`NONE` = "crew defaults"; keep the "(unknown)" option), Arc `Checkbox` for the three switches. Workspace and agent values go through `fromNone` into `form`.
- Test panel: Arc `Select label="Trigger to test"` (options from `rows`), Arc `Input label="Pull request"`, "Dry run" `Button variant="primary"`, and `<ConfirmButton variant="secondary" label="Fire for real…" prompt="Start a real run on this PR?" confirmLabel="Yes, fire" disabled={testing || !testPr.trim() || !testId} onConfirm={() => runTest(true)} />`. Result and error paragraphs as in Solid.
- Webhook setup: the copy buttons become Arc `CopyButton value={payloadUrl} label="Copy" variant="outline"` (and for the secret). Regenerate: if `setup.hasSecret`, `<ConfirmButton variant="secondary" label="Regenerate secret" prompt="Existing webhooks stop working until you paste the new secret." confirmLabel="Regenerate" onConfirm={regenerate} />`; otherwise a plain `Button variant="secondary"` "Generate secret" that calls `regenerate()` directly. "Hide" stays a `Button variant="ghost"`.
- Deliveries: Arc `SortableDataTable` with `rowKey={(d) => `${d.at}-${d.trigger ?? ''}-${d.pr ?? ''}`}`, `caption="Deliveries"`, `emptyMessage="No deliveries yet"`, columns at / trigger / source / repo#pr / outcome / run-or-reason (run id renders `<a href={`#/runs/${d.runId}`}>`), and the "All triggers" filter as an Arc `Select label="Show"` (`NONE` = all).

- [ ] **Step 3: Run tests and typecheck**

Run: `npx vitest run --project web web/app/Triggers.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/app/Triggers.tsx web/app/Triggers.test.tsx
git commit -m "web: port triggers to React with Arc tables, switches and copy buttons"
```

---

### Task 12: App shell

**Files:**
- Create: `web/app/App.tsx`, `web/app/main.tsx`
- Test: `web/app/App.test.tsx`

**Interfaces:**
- Consumes: `useHashRoute`, `usePoll`, `TABS`, `TAB_LABEL`, `Tab`, `Route` (Task 1); `useTheme` (Task 2); `loadCrewDefs` (Task 3); `CommandMenu` (Task 4); every screen (Tasks 7–11).
- Produces: `App()`; `main.tsx` mounts it into `#root` and imports `./components/arc/foundation.css`, `./theme.css`, `./styles.css` in that order.

- [ ] **Step 1: Write the failing tests**

`web/app/App.test.tsx`:

```tsx
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: vi.fn() }));
vi.mock('./Builder', () => ({ Builder: (p: { pipeline?: string }) => <div>builder screen {p.pipeline ?? ''}</div> }));
vi.mock('./Runs', () => ({ Runs: (p: { selected?: string }) => <div>runs screen {p.selected ?? ''}</div> }));
vi.mock('./Graph', () => ({ GraphView: () => <div>graph screen</div> }));
vi.mock('./Crew', () => ({ Crew: () => <div>crew screen</div> }));
vi.mock('./Triggers', () => ({ Triggers: () => <div>triggers screen</div> }));
import { api } from './api';
import { App } from './App';
import { routeApi } from './test/fixtures';

beforeEach(() => {
  vi.mocked(api).mockReset();
  routeApi({ 'GET /api/health': { ok: true, vault: '/home/me/notes/aorch' }, 'GET /api/crew': { bots: [] }, 'GET /api/runs': [], 'GET /api/pipelines': [] });
});

describe('App', () => {
  it('switches tabs through the hash and remembers the last run', async () => {
    location.hash = '#/runs/r5';
    render(<App />);
    expect(screen.getByText('runs screen r5')).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Crew' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Crew' }));
    expect(location.hash).toBe('#/crew');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Runs' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Runs' }));
    expect(location.hash).toBe('#/runs/r5');
    act(() => {
      location.hash = '#/graph';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByText('graph screen')).toBeTruthy();
  });

  it('shows the vault and connection state', async () => {
    render(<App />);
    expect(await screen.findByText('vault · notes/aorch')).toBeTruthy();
    expect(await screen.findByText('connected')).toBeTruthy();
  });

  it('shows offline when the server is down', async () => {
    routeApi({ 'GET /api/health': new Error('down'), 'GET /api/crew': { bots: [] } });
    render(<App />);
    expect(await screen.findByText('offline')).toBeTruthy();
  });

  it('opens the command menu with Ctrl-K and navigates', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(await screen.findByText('Go to Triggers'));
    await waitFor(() => expect(screen.getByText('triggers screen')).toBeTruthy());
  });
});
```

Run: `npx vitest run --project web web/app/App.test.tsx`
Expected: FAIL, cannot resolve `./App`.

- [ ] **Step 2: Implement the shell**

`web/app/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Builder } from './Builder';
import { CommandMenu } from './CommandMenu';
import { Badge } from './components/arc/badge/badge';
import { Button } from './components/arc/button/button';
import { Tabs, TabsList, TabsTrigger } from './components/arc/tabs/tabs';
import { ThemeSwitch } from './components/arc/theme-switch/theme-switch';
import { ToastStack, ToastStackProvider } from './components/arc/toast-stack/toast-stack';
import { Tooltip } from './components/arc/tooltip/tooltip';
import { Crew } from './Crew';
import { loadCrewDefs } from './crew';
import { GraphView } from './Graph';
import { TAB_LABEL, TABS, useHashRoute, usePoll, type Tab } from './hooks';
import { Runs } from './Runs';
import { useTheme } from './theme';
import { Triggers } from './Triggers';

export function App() {
  const [route, go] = useHashRoute();
  const [lastRun, setLastRun] = useState(route.tab === 'runs' ? route.id : undefined);
  const [theme, setTheme] = useTheme();
  const [palette, setPalette] = useState(false);
  const health = usePoll<{ ok: boolean; vault?: string }>('/api/health', 5000);

  useEffect(() => void loadCrewDefs(), []);
  useEffect(() => {
    if (route.tab === 'runs' && route.id) setLastRun(route.id);
  }, [route]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const online = !!health.data?.ok && !health.error;
  const vault = health.data?.vault;
  const openTab = (t: Tab) => go(t === 'runs' && lastRun ? { tab: 'runs', id: lastRun } : { tab: t });

  return (
    <ToastStackProvider>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="logo">◈</span> aorch
          </div>
          <Tabs value={route.tab} onValueChange={(v) => openTab(v as Tab)}>
            <TabsList aria-label="Main">
              {TABS.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {TAB_LABEL[t]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button variant="secondary" size="sm" onClick={() => setPalette(true)}>
            Search or jump to… <kbd>Ctrl K</kbd>
          </Button>
          <div className="status">
            {vault ? (
              <Tooltip content={vault}>
                <span tabIndex={0}>
                  <Badge size="sm">vault · {vault.split('/').filter(Boolean).slice(-2).join('/')}</Badge>
                </span>
              </Tooltip>
            ) : null}
            <Tooltip content="The API starts agents and writes files, so it only listens on this machine.">
              <span tabIndex={0}>
                <Badge size="sm">loopback only</Badge>
              </span>
            </Tooltip>
            <Badge size="sm" tone={online ? 'success' : 'danger'}>
              {online ? 'connected' : 'offline'}
            </Badge>
            <ThemeSwitch theme={theme} onThemeChange={(t) => setTheme(t)} iconOnly />
          </div>
        </header>
        <main>
          {route.tab === 'builder' ? <Builder pipeline={route.id} onStarted={(id) => go({ tab: 'runs', id })} /> : null}
          {route.tab === 'runs' ? <Runs selected={route.id} onSelect={(id) => go({ tab: 'runs', id })} /> : null}
          {route.tab === 'graph' ? <GraphView /> : null}
          {route.tab === 'crew' ? <Crew /> : null}
          {route.tab === 'triggers' ? <Triggers /> : null}
        </main>
        <CommandMenu open={palette} onOpenChange={setPalette} onGo={go} />
      </div>
      <ToastStack />
    </ToastStackProvider>
  );
}
```

`web/app/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './components/arc/foundation.css';
import './theme.css';
import './styles.css';
import { applyTheme, initialTheme } from './theme';

applyTheme(initialTheme());
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 3: Run the whole web suite and typecheck**

Run: `npx vitest run --project web && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/app/App.tsx web/app/main.tsx web/app/App.test.tsx
git commit -m "web: React app shell with Arc tabs, theme switch, toasts and Ctrl-K"
```

---

### Task 13: Switch over, remove Solid, verify

**Files:**
- Delete: `web/src/` (Solid)
- Move: `web/app/` → `web/src/`
- Modify: `web/vite.config.ts`, `web/tsconfig.json`, `vitest.config.ts`, `package.json`, `scripts/arc-add.mjs`, `README.md`
- Delete: `web/src/tsconfig.json` (the moved `web/app/tsconfig.json`; `web/tsconfig.json` takes over)

**Interfaces:**
- Consumes: everything above.
- Produces: the shipped dashboard. `test/handoff.test.ts` keeps importing `describeEvent` from `../web/src/api.js`; `test/team-ui.test.ts` keeps type-checking `web/tsconfig.json`.

- [ ] **Step 1: Swap the folders**

```bash
git rm -r -q web/src
git mv web/app web/src
git rm -q web/src/tsconfig.json
```

- [ ] **Step 2: Point the config at React**

`web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: `npm run dev` (API on :4177) + `npx vite web` (UI on :5173, proxies /api).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4177' } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      // Arc's files start with "use client" (a Next.js marker); it means nothing here.
      onwarn(w, warn) {
        if (w.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(w);
      },
    },
  },
});
```

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "noEmit": true,
    "skipLibCheck": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts", "../src/types.ts"]
}
```

`vitest.config.ts`: in the `web` project change `include` to `['web/src/**/*.test.{ts,tsx}']` and `setupFiles` to `['web/src/test/setup.ts']`.

`package.json`: `typecheck` back to `"tsc --noEmit && tsc --noEmit -p web/tsconfig.json"`; remove `solid-js` and `vite-plugin-solid` (`npm uninstall solid-js vite-plugin-solid`).

`scripts/arc-add.mjs`: `export const OUT_DIR = ['web', 'src', 'components', 'arc'];` and the header comment path.

`README.md`, Development section, add one line after the `npm run typecheck` line:

```
The web dashboard (web/src) is React + Arc components (uiarc.dev, MIT), vendored under web/src/components/arc. Add another with `node scripts/arc-add.mjs <name>`.
```

- [ ] **Step 3: Full verification**

```bash
npm test
npm run typecheck
npm run build
grep -rn "uiarc.dev" web/dist || echo "no uiarc.dev in bundle"
grep -rlE "solid-js" web/src package.json || echo "no solid left"
```

Expected: all tests PASS (node and web projects), typecheck clean, build succeeds, both greps print their "no …" line.

- [ ] **Step 4: Manual check in Chrome**

```bash
node dist/cli.js serve
```

With a `~/.aorch` that has a finished run, a team run waiting in planning and one trigger, open the printed URL and check, in dark and light (theme switch) and at desktop width and 390 px:
- Builder: load a workflow, add a step, drag it, connect two ports, delete with the Delete key, Save, Run dialog for workflow and team.
- Runs: list updates, a live run streams, Step / Branch diff / Timeline tabs, approve a step, feedback note.
- Team run: answer a question card, use recommendations, approve the plan.
- Graph: zoom, pan, search, open a note.
- Crew: link a model, switch style, edit a bot in the drawer, open Evolve.
- Triggers: pause, test dry run, copy the payload URL.
- Ctrl-K jumps to a run and a workflow. Toasts appear for a failed action (stop the server and click Save).

Compare each screen with the Solid build on `main` (`git stash` is not needed: run `main` from the original checkout). Note any difference in the PR description.

- [ ] **Step 5: Commit and push**

```bash
git add -A web vitest.config.ts package.json package-lock.json scripts/arc-add.mjs README.md
git commit -m "web: switch the dashboard to React + Arc and remove Solid"
git push -u origin feature/web-react-arc
```
