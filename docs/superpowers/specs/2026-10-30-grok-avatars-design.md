# Agent faces in the Grok bot style: design

## 1. Intent

Replace every generated avatar in Tether with one in-house style that matches the Grok bot look the owner picked from Bible Strong Avatar Lab: a flat single-colour body and two thick, rounded, tilted eyes set up and to the right, the far eye smaller and higher so the face reads as turned. Mood lives in the eyes alone. **Every avatar has a transparent background.**

Approved by the owner on the canvas https://claude.ai/artifact/TaAVdgwHVo41WMMm5P15A2 (board "Option 1, up close"). The reference geometry is `docs/design/avatars/reference-faces.mjs` (throwaway generator used for the mockup) and the render `docs/design/avatars/reference-faces.png`.

Why in-house: the Bible Strong renderer is AGPL-3.0-only and Tether is MIT. **Do not copy any code, SVG or asset from that project** (github.com/smontlouis/bible-strong-avatar-lab); draw from the reference generator in this repo only.

## 2. Goals

1. One pure module draws a face as an SVG string: body + colour + mood, transparent background (no background shape, rect or squircle; nothing painted outside the body).
2. `Face` (`web/src/Face.tsx`) renders it everywhere it renders blobatar today, static (`<img>` data URI) and animated (`animate: 'hover' | 'always'`, inline SVG).
3. Each bot's body and colour come from its id, deterministically; the Crew editor can pin them.
4. Moods for all seven `Mood` values.
5. blobatar and `@blobatar/react` are removed from the dependencies.

## 3. Non-goals

- Tether's own face (`TetherFace`, the eye tracker for `orchestrator`) stays as it is; only check it paints no background behind the ball.
- Team avatars (initial in a rounded square) stay.
- Steering teammates in one team apart in colour (later, if wanted).
- The terminal (TUI) look.

## 4. Anti-goals

- Any code or artwork from the Bible Strong project (AGPL).
- An opaque square or circle behind a face, in any theme.
- A black body vanishing on a dark background.

## 5. Design

### 5.1 The art (`web/src/faceArt.ts`, new, pure, no React)

Port `reference-faces.mjs` to TypeScript:

- **Bodies (8):** `orb`, `tile`, `bean`, `drop`, `nub`, `cloud`, `flower`, `block`, each with its face circle `(cx, cy, r)` in a 100×100 viewBox, as in the reference.
- **Colours (10):** `#5E7FE6 #E8835F #F7D02C #58B6C4 #0B0B0C #E5935A #FBC3E6 #C9CACD #E35A5A #DCE3F5`. Eye ink `#17181A`, except white on `#0B0B0C` and `#3D4A63` on `#FBC3E6`.
- **Eyes:** as the reference's final version (W = 0.29r, H = 0.52r, near eye at (+0.2r, −0.36r) tilted −20°, far eye at (+0.6r, −0.47r) at 0.8W × 0.76H tilted −22°).
- **Moods:** idle, working, done, failed, asleep exactly as the reference. Two more Tether uses:
  - `waiting`: eyes glance left (toward the content), idle size;
  - `stopped`: short flat pills, near-horizontal.

  The builder draws both in the same language.
- **Pick from id:** a stable 32-bit hash of the id (FNV-1a plus a final mix, as in the reference) picks body = `h % 8` and colour = `(h >>> 8) % 10`. Built-in bots get hand-set looks matching the mockup: planner/Scout blue orb, architect/Brick orange block, coder/Bolt black orb, tester/Probe teal bean, reviewer/Lens yellow drop, manager/Boss red tile, approval/Gate grey cloud.
- **API (my call, the builder may refine):** `faceArt(id, { mood, body?, color?, size?, title? }): string` and `faceParts(...)` for the animated path (body markup and eye markup separately, so CSS can move the eyes).
- **Dark mode:** for `#0B0B0C` bodies, add `data-dark-body` on the element. In the dark theme, CSS gives it a 1px hairline (a `drop-shadow` filter works on both `<img>` and inline SVG) so it doesn't vanish.

### 5.2 `Face`

- **Static:** `<img src=data URI>` as today, built with `faceArt`.
- **Animated:** inline SVG. Small CSS loops in a Face stylesheet:
  - a slow 2–3 px bob;
  - a blink every few seconds (eyes `scaleY` to ~0.1 for ~120 ms);
  - in `working`, a slow glance.

  `hover` plays only while hovered, `always` loops. Honour `prefers-reduced-motion` (no motion). Keep `role="img"`, `aria-label`, `data-mood` and the `face` class.
- **Keep `MOOD_EXPRESSION`/`moodFor` signatures** (other code imports them). Rename what refers to blobatar.
- **Remove any background** the `.face` class or wrappers add (radius plus fill). Faces sit on whatever is behind them.

### 5.3 Saved looks (`FaceLook`)

Web `crewStore.ts` and server `src/crew.ts`: `FaceLook` becomes `{ body?: string; color?: string }`.
- **Server cleaning:** `cleanFace` keeps `body` only when it is one of the 8 names, and `color` only when it is one of the 10 palette hexes (case-insensitive, stored upper-case).
- **Old saved faces:** `hue`/`tone`/`traits` from old saved bots are dropped silently.
- **Imported bots:** `eccImport.ts` `faceOnDisk` keeps working with the new shape.
- Update server tests.

### 5.4 Crew editor (`web/src/crew/BotEditor.tsx`)

Replace the Hue and Tone sliders with:
- a **Body** row of the 8 bodies as small face buttons;
- a **Colour** row of the 10 swatches.

Both use the existing Studio controls and spacing. Each button is a real `<button>`, `aria-pressed` for the picked one, with an aria-label of the body/colour name. Reset stays and clears both. The live preview (`Face` at 72, `animate="hover"`) shows the picked look.

### 5.5 Goal assignees (`web/src/goals/Avatars.tsx`)

An agent assignee becomes a `Face` (size 22/26) instead of a plain colour dot; removed agents stay greyed (opacity/grayscale). Teams unchanged.

## 6. Constraints

- **Repo rules:** MIT, no new dependencies, TypeScript strict. Run the repo's `check` script (CI's required check "check") before calling it done.
- **Tests:**
  - `faceArt`: deterministic per id; every body × colour × mood renders valid SVG with **no background element** (assert the first child is body, not a full-box rect/path); dark-body marker; built-in looks; picks override the id.
  - `cleanFace` accepts or drops values correctly.
  - `Face`: static `<img>`, animated inline SVG, `aria-label`.
  - BotEditor: picking a body and colour calls `onFace`.
  - Update the Face snapshot.
- **Commits:** no Co-Authored-By trailers and no mention of Claude/AI in commits or PR text (owner rule).

## 7. Left to the builder

- Exact SVG of `waiting` and `stopped`.
- Animation timings.
- Whether `faceParts` or a single function with a flag serves the animated path.
- The Face stylesheet location.
- Small refactors needed where blobatar types leaked (e.g. `BlobatarOptions`).

## 8. My calls (owner: check)

- Tether's own eye-tracker face stays; only the bots change.
- Built-in bots get the mockup's hand-set looks; every other bot's look comes from its id.
- Old hue/tone face pins are dropped, not converted.
- Goal assignee dots become real faces.
