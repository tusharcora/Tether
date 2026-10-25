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

const langCache = new Map<string, { at: number; dir: string; langs: Set<string> }>();

/** The repo scan, cached per workspace for 60 s (the preview is asked as the person types). */
export function workspaceLanguages(key: string, dir: string, now = Date.now()): Set<string> {
  const hit = langCache.get(key);
  if (hit && hit.dir === dir && now - hit.at < LANG_TTL_MS) return hit.langs;
  const langs = detectLanguages(dir);
  langCache.set(key, { at: now, dir, langs });
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
