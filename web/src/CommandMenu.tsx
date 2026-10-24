import { useMemo } from 'react';
import type { RunRow } from './api';
import { CommandPalette, type CommandItem } from './components/arc/command-palette/command-palette';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { TAB_LABEL, TABS, usePoll, type Route, type Tab } from './hooks';

/** Ctrl/Cmd-K: jump to a tab, a recent run or a saved workflow. Arc's palette is an inline panel, so it sits in a Dialog. */
export function CommandMenu(props: { open: boolean; onOpenChange: (o: boolean) => void; onGo: (r: Route) => void }) {
  const runs = usePoll<RunRow[]>(props.open ? '/api/runs' : null, 10_000);
  const flows = usePoll<{ name: string }[]>(props.open ? '/api/pipelines' : null, 30_000);
  const items = useMemo<CommandItem[]>(
    () => [
      ...TABS.map((t) => ({ id: `tab:${t}`, label: `Go to ${TAB_LABEL[t]}`, group: 'Tabs' })),
      ...(runs.data ?? []).slice(0, 10).map((r) => ({
        id: `run:${r.id}`,
        label: r.task.split('\n')[0]!.slice(0, 80),
        description: `${r.kind === 'team' ? 'Team run' : r.pipeline} · ${r.status}`,
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
    if (kind === 'tab') props.onGo({ tab: value as Tab });
    else if (kind === 'run') props.onGo({ tab: 'runs', id: value });
    else props.onGo({ tab: 'builder', id: value });
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <DialogContent title="Jump to" description="Tabs, recent runs and saved workflows">
          <CommandPalette items={items} autoFocus label="Jump to" placeholder="Search tabs, runs, workflows" onSelect={pick} onClose={() => props.onOpenChange(false)} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
