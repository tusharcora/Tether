# The app looks like the demo: Home, Run, Inbox (round 1)

Date: 2026-10-28 · Branch: `feature/app-like-demo` (from `main` 607de0f, after PR #8)

## 1. Intent

The landing page (live at tether.tusharcs0112.workers.dev) shows a demo window of Tether. The owner finds it "way
better … clean, marketable" and the real app "unnecessary clutter". This round makes three real screens look and feel
like that demo, so the app itself is calm enough to show in marketing and nothing on screen is noise.

Owner decisions (2026-10-28):
- Round 1 is **Home, the run view and Inbox**. Builder, Crew, API client, Graph, Triggers and Settings come later.
- **Coach** stays but becomes **one line with no "Coach" label**.
- The **step inspector keeps everything it does** ("the idea is 100% there") but gets a modern, dynamic look and
  **opens on click** instead of being a permanent pane. The approved mockup is the reference.
- **Saved requests leave Home** (they stay in the API client and can be pinned to Favorites).
- The Code page's file tree uses **beui `motion/file-tree`**.
- **beui `motion/animated-badge` is the status badge** for agent runs, workflows, team runs and steps.
- Behaviour stays the same. This is a change of look and layout, not of what the app can do.

## 2. References

- `docs/design/AppDemo.html` — the landing page source. The demo window is `#win`; its screens are
  `.screen[data-s="home"|"inbox"|"runs"|"code"]`, with tokens at the top of the `<style>`. It is **the target look**.
  Open it in a browser and click the sidebar; the tour can be paused.
- `docs/design/StepInspector.html` — **approved** mockup of the run view with the step inspector (click crew cards,
  ← → between steps, Esc closes; "Replay the run" shows the live states).
- Comparison of today vs the demo, with numbered problems: artifacts `BtJJUhk9FWy6vzhs8rj8Bi` (Home, Runs) and
  `DiLsFuSwgPHSyCJEpet36x` (Coach, inspector, saved requests).
- beui file-tree source as pasted by the owner: `.superpowers/components/beui/file-tree/source.tsx` (git-ignored, MIT).
  It imports `SharedLayoutBg` from beui, which the repo does not have yet.

## 3. Goals

1. Home, the run view and Inbox match the demo's layout, density and hierarchy in both themes.
2. No information or action is lost: everything reachable today is still reachable, at most one click away.
3. Statuses read the same everywhere, through one animated badge, and an icon never contradicts its status.
4. The step inspector feels alive: it slides in, moves between steps, and updates live while a step runs.

## 4. Non-goals and anti-goals

- **Not in this round:** Builder, Crew, API client, Graph, Triggers, Settings, the assistant and the sidebar (the
  sidebar already matches; leave it). On the Code page only the file tree changes.
- **No behaviour, API or data changes.** No new endpoints, no new stored state. Existing routes keep working,
  including `#/runs/<id>/<node>` deep links.
- **Anti-goals, from the owner's earlier feedback:** no purple or indigo, no glows, no bento stat tiles or decorative
  sparklines on Home ("vibecoded"). No hiding an approval or a question the person must act on. Don't trade clutter for
  hunting: if something moves behind a click, the click is obvious.

## 5. Shared rules for the three screens

- **Page header:** just the title (and on a run, its badge and one mono metadata line). Drop eyebrow lines,
  subtitles and Refresh buttons; data already polls or streams.
- **Sections are a label plus one list**, not a card each: a 12 px muted label with an optional count chip, then one
  bordered list whose rows are separated by hairlines (the demo's `.sec` + `.list` / `.li`).
- **An empty section is one quiet line** ("Nothing needs you."), never an icon tile with a heading and a button.
- **Status:** one `StatusBadge` (below) for every status label. Status glyphs (the sidebar's half-filled ring = running,
  dashed amber ring = needs you, check = done, red ✕ = failed, grey = queued/stopped) follow the same mapping. Today a
  failed run shows a green ring in the runs list: fix it.
- Use the existing Studio tokens and beui kit. Respect reduced motion. Light and dark both get equal care.

## 6. Home

Layout (demo `.screen[data-s="home"]`): a main column and a 270 px side column, stacking under ~1100 px.

Main column, top to bottom:
1. **Composer.** One "Ask the crew to…" field with a row of small chips under it (project · branch, run kind,
   who picks the crew) and a Start run button. It replaces today's Start a run card. Everything the current form offers
   (multi-line task, suggestions, workspace, workflow or team choice) stays available: the field grows when typing,
   chips open pickers, and suggestions appear while the field is empty and focused. The builder decides the exact
   affordances within that shape.
2. **Needs you** with a count. Each row: dashed amber glyph, title, one muted line, inline actions (Approve, Review,
   Answer) as in the demo.
3. **Running** with a count. Each row: running glyph, title, one muted line (who is working, step n of m), a
   segmented step track, and the elapsed clock on the right.
4. **Recent**: the last few finished runs, each with its badge and one line (id · result · time · cost).

Side column:
- **Activity**: at most 8 short lines, newest first, with a live dot. Collapse repeats: consecutive events of the
  same kind become one line ("3 steps skipped"), so the feed never shows the same three lines twice. Remove the
  Pause button (pausing on hover is fine if useful).
- **Crew**: the faces grid, with the busy dot on bots that are working.

Removed from Home: Saved requests panel, the "0 running · 0 need you" line, the subtitle, Refresh.

## 7. The run view

**Runs without a run open** (`#/runs`): a full-width list. Each row: status glyph, title, kind tag, badge, and
cost · when on one line. The filters stay but move into a compact row (or a menu) above the list instead of two
stacked toggles. No permanent "No run selected" pane.

**A run** (`#/runs/<id>`), full width, top to bottom (demo `.screen[data-s="runs"]` and the inspector mockup):
1. **Header:** title, `StatusBadge`, a mono line (`R-id · kind · elapsed · $cost of $budget`), actions such as Retry
   failed on the right. A way back to the list stays (the sidebar lists runs; a small "← Runs" is fine).
2. **One-line notices** under the header, each dismissible where it is advisory:
   - Coach findings: one line each, amber dot, the finding's text and its suggestion as a link-style action, no label.
     More than two findings collapse into "and N more".
   - Run errors (e.g. "budget exhausted ($6.41 of $4.50)") as a red-dot line. Stream errors keep their retry.
3. **Run graph at the top**, readable: crew cards (face, name, role · agent) laid out in dependency layers, left to
   right, with edges coloured by state and a moving dot on live edges. It replaces the small canvas at the bottom.
   Wide team runs scroll sideways inside the graph. Clicking a card opens the inspector.
4. **Questions and plan approvals** that need the person stay inline, right under the graph, using the existing
   approval and question cards.
5. **Live output and changed files** side by side (output left, files with +/− bars right), as in the demo.
6. **Planning and plan details** (today's "Dialogue so far" and the Team plan list) become collapsed disclosure rows
   below the output ("Planning · 5 answers", "Team plan · 4 of 7"). Fix the Team plan's right-edge overflow.
7. **Approval bar** for a waiting approval step: question, gate summary, Review diff, Reject, Approve. It is sticky at the
   bottom of the run view while the approval waits, so it is never below the fold (§14.8).

### 7.1 Step inspector (approved mockup `docs/design/StepInspector.html`)

- A 440 px panel that **slides in from the right** over the run when a crew card is clicked (or the route has a node).
  Esc, ×, or clicking the run closes it and returns the route to `#/runs/<id>`. On narrow windows it is a full-height
  sheet.
- **Header:** previous / next buttons, step dots, "3 of 6", ← → and Esc hints, close. ← → move between steps and the
  content slides in that direction.
- **Identity:** the bot's face, name, `StatusBadge`, role · agent · model.
- **Three figures:** attempts, cost, time. Cost and time tick while the step runs.
- **Tabs** with a sliding highlight: **Output** (streams, with a caret while live), **Changes** (files; each opens to
  its diff), **Checks** (for gate steps: one row per gate run with pass/fail, exit code and the fix-loop count, output
  expandable, see §14.4; for verdict steps: the verdict),
  **Timeline** (the step's events). These carry today's Step, Branch diff and Timeline content; nothing is dropped.
- **Rating:** "How did <bot> do?" with thumbs up and down, which opens the optional note and saves through the existing
  feedback path (the one that feeds Evolve). Gate (the person) shows no rating.
- Badges roll when a step changes state (writing → done, testing → failed → retrying → passed).

## 8. Inbox

Demo `.screen[data-s="inbox"]`: a list on the left and the open item on the right.
- List rows: amber pulse, title, one muted line (question n of m, run id), a badge for the kind of action (answer,
  approve).
- Detail: for a question, the question title, the reason it's asked, options as selectable rows with the ★
  recommended one marked, free text where the card allows it, Previous and Next. For an approval, the existing beui
  approval card. Acting removes the item with a short animation and opens the next.
- Empty: one line.

## 9. Code page file tree

Replace the rendering in `web/src/code/FileTree.tsx` with beui `FileTree` (folders and files, animated open/close,
branch lines, keyboard navigation). Keep the component's contract with `Code.tsx` (rows, expanded, current, changed,
onExpand, onCollapse, onOpen) by driving beui's controlled `expandedIds` and `value`. Changed files keep a visible
marker. Vendor `SharedLayoutBg` from beui (MIT, keep the notice) next to the other beui motion components, or write
an equivalent small sliding-highlight helper if the source can't be obtained. Map beui's Tailwind names (`bg-muted`,
`text-muted-foreground`, `bg-border`) through the existing beui→Studio token map.

## 10. Status badges

Add one `StatusBadge` wrapper over the vendored `components/beui/motion/animated-badge.tsx` that takes a Tether status
and picks the badge state and label. Mapping:

| Tether status | Badge state | Label |
|---|---|---|
| running, planning, writing, reading, testing, retrying | loading | the live verb (§14.3) |
| waiting for approval, question pending | warning | needs you |
| done, passed, PASS verdict | success | done / passed |
| failed, error, FAIL verdict, budget or time exhausted | danger | failed / error |
| queued, skipped, stopped, paused | neutral | as named |

Use it for every run, workflow, team run and step status label in the app, starting with the three screens and the
places that show run status elsewhere (runs list, run header, inspector, Home rows, Inbox, crew `RunsOn`, the team
panel, Builder and Evolve where they show run or step status). `StatusChip` already wraps `AnimatedBadge`: fold the
two into one so there is a single component. Remove ad-hoc status pills that duplicate it.

## 11. Constraints

- Web app in `web/` (React 19, Tailwind v4 without preflight alongside Studio tokens, beui kit, motion, lucide). The
  same build ships in the Electron app.
- Vendored beui files keep their MIT notice. No new npm dependencies are expected.
- The web test suite must stay green; update tests and snapshots that assert the old layout. Typecheck clean.

## 12. Left to the builder

Component boundaries and file layout; exact spacing, which matches the demo; how the composer's pickers work;
the graph layout algorithm (layers by dependency are enough); how activity repeats are grouped; how the filters on the
runs list are presented; animation timings within the mockup's feel.

## 13. Done means

- Side-by-side screenshots of Home, a run (with the inspector open) and Inbox, in light and dark, next to the demo,
  look like the same product.
- Checked in Chrome against a real `~/.aorch` copy: a finished team run, a failed run, and a run waiting for
  approval; the inspector opens from a card and from a `#/runs/<id>/<node>` link; ← →, Esc and rating work.
- Tests and typecheck pass.

## 14. Questions from the builder check, settled

A reviewer read this document as a builder would. Their questions and the answers. Answers marked **(my call)** were
decided by Claude, not the owner, under "behaviour stays the same"; the owner can overturn any of them.

1. **Run titles.** A run's title is the first line of its task text, truncated with an ellipsis by CSS (the sidebar
   already shows task text). The kind (Team, workflow name) becomes a small tag next to it. `runTitle` keeps working for
   places outside this round; `VaultActivityItem` keeps its "never task text" rule. **(my call)**
2. **Run-wide Timeline and Branch diff.** The inspector has a **run mode** besides step mode: opened by a "Run details"
   button in the run header, by Review diff, and by clicking the files panel. Run mode has the tabs Changes (whole-branch
   diff) and Timeline (all events). `#/runs/<id>?pane=timeline` opens run mode on Timeline, so `NeedsYou.linkFor` keeps
   working. **(my call)**
3. **Badge verbs.** `StatusBadge` takes a small descriptor, not just a status string: status, plus kind, read-only,
   attempts, live flag and gate result where known. Steps: agent running → "writing" (or "reading" if read-only), gate
   running → "testing", attempts > 1 → "retrying", gate ok → "passed", otherwise the status word. Runs: running and live →
   "running"; running but not live → "interrupted" (warning); paused with an approval or question waiting → "needs you"
   (warning); paused otherwise → "paused" (neutral). "Merged" is not a state and is not used. **(my call)**
4. **Checks tab.** No test-output parser. The mockup's per-test grid becomes one row per gate run (attempt, pass/fail,
   exit code, duration) with its output expandable and the fix-loop count; a new row appears as each gate run finishes.
   **(my call; the owner saw a per-test grid in the mockup, so this is called out to them)**
5. **Live output pane.** Built from the event stream: one line per event, prefixed by the bot's name, in time order, as in
   the demo. Parallel steps interleave naturally. Clicking a line opens that step in the inspector. **(my call)**
6. **Inbox coverage.** All seven attention kinds stay Inbox rows (plan ready, question, approval, planning error, paused,
   interrupted, failed). The detail shows the matching card: the existing team plan review in full (assignments, bot
   swap, limits, Reject with confirm), question cards, approval card, or Retry / Resume for the others. Questions are
   grouped per run with Previous / Next, and answering keeps today's behaviour: answers are collected, can be changed, and
   are sent together; "Use recommendations" stays. The detail fetches the run as needed. **(follows "behaviour stays the
   same")**
7. **Composer chips.** They expose only what exists today: the project / workspace, live or autonomous, and a menu item
   that hands off to the Builder for a workflow. "Tether picks the crew" and the branch are labels, not pickers.
   **(follows "behaviour stays the same")**
8. **Approval bar.** Plain Approve and Reject, as today; no "approve when gates pass". Sticky at the bottom of the run
   view while waiting. Review diff opens the inspector in run mode on Changes. **(follows "behaviour stays the same")**
9. **Coach findings.** The finding's suggestion is shown as muted text after it, not a link, because it has no target.
   Dismissing hides it for the current session only (in memory), with no stored state. **(my call)**

