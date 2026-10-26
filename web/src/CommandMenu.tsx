import { useEffect, useMemo, useState } from 'react';
import { runTitle } from '../../src/runLabels';
import type { RunRow } from './api';
import { codeApi } from './code/codeApi';
import { CommandPalette, type CommandItem } from './components/arc/command-palette/command-palette';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { SCREENS, TAB_LABEL, usePoll, type Route, type Screen } from './hooks';
import { THEME_LABEL, type ThemeChoice } from './theme';

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
export function CommandMenu(props: { open: boolean; onOpenChange: (o: boolean) => void; onGo: (r: Route) => void; onSettings: () => void; onTheme: (c: ThemeChoice) => void; ws?: string }) {
  const runs = usePoll<RunRow[]>(props.open ? '/api/runs' : null, 10_000);
  const flows = usePoll<{ name: string }[]>(props.open ? '/api/pipelines' : null, 30_000);
  const [q, setQ] = useState('');
  const files = useFileHits(props.open ? props.ws : undefined, q);
  const items = useMemo<CommandItem[]>(
    () => [
      ...SCREENS.map((s) => ({ id: `go:${s}`, label: `Go to ${TAB_LABEL[s]}`, group: 'Go to' })),
      { id: 'open:settings', label: 'Open Settings', group: 'Go to' },
      ...THEMES.map((c) => ({ id: `theme:${c}`, label: `Theme: ${THEME_LABEL[c]}`, group: 'Theme' })),
      ...(runs.data ?? []).slice(0, 10).map((r) => ({
        id: `run:${r.id}`,
        label: r.task.split('\n')[0]!.slice(0, 80),
        description: `${runTitle(r)} · ${r.status}`,
        group: 'Recent runs',
        keywords: [r.id],
      })),
      ...(flows.data ?? []).map((f) => ({ id: `flow:${f.name}`, label: f.name, description: 'Open in Builder', group: 'Workflows' })),
      // fuzzy name matches: the typed text rides along as a keyword so the palette's own filter keeps them
      ...files.paths.map((path) => ({ id: `file:${path}`, label: path, description: 'Open in Code', group: 'Files', keywords: [files.query] })),
    ],
    [runs.data, flows.data, files],
  );
  // focus goes back to the opener; when there was none (⌘K from the page) or it is gone, to the screen, never the body
  const refocus = () =>
    setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) document.querySelector<HTMLElement>('.shell-main')?.focus({ preventScroll: true });
    });
  const pick = (item: CommandItem) => {
    const i = item.id.indexOf(':');
    const kind = item.id.slice(0, i);
    const value = item.id.slice(i + 1);
    props.onOpenChange(false);
    if (kind === 'go') props.onGo({ tab: value as Screen });
    else if (kind === 'open') props.onSettings();
    else if (kind === 'theme') props.onTheme(value as ThemeChoice);
    else if (kind === 'run') props.onGo({ tab: 'runs', id: value });
    else if (kind === 'file') props.onGo({ tab: 'code', id: value });
    else props.onGo({ tab: 'builder', id: value });
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <DialogContent title="Jump to" description="Screens, settings, recent runs, saved workflows and files" onCloseAutoFocus={refocus}>
          <CommandPalette items={items} autoFocus label="Jump to" placeholder="Search screens, runs, workflows, files" onSelect={pick} onClose={() => props.onOpenChange(false)} onQueryChange={setQ} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
