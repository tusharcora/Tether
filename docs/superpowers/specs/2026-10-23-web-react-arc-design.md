# Web dashboard on React + Arc — design

## Intent
Move the web dashboard (`web/`) from SolidJS to React 19 so it can use the Arc component library (uiarc.dev, MIT, React-only) for its UI, and so the coming workbench (Monaco, xterm, Blobatar, see `2026-10-23-workbench-roadmap.md`) can use those projects' first-class React packages.

Success: every screen that exists today (Builder, Runs, Team, Graph, Crew, Triggers, Evolve) works the same against the same server and the same hash routes, now built from Arc components where they fit, in light and dark. No Solid code is left. Nothing is fetched from uiarc.dev at build or run time.

Decided with the user: migrate (not islands, not a Solid port, not reference-only); use Arc's **free** components only; agent-specific views (Arc Pro: tool call, agent plan, agent status, reasoning tree…) are built by us from free parts. Use Arc components "as many as possible, only if useful or needed".

## Today
- 12 files, about 3,100 lines: `App.tsx` (shell, hash routing, health beat), `Builder.tsx` + `Canvas.tsx` (drag workflow editor), `Runs.tsx`, `Team.tsx`, `Graph.tsx` (vault graph), `Crew.tsx` + `bots.tsx` (pixel sprites and marks), `Triggers.tsx`, `Evolve.tsx`, `api.ts` (framework-free fetch wrapper and types), `styles.css`.
- About 107 Solid reactive call sites (`createSignal`, `createEffect`, `createResource`, `onMount`); `Triggers.tsx` uses `solid-js/store`.
- No web tests. The server serves `web/dist` and checks `Host`/`Origin`; that does not change.

## 1. Stack
- `react@19`, `react-dom@19`, `@vitejs/plugin-react`; remove `solid-js`, `vite-plugin-solid`. `web/tsconfig.json`: `jsx: react-jsx`, drop `jsxImportSource`.
- Arc: initialise once with the shadcn CLI (`components.json` in `web/`), add the components listed in section 3. The generated files are committed under `web/src/components/arc/` with their MIT notice; `web/src/lib/` holds Arc's `motion-tokens` and `arc-provider`. The CLI is a dev-time tool only; the build never touches the network.
- Arc runtime deps, added only as the chosen components need them: `motion`, `lucide-react`, the specific `@radix-ui/react-*` packages. Arc's few `next/image` uses are not needed (those components are not used); if one is, it is edited to a plain `<img>`.
- Arc styles are CSS Modules plus `foundation.css` variables. Arc's variables are mapped to aorch's palette in `web/src/theme.css` (dark default, light via `prefers-color-scheme` and a toggle saved in `localStorage`). The rest of `styles.css` stays for the hand-built pieces.
- Availability check: if a component named below is not in Arc's free registry when installed, a local component in `web/src/components/` follows the same tokens. No Pro registry, no `ARC_PRO_TOKEN`.

## 2. Port rules
- Same screens, same `#/<tab>[/<run>]` routes, same `api.ts` (only `import type` paths change), same server endpoints. No backend change in this sub-project.
- Solid → React: signals → `useState`; `createResource`/intervals → one `usePoll<T>(path, ms, deps)` hook in `web/src/hooks.ts` (fetch, keep last good value, expose error, stop on unmount); `createEffect` → `useEffect` with explicit deps; the `Triggers` store → `useReducer`.
- `Canvas.tsx` (pan/zoom/drag nodes and edges) and `Graph.tsx` (force layout) are ported by hand with refs; Arc has no equivalent.
- Bot faces: this sub-project ports the current pixel `Sprite` and marks unchanged into a `<Face>` component so the swap to Blobatar (crew track) is a one-file change.

## 3. Where Arc is used
| Screen | Arc components |
|---|---|
| Shell | Tabs (top nav), Badge (vault, loopback chips, connection status), Tooltip, Toast (API errors, run started), Command menu (Ctrl-K: jump to tab, open run, start workflow) |
| Builder | Dropdown menu (add step), Popover, Input, Textarea, Select (agent, model, role), Switch (read-only, include diff, verdict), Button |
| Runs | Timeline (step events), Stepper (step progress across the pipeline), Code block (gate output, diffs as text until a diff viewer exists), JSON viewer (tool-call payloads), Dialog (delete run), Empty state |
| Team | Radio cards / Radio group (Maestro's option cards, recommended option marked), Stepper (planning → approve → running → done), Chat thread (Maestro chat; plain props, our messages mapped to `ChatMessage[]`), Textarea |
| Crew | Avatar, Avatar group (roster), Sheet or Dialog (bot editor), Slider, Switch, Select (agent and model link), Tabs (built-in / custom / imported) |
| Triggers, Evolve | Table, Switch (pause), Accordion (deliveries, proposal edits), Dialog, Toast |
| Graph | Input (search), Card (note preview), Badge (tags) |

Our own components, composed from the above: `RunStepRow`, `PlanCard`, `ToolActivity`, `QuestionCard`, `Face`.

## 4. Error handling
- `api()` keeps throwing `Error(message)`. Screens show load failures inline (Empty state with the message and a retry button) and action failures as a Toast. The connection chip still reflects `/api/health`.
- `usePoll` backs off to 15 s after three failures and resumes on success, so a stopped server does not spam.

## 5. Testing
- Add `vitest` jsdom environment for `web/` and `@testing-library/react`. One smoke test per screen renders it with a mocked `api()` returning fixture data (a workflow run, a team run waiting for an answer, a crew list, a trigger) and checks the key controls exist and act (answering a question card calls the right endpoint).
- `npm run typecheck`, `npm run build`, `npm test` all pass.
- Manual: run `aorch serve` against a real `~/.aorch` with a finished run, a team run in planning and a trigger; click through every tab in Chrome in light and dark at desktop and 390 px width; compare with the Solid build from `main`.
- `grep` the built `web/dist` for `uiarc.dev` and `fetch(` call sites outside `api.ts`: none.

## 6. Out of scope
New features. Blobatar faces, ECC, routing (crew track spec). The workbench (roadmap). Arc Pro.
