/** Saved display preferences (<home>/ui.json): theme, crew style, and what the dashboard shows. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type DiffLayout = 'auto' | 'unified' | 'split';

export interface Prefs {
  theme?: string;
  crew?: string;
  /** Spinners and bot animation. Off freezes them (reduced motion). Default on. */
  animate?: boolean;
  /** Live "now doing" lines under running steps. Default on. */
  activity?: boolean;
  /** Cost, duration and stream-rate panel in the run view. Default on. */
  metrics?: boolean;
  /** Mouse clicks in the terminal UI. Default off, so text can be selected and copied. */
  mouse?: boolean;
  /** Bots cheer, shake and hand over batons as steps finish. Default on. */
  reactions?: boolean;
  /** Side pane in the run view: auto = diff on wide terminals. */
  split?: 'auto' | 'off' | 'diff' | 'events';
  /** Timeline and cost charts drawn with half-block pixels. Default on. */
  graphics?: boolean;
  /** Diff layout: auto picks side by side on wide terminals. */
  diff?: DiffLayout;
  /** Custom colour themes made in the theme editor, by name. Validated on load. */
  themes?: Record<string, unknown>;
  /** Commands Maestro proposes: ask each time (default), run without asking, or never. */
  commands?: 'ask' | 'always' | 'off';
}

export function loadPrefs(home: string): Prefs {
  try {
    const j = JSON.parse(readFileSync(join(home, 'ui.json'), 'utf8')) as Record<string, unknown>;
    const out: Prefs = {};
    if (typeof j.theme === 'string') out.theme = j.theme;
    if (typeof j.crew === 'string') out.crew = j.crew;
    if (typeof j.animate === 'boolean') out.animate = j.animate;
    if (typeof j.activity === 'boolean') out.activity = j.activity;
    if (typeof j.metrics === 'boolean') out.metrics = j.metrics;
    if (typeof j.mouse === 'boolean') out.mouse = j.mouse;
    if (typeof j.reactions === 'boolean') out.reactions = j.reactions;
    if (j.split === 'auto' || j.split === 'off' || j.split === 'diff' || j.split === 'events') out.split = j.split;
    if (typeof j.graphics === 'boolean') out.graphics = j.graphics;
    if (j.diff === 'auto' || j.diff === 'unified' || j.diff === 'split') out.diff = j.diff;
    if (j.commands === 'ask' || j.commands === 'always' || j.commands === 'off') out.commands = j.commands;
    if (j.themes && typeof j.themes === 'object' && !Array.isArray(j.themes)) out.themes = j.themes as Record<string, unknown>;
    return out;
  } catch {
    return {};
  }
}

export function savePrefs(home: string, patch: Prefs): Prefs {
  const next = { ...loadPrefs(home), ...patch };
  mkdirSync(home, { recursive: true });
  const f = join(home, 'ui.json');
  writeFileSync(`${f}.tmp`, JSON.stringify(next) + '\n');
  renameSync(`${f}.tmp`, f);
  return next;
}

/** Remove a saved custom theme. */
export function deleteTheme(home: string, name: string): Prefs {
  const cur = loadPrefs(home);
  const themes = { ...(cur.themes ?? {}) };
  delete themes[name];
  const next: Prefs = { ...cur, themes };
  mkdirSync(home, { recursive: true });
  const f = join(home, 'ui.json');
  writeFileSync(`${f}.tmp`, JSON.stringify(next) + '\n');
  renameSync(`${f}.tmp`, f);
  return next;
}
