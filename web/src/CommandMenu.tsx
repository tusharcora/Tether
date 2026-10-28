import { useEffect, useMemo, useState } from 'react';
import { runTitle } from '../../src/runLabels';
import type { RunRow } from './api';
import { codeApi } from './code/codeApi';
import { CommandPalette, type CommandItem } from './components/beui/motion/command-palette';
import { SCREENS, TAB_LABEL, usePoll, type Route, type Screen } from './hooks';
import { THEME_LABEL, type ThemeChoice } from './theme';
import { goHint } from './ui/studio/nav';

const THEMES: ThemeChoice[] = ['light', 'dark', 'system'];
const FILES_MS = 150;

/** The current project's files whose names match what is typed (two characters or more), for the Files group. */
function useFileHits(ws: string | undefined, q: string): { query: string; paths: string[] } {
  const [hits, setHits] = useState({ query: '', paths: [] as string[] });
  useEffect(() => {
    const text = q.trim();
    if (!ws || text.length < 2) return setHits({ query: '', paths: [] });
    let live = true;
    const t = setTimeout(() => {
      codeApi.searchNames(ws, text).then(
        (r) => live && setHits({ query: text, paths: r.hits.map((h) => h.path) }),
        () => live && setHits({ query: '', paths: [] }),
      );
    }, FILES_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [ws, q]);
  return hits;
}

/** Cmd/Ctrl-K: go to a screen, open Settings, pick a theme, jump to a recent run, a saved workflow or a file of the current project (`ws`). */
export function CommandMenu(props: { open: boolean; onOpenChange: (o: boolean) => void; onGo: (r: Route) => void; onSettings: () => void; onTheme: (c: ThemeChoice) => void; ws?: string; goals?: { id: string; title: string; status: string }[]; onNewGoal?: () => void }) {
  const runs = usePoll<RunRow[]>(props.open ? '/api/runs' : null, 10_000);
  const flows = usePoll<{ name: string }[]>(props.open ? '/api/pipelines' : null, 30_000);
  const [q, setQ] = useState('');
  const files = useFileHits(props.open ? props.ws : undefined, q);
  // focus goes back to the opener; when there was none (⌘K from the page) or it is gone, to the screen, never the body
  const refocus = () =>
    setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) document.querySelector<HTMLElement>('.shell-main')?.focus({ preventScroll: true });
    });
  const pick = (id: string) => {
    const i = id.indexOf(':');
    const kind = id.slice(0, i);
    const value = id.slice(i + 1);
    if (kind === 'go') props.onGo({ tab: value as Screen });
    else if (kind === 'open') props.onSettings();
    else if (kind === 'theme') props.onTheme(value as ThemeChoice);
    else if (kind === 'run') props.onGo({ tab: 'runs', id: value });
    else if (kind === 'file') props.onGo({ tab: 'code', id: value });
    else if (kind === 'goal') props.onGo({ tab: 'goals', id: value });
    else if (kind === 'new') props.onNewGoal?.();
    else props.onGo({ tab: 'builder', id: value });
    refocus();
  };
  const items = useMemo<CommandItem[]>(() => {
    const it = (id: string, label: string, group: string, extra: Partial<CommandItem> = {}): CommandItem => ({ id, label, group, onSelect: () => pick(id), ...extra });
    return [
      // each screen shows its Linear-style shortcut (G then a letter), so the menu doubles as the shortcut help
      ...SCREENS.map((s) => it(`go:${s}`, `Go to ${TAB_LABEL[s]}`, 'Go to', { hint: goHint(s) })),
      it('open:settings', 'Open Settings', 'Go to', { hint: '⌘,' }),
      ...(props.onNewGoal ? [it('new:goal', 'New goal', 'Create', { description: 'An outcome loop or a tracker' })] : []),
      ...THEMES.map((c) => it(`theme:${c}`, `Theme: ${THEME_LABEL[c]}`, 'Theme')),
      ...(runs.data ?? []).slice(0, 10).map((r) => it(`run:${r.id}`, r.task.split('\n')[0]!.slice(0, 80), 'Recent runs', { description: `${runTitle(r)} · ${r.status}`, keywords: [r.id] })),
      ...(props.goals ?? []).slice(0, 10).map((g) => it(`goal:${g.id}`, g.title, 'Goals', { description: g.status.replace('_', ' ') })),
      ...(flows.data ?? []).map((f) => it(`flow:${f.name}`, f.name, 'Workflows', { description: 'Open in Builder' })),
      // fuzzy name matches: the typed text rides along as a keyword so the palette's own filter keeps them
      ...files.paths.map((path) => it(`file:${path}`, path, 'Files', { description: 'Open in Code', keywords: [files.query] })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs.data, flows.data, files, props.goals, props.onNewGoal, props.onGo, props.onSettings, props.onTheme]);
  return <CommandPalette items={items} open={props.open} onOpenChange={props.onOpenChange} shortcut={null} label="Jump to" placeholder="Search screens, runs, workflows, files" onQueryChange={setQ} />;
}
