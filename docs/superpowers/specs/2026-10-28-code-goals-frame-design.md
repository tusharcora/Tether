# Code and Goals in the tool-screen frame

Date: 2026-10-28 · Branch: `feature/code-goals-frame` (stacked on `feature/app-like-demo-2`, PR #12)

## 1. Intent

PR #12 put Builder, Crew, API client, Graph, Triggers and Settings in one frame (dotted backdrop, floating toolbars, a
left dock for lists, a right dock for details opened on demand). Code (round 1 gave it only beui's file tree) and Goals
(new from PR #9) still use the older layouts. The owner asked to make them "fit the rest of the tabs", approved the
Goals mockup as is, asked for visual tweaks on Code, and approved the tweaked version: "write the spec and build it".

Same features and behaviour as today; no API, data or server changes.

## 2. References

- **Approved mockup:** `docs/design/CodeGoals.html` (artifact `5pdCtzzwXniWFsjZu1eWVu`, v2). Both windows are clickable.
- The frame from PR #12: `ui/studio/ToolFrame.tsx` (`ToolScreen`, `FloatBar`, `Dock`, `MenuButton`, `.tf-wide`,
  `--tf-launcher`), `ui/studio/Section.tsx`, `StatusBadge`. Its spec: `docs/superpowers/specs/2026-10-28-tool-screens-design.md`.

## 3. Code (`#/code`, `web/src/code/*`)

- **Frame:** `ToolScreen` with the dotted backdrop. Top-left `FloatBar`: "Code", the project/repo chip (today's project
  switch if Code has one, else a label) and the branch. Top-right `FloatBar`: the search-in-files field (today's search,
  ⇧⌘F if that is today's shortcut; keep whatever the shortcut is today).
- **Left dock:** the beui file tree with its filter (today's `FileTree` + filter), the "not a git repository" note when it
  applies, and a one-line legend "changed by a run in 30 days". Tree rows get file/folder icons, indent guide lines, the
  git badge as a small tinted letter (M amber, A green, others neutral) and the blue changed-by-run dot.
- **Editor card:** one floating card filling the rest of the window. From top to bottom:
  1. **Header row:** today's open-file tabs as editor tabs inside the card (file icon, name, amber unsaved dot, × on
     hover/active), then on the right today's Edit/Done and Save buttons.
  2. **Path line:** a breadcrumb of the open file's path; on the right, when runs touched the file, a chip
     "● N runs touched it" that toggles the runs panel.
  3. **Lock strip** (only while a run holds the file, today's `code-lock`): a soft blue strip with the run's bot face,
     "<Bot> is editing this file in <R-id>. Read-only until the run finishes.", and Open run. The secrets-file banner
     becomes the same kind of strip in neutral tone.
  4. **Editor:** today's CodeMirror `Editor`, plus **gutter marks for every run that touched the file** using the changed
     lines already in each `RunTouch`: a thin bar per changed line, blue for a live run, green for a finished one (a live
     run wins where they overlap). Picking a run in the panel keeps today's behaviour (marks its lines and shows its
     diff) and tints that run's lines. The current line is highlighted.
  5. **Status bar:** saved / unsaved / read-only, line and column, language, encoding (UTF-8 if not known) and branch,
     from what the screen already knows; omit any field the data doesn't have rather than inventing it.
- **Runs panel:** today's `RunsLens` moves into the right `Dock` ("Runs on this file", with the file name), opened by
  the chip; it no longer takes a permanent column. Picking a run, its diff and Open run work as today.
- Search results (today's `SearchResults`) open in the editor card's place while a search is active, as today.

## 4. Goals (`#/goals`, `web/src/goals/*`)

- **Left dock:** the goals list (today's rows): title, `StatusBadge`, one muted line ("loop · 3 of 6 attempts" or
  "tracker · 2 of 4 done"), and a progress bar (budget spent for loops, items done for trackers; green when met). A
  "+ New goal" row at the foot.
- **Top-left `FloatBar`:** the open goal's title, status badge and kind ("outcome loop · workflow <name>" / "team", or
  "tracker"). **Top-right `FloatBar`:** today's goal actions for its state (Pause/Resume goal, Stop, Settings, Turn into a
  loop for trackers, Duplicate where today offers it) and "+ New goal" last.
- **Canvas:** a loop's `LoopFlow` (today's action-node chain: finish check, attempts, the dashed "next run · needs you"
  approval with Start / Edit plan / Skip, and each node's fan of actions) centred on the backdrop and scrolling inside
  it. A tracker's checklist (today's `Tracker`) as one floating card in the centre.
- **Limits:** today's budget and attempts become a small floating bar at the bottom centre with two progress bars
  (shown for loops). It respects `--tf-launcher`.
- **Dock:** today's goal Settings and the New goal form open in the right `Dock` instead of dialogs. Confirmations that
  exist today (e.g. delete) keep their confirm step.
- Empty states: no goals → one quiet line with "+ New goal"; no goal open → the first goal opens, as the list pick does
  today, or a quiet line if the list is empty.

## 5. Constraints and anti-goals

- No behaviour, API, data or server changes; existing routes (`#/code/<path>:<line>`, `#/goals/<id>`, and any others
  these screens use) keep working. Keep `GraphBoard`-style care for existing interactions: nothing the screens do today
  may be lost.
- Reuse the PR #12 frame and patterns (CSS files for Studio components; Tailwind only generates for beui/bencho/aicss/
  faces/assistant sources; mask dots, no gradients; the beui button reset).
- No purple or indigo, no glows. Light and dark both; reduced motion respected.
- No new npm dependencies; never `npm install` in this worktree. Web tests and typecheck stay green.
- Commits: plain conventional messages; no Co-Authored-By, no mention of Claude.

## 6. Done means

In a browser against a copy of `~/.aorch` (never the real one), light and dark: Code and Goals match the mockup's
layout; every action listed above works (open/close tabs, edit and save, search, filter, run lock, runs panel and run
pick with marks and diff; goal pick, loop actions, tracker toggles and add, settings and new goal in the dock); tests and
typecheck pass.
