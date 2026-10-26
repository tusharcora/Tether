import { useEffect, useRef, useState } from 'react';
import type { AttentionItem, Pin, RunRow } from './api';
import { Builder } from './Builder';
import { CommandMenu } from './CommandMenu';
import { Button } from './components/arc/button/button';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { ToastStack, ToastStackProvider } from './components/arc/toast-stack/toast-stack';
import { Crew } from './Crew';
import { loadCrewDefs } from './crewStore';
import { GraphView } from './Graph';
import { Home } from './home/Home';
import type { WorkspaceRow } from './home/workspaces';
import { ApiTab } from './http/ApiTab';
import { useHashRoute, usePoll, type Route, type Screen } from './hooks';
import { OpenFolderDialog } from './projects/OpenFolderDialog';
import { liveProjects, samePin, usePins, useProjects } from './projects/projects';
import { RemoveProjectDialog } from './projects/RemoveProjectDialog';
import { Runs } from './Runs';
import { useTheme } from './theme';
import { Triggers } from './Triggers';
import { cn } from './ui/cn';
import { useNotify } from './ui/notify';
import { BottomBar } from './ui/studio/BottomBar';
import { useConnection } from './ui/studio/connection';
import { SettingsDrawer } from './ui/studio/SettingsDrawer';
import { Sidebar } from './ui/studio/Sidebar';
import { PHONE, useMediaQuery } from './ui/studio/useMediaQuery';
import './ui/studio/shell.css';

type ScreenRoute = Omit<Route, 'tab'> & { tab: Screen };

/** How often the sidebar's counts (needs you, live) and project dots refresh. */
const COUNTS_MS = 5000;
/** What the leave dialog says about a screen's unsaved work. */
const UNSAVED: Partial<Record<Screen, string>> = { api: 'The open API request has edits that are not saved.' };

const isTextField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export function App() {
  return (
    <ToastStackProvider>
      <Shell />
      <ToastStack />
    </ToastStackProvider>
  );
}

function Shell() {
  const notify = useNotify();
  /** Screens holding unsaved work: leaving one, or switching project under it, asks first (the screen unmounts and the work would be lost). */
  const [dirty, setDirty] = useState<Partial<Record<Screen, boolean>>>({});
  const [leaving, setLeaving] = useState<{ then: () => void; text: string }>();
  /** The screen shown under the Settings drawer. Settings opens over it and it stays mounted. */
  const screenRef = useRef<ScreenRoute>({ tab: 'home' });
  const dirtyHere = () => !!dirty[screenRef.current.tab];
  const leaves = (next: Route) => dirtyHere() && next.tab !== screenRef.current.tab && next.tab !== 'settings';
  const ask = (then: () => void) => setLeaving({ then, text: UNSAVED[screenRef.current.tab] ?? 'This screen has edits that are not saved.' });
  const [route, goNow] = useHashRoute(leaves, (next) => ask(() => goNow(next)));
  if (route.tab !== 'settings') screenRef.current = route as ScreenRoute;
  const screen = screenRef.current;
  const dirtyFor = (s: Screen) => (d: boolean) => setDirty((x) => (!!x[s] === d ? x : { ...x, [s]: d }));

  /** Every way out of a screen (sidebar, bottom bar, ⌘K, in-screen links) comes through here; browser moves through the hook's guard. */
  const go = (r: Route) => (leaves(r) ? ask(() => goNow(r)) : goNow(r));
  const [lastRun, setLastRun] = useState(route.tab === 'runs' ? route.id : undefined);
  const { choice, setChoice } = useTheme();
  const [palette, setPalette] = useState(false);
  const [openFolder, setOpenFolder] = useState(false);
  const [removing, setRemoving] = useState<WorkspaceRow>();
  /** A request gate handed over by the API tab, waiting for the Builder to place it (cleared once used). */
  const [gateDraft, setGateDraft] = useState<{ run: string; env?: string }>();
  const health = usePoll<{ ok: boolean; vault?: string; home?: string }>('/api/health', 5000);
  const connection = useConnection(health);
  const phone = useMediaQuery(PHONE);
  const shellRef = useRef<HTMLDivElement>(null);

  const projects = useProjects();
  const runs = usePoll<RunRow[]>('/api/runs', COUNTS_MS);
  const attention = usePoll<{ items: AttentionItem[] }>('/api/attention', COUNTS_MS);
  const { pins, save: savePins } = usePins();
  /** The saved request open in the API tab, so the sidebar can pin it. */
  const [apiOpen, setApiOpen] = useState<{ id: string; label: string }>();

  /** Switch the current project; unsaved work on the screen under it is asked about first. */
  const switchProject = (id: string, then?: () => void) => {
    const move = () => (projects.select(id), then?.());
    if (id === projects.current?.id) return then?.();
    if (dirtyHere()) ask(move);
    else move();
  };
  const runLabel = (id: string) => runs.data?.find((r) => r.id === id)?.task.split('\n')[0]!.slice(0, 80) || id;
  const pinHere: Pin | undefined =
    screen.tab === 'runs' && screen.id
      ? { kind: 'run', id: screen.id, label: runLabel(screen.id) }
      : screen.tab === 'api' && apiOpen
        ? { kind: 'request', id: apiOpen.id, label: apiOpen.label, ...(projects.current ? { ws: projects.current.id } : {}) }
        : undefined;
  const savePinsOr = (next: Pin[]) => void savePins(next).catch(notify.fail);
  const openPin = (x: Pin) => {
    const to: Route = x.kind === 'run' ? { tab: 'runs', id: x.id } : { tab: 'api', id: x.id };
    if (x.kind === 'request' && x.ws) switchProject(x.ws, () => goNow(to));
    else go(to);
  };

  useEffect(() => void loadCrewDefs(), []);
  useEffect(() => {
    if (route.tab === 'runs' && route.id) setLastRun(route.id);
  }, [route]);
  const keys = useRef({ settings: () => {}, folder: () => {} });
  keys.current = { settings: () => go({ tab: 'settings' }), folder: () => setOpenFolder(true) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === ',') return e.preventDefault(), keys.current.settings();
      if (k === 'o' && !e.shiftKey) return e.preventDefault(), keys.current.folder();
      if (k !== 'k') return;
      // Ctrl-K edits text in fields (macOS: delete to end of line); only Meta-K is taken there
      if (!e.metaKey && isTextField(e.target)) return;
      e.preventDefault();
      setPalette(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openScreen = (s: Screen) => go(s === 'runs' && lastRun ? { tab: 'runs', id: lastRun } : { tab: s });
  const openSettings = () => go({ tab: 'settings' });
  const settingsOpen = route.tab === 'settings';
  /** Where focus goes when Settings closes and its opener (a More menu item, the ⌘K field) is gone. */
  const settingsHome = () => shellRef.current?.querySelector<HTMLElement>(phone ? '.sl-bottombar [aria-haspopup="menu"]' : '.sl-side [aria-label="Settings"]');
  const list = projects.list.data ?? [];

  return (
    <>
      <div ref={shellRef} className={cn('shell', { phone })}>
        {phone ? null : (
          <Sidebar
            active={screen.tab}
            settingsOpen={settingsOpen}
            onGo={openScreen}
            onSearch={() => setPalette(true)}
            onSettings={openSettings}
            counts={{ needs: attention.data?.items.length ?? 0, live: runs.data?.filter((r) => r.live).length ?? 0 }}
            projects={{ list, current: projects.current?.id, live: liveProjects(list, runs.data ?? []), onSelect: (id) => switchProject(id), onAdd: () => setOpenFolder(true), onRemove: setRemoving }}
            pins={{ list: pins, canPin: !!pinHere && !pins.some((x) => samePin(x, pinHere)), onPin: () => pinHere && savePinsOr([...pins, pinHere]), onOpen: openPin, onUnpin: (x) => savePinsOr(pins.filter((y) => !samePin(x, y))) }}
          />
        )}
        <main className="shell-main" tabIndex={-1}>
          {screen.tab === 'home' ? <Home onGo={go} /> : null}
          {screen.tab === 'builder' ? <Builder pipeline={screen.id} gate={gateDraft} onGateUsed={() => setGateDraft(undefined)} onStarted={(id) => go({ tab: 'runs', id })} /> : null}
          {screen.tab === 'runs' ? (
            <Runs
              selected={screen.id}
              node={screen.node}
              pane={screen.pane}
              project={projects.current}
              onSelect={(id) => go(id ? { tab: 'runs', id } : { tab: 'runs' })}
              onSelectNode={(node) => screen.id && go({ tab: 'runs', id: screen.id, ...(node ? { node } : {}) })}
              onStart={() => go({ tab: 'home' })}
            />
          ) : null}
          {screen.tab === 'api' ? (
            <ApiTab
              workspace={projects.current?.id}
              onWorkspace={projects.select}
              request={screen.id}
              onOpenRequest={setApiOpen}
              onStarted={(id) => go({ tab: 'runs', id })}
              onUseAsGate={(g) => (setGateDraft(g), go({ tab: 'builder' }))}
              onDirtyChange={dirtyFor('api')}
            />
          ) : null}
          {screen.tab === 'graph' ? <GraphView note={screen.id} onNote={(path) => go(path ? { tab: 'graph', id: path } : { tab: 'graph' })} /> : null}
          {screen.tab === 'crew' ? <Crew bot={screen.id} onBot={(id) => go(id ? { tab: 'crew', id } : { tab: 'crew' })} /> : null}
          {screen.tab === 'triggers' ? <Triggers /> : null}
        </main>
        {phone ? <BottomBar active={screen.tab} settingsOpen={settingsOpen} onGo={openScreen} onSettings={openSettings} /> : null}
      </div>
      <SettingsDrawer open={settingsOpen} onClose={() => goNow(screen)} choice={choice} onChoice={setChoice} vault={health.data?.vault} home={health.data?.home} connection={connection} returnFocus={settingsHome} />
      <CommandMenu open={palette} onOpenChange={setPalette} onGo={go} onSettings={openSettings} onTheme={setChoice} />
      <OpenFolderDialog open={openFolder} onOpenChange={setOpenFolder} onAdd={projects.add} />
      <RemoveProjectDialog
        project={removing}
        onCancel={() => setRemoving(undefined)}
        onRemove={(w) => {
          setRemoving(undefined);
          projects.remove(w.id).then(() => notify.ok(`Removed ${w.name}`, 'Its folder is untouched.'), notify.fail);
        }}
      />
      <LeaveDialog
        text={leaving?.text}
        onKeep={() => setLeaving(undefined)}
        onDiscard={() => {
          const then = leaving?.then;
          setLeaving(undefined);
          setDirty({});
          then?.();
        }}
      />
    </>
  );
}

/** Asks before unsaved work is dropped by leaving its screen or switching project. */
function LeaveDialog(p: { text: string | undefined; onKeep: () => void; onDiscard: () => void }) {
  return (
    <Dialog open={!!p.text} onOpenChange={(o) => !o && p.onKeep()}>
      {p.text ? (
        <DialogContent className="api-dialog" title="Discard unsaved changes?" description={p.text}>
          <div className="row end">
            <Button variant="secondary" onClick={p.onKeep}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={p.onDiscard}>
              Discard
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
