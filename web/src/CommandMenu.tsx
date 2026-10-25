import { useMemo } from 'react';
import { runTitle } from '../../src/runLabels';
import type { RunRow } from './api';
import { CommandPalette, type CommandItem } from './components/arc/command-palette/command-palette';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { SCREENS, TAB_LABEL, usePoll, type Route, type Screen } from './hooks';
import { THEME_LABEL, type ThemeChoice } from './theme';

const THEMES: ThemeChoice[] = ['light', 'dark', 'system'];

/** Cmd/Ctrl-K: go to a screen, open Settings, pick a theme, jump to a recent run or a saved workflow. */
export function CommandMenu(props: { open: boolean; onOpenChange: (o: boolean) => void; onGo: (r: Route) => void; onSettings: () => void; onTheme: (c: ThemeChoice) => void }) {
  const runs = usePoll<RunRow[]>(props.open ? '/api/runs' : null, 10_000);
  const flows = usePoll<{ name: string }[]>(props.open ? '/api/pipelines' : null, 30_000);
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
    ],
    [runs.data, flows.data],
  );
  const pick = (item: CommandItem) => {
    const i = item.id.indexOf(':');
    const kind = item.id.slice(0, i);
    const value = item.id.slice(i + 1);
    props.onOpenChange(false);
    if (kind === 'go') props.onGo({ tab: value as Screen });
    else if (kind === 'open') props.onSettings();
    else if (kind === 'theme') props.onTheme(value as ThemeChoice);
    else if (kind === 'run') props.onGo({ tab: 'runs', id: value });
    else props.onGo({ tab: 'builder', id: value });
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <DialogContent title="Jump to" description="Screens, settings, recent runs and saved workflows">
          <CommandPalette items={items} autoFocus label="Jump to" placeholder="Search screens, runs, workflows" onSelect={pick} onClose={() => props.onOpenChange(false)} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
