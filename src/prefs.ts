/** Saved display preferences (<home>/ui.json): theme, the web dashboard's crew style, and what the dashboard shows. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type DiffLayout = 'auto' | 'unified' | 'split';

export interface Prefs {
  theme?: string;
  crew?: string;
  /** Spinners and the face animation. Off freezes them (reduced motion). Default on. */
  animate?: boolean;
  /** Live "now doing" lines under running steps. Default on. */
  activity?: boolean;
  /** Cost, duration and stream-rate panel in the run view. Default on. */
  metrics?: boolean;
  /** Mouse clicks in the terminal UI. Default off, so text can be selected and copied. */
  mouse?: boolean;
  /** Steps sparkle, shudder and hand over batons as they finish. Default on. */
  reactions?: boolean;
  /** Side pane in the run view: auto = diff on wide terminals. */
  split?: 'auto' | 'off' | 'diff' | 'events';
  /** Timeline and cost charts drawn with half-block pixels. Default on. */
  graphics?: boolean;
  /** Diff layout: auto picks side by side on wide terminals. */
  diff?: DiffLayout;
  /** Custom colour themes made in the theme editor, by name. Validated on load. */
  themes?: Record<string, unknown>;
  /** Commands Tether proposes: ask each time (default), run without asking, or never. */
  commands?: 'ask' | 'always' | 'off';
  /** API client: the active environment per workspace id (not in the repo, so teammates don't fight over it). */
  httpActiveEnv?: Record<string, string>;
  /** Tether turns asks to build, fix or do something into goal cards. Default on. */
  asksToGoals?: boolean;
  /** Runs stop at their $ caps (workflow maxCostUsd, team defaults, teams' daily $). Default off: costs show, nothing stops. */
  spendingCaps?: boolean;
  /** The app server auto-fixes a failed run: diagnose and retry, then a stronger model. Default on. */
  autoFix?: boolean;
  /** How many auto-fix rounds before it gives up (1 to 6). Default 3. */
  autoFixRounds?: number;
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
    if (typeof j.asksToGoals === 'boolean') out.asksToGoals = j.asksToGoals;
    if (typeof j.spendingCaps === 'boolean') out.spendingCaps = j.spendingCaps;
    if (typeof j.autoFix === 'boolean') out.autoFix = j.autoFix;
    if (Number.isInteger(j.autoFixRounds) && (j.autoFixRounds as number) >= 1 && (j.autoFixRounds as number) <= 6) out.autoFixRounds = j.autoFixRounds as number;
    if (j.commands === 'ask' || j.commands === 'always' || j.commands === 'off') out.commands = j.commands;
    if (j.themes && typeof j.themes === 'object' && !Array.isArray(j.themes)) out.themes = j.themes as Record<string, unknown>;
    if (j.httpActiveEnv && typeof j.httpActiveEnv === 'object' && !Array.isArray(j.httpActiveEnv))
      out.httpActiveEnv = Object.fromEntries(Object.entries(j.httpActiveEnv as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
    return out;
  } catch {
    return {};
  }
}

/** Spending caps are on (read fresh: a change applies to runs started afterwards). */
export const capsOn = (home: string): boolean => loadPrefs(home).spendingCaps === true;

/** Auto-fix failed runs is on (default) and how many rounds it tries (read fresh: a change applies to the next failure). */
export const autoFixOn = (home: string): boolean => loadPrefs(home).autoFix !== false;
export const autoFixRounds = (home: string): number => loadPrefs(home).autoFixRounds ?? 3;

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
