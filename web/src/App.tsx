import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { AttentionItem, Pin, RunRow } from './api';
import { Builder } from './Builder';
import { CommandMenu } from './CommandMenu';
import { ToastStack, ToastStackProvider } from './components/arc/toast-stack/toast-stack';
import { Crew } from './Crew';
import { loadCrewDefs } from './crewStore';
import { GraphView } from './Graph';
import { Home } from './home/Home';
import type { WorkspaceRow } from './home/workspaces';
import { ApiTab } from './http/ApiTab';
import { useHashRoute, usePoll, type Route, type Screen } from './hooks';
import { OpenFolderDialog } from './projects/OpenFolderDialog';
import { liveProjects, projectOf, samePin, usePins, useProjects } from './projects/projects';
import { RemoveProjectDialog } from './projects/RemoveProjectDialog';
import { Runs } from './Runs';
import { useTheme } from './theme';
import { Triggers } from './Triggers';
import { Button } from './components/arc/button/button';
import { Loading } from './components/Loading';
import { cn } from './ui/cn';
import { EmptyState } from './ui/studio/EmptyState';
import { LeaveDialog } from './ui/LeaveDialog';
import { useNotify } from './ui/notify';
import { TOOLS_PATH, type Tools } from './welcome/ToolsStrip';
import { Welcome } from './welcome/Welcome';
import { BottomBar } from './ui/studio/BottomBar';
import { useConnection } from './ui/studio/connection';
import { SettingsDrawer } from './ui/studio/SettingsDrawer';
import { Sidebar } from './ui/studio/Sidebar';
import { PHONE, useMediaQuery } from './ui/studio/useMediaQuery';
import './ui/studio/shell.css';

type ScreenRoute = Omit<Route, 'tab'> & { tab: Screen };

/** CodeMirror is most of the Code screen's weight: it loads the first time Code opens. */
const Code = lazy(() => import('./code/Code').then((m) => ({ default: m.Code })));

/** How often the sidebar's counts (needs you, live) and project dots refresh. */
const COUNTS_MS = 5000;
/** What the leave dialog says about a screen's unsaved work. */
const UNSAVED: Partial<Record<Screen, string>> = { api: 'The open API request has edits that are not saved.', code: 'Some open files have edits that are not saved.' };

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
  /** The file last shown in Code, so the sidebar's Code reopens it. */
  const [lastFile, setLastFile] = useState(route.tab === 'code' ? route.id : undefined);
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
  const tools = usePoll<Tools>(route.tab === 'settings' ? TOOLS_PATH : null, 60_000);
  /** First launch shows the welcome screen until a folder is opened or the person continues without one (this session). */
  const [skipWelcome, setSkipWelcome] = useState(false);
  const welcome = !skipWelcome && projects.list.data?.length === 0;
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
  /** A file a run changed (from its diff) opens in Code, in the project that holds the run's folder. */
  const openFile = (repo: string, file: string) => {
    const w = projectOf(projects.list.data ?? [], repo);
    if (!w) return notify.info(`${repo} is not one of your projects: open it as a folder to see its files`);
    switchProject(w.id, () => go({ tab: 'code', id: file }));
  };
  const openPin = (x: Pin) => {
    const to: Route = x.kind === 'run' ? { tab: 'runs', id: x.id } : { tab: 'api', id: x.id };
    if (x.kind === 'request' && x.ws) switchProject(x.ws, () => goNow(to));
    else go(to);
  };

  useEffect(() => void loadCrewDefs(), []);
  useEffect(() => {
    if (route.tab === 'runs' && route.id) setLastRun(route.id);
    if (route.tab === 'code') setLastFile(route.id);
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

  const openScreen = (s: Screen) => go(s === 'runs' && lastRun ? { tab: 'runs', id: lastRun } : s === 'code' && lastFile ? { tab: 'code', id: lastFile } : { tab: s });
  const openSettings = () => go({ tab: 'settings' });
  const settingsOpen = route.tab === 'settings';
  /** Where focus goes when Settings closes and its opener (a More menu item, the ⌘K field) is gone. */
  const settingsHome = () => shellRef.current?.querySelector<HTMLElement>(phone ? '.sl-bottombar [aria-haspopup="menu"]' : '.sl-side [aria-label="Settings"]');
  const list = projects.list.data ?? [];

  return (
    <>
      {welcome ? (
        <Welcome recent={list} onAdd={async (path) => (await projects.add(path), goNow({ tab: 'code' }))} onPick={(id) => (projects.select(id), goNow({ tab: 'code' }))} onSkip={() => setSkipWelcome(true)} />
      ) : (
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
            {screen.tab === 'code' ? (
              projects.current ? (
                <Suspense fallback={<Loading loading lines={8} label="Loading Code" />}>
                  <Code
                    key={projects.current.id}
                    project={projects.current}
                    path={screen.id}
                    line={screen.line}
                    onPath={(path, line) => goNow(path ? { tab: 'code', id: path, ...(line ? { line } : {}) } : { tab: 'code' })}
                    onOpenRun={(id) => go({ tab: 'runs', id })}
                    onDirtyChange={dirtyFor('code')}
                  />
                </Suspense>
              ) : (
                <NoProject loading={!projects.list.data && !projects.list.error} onOpen={() => setOpenFolder(true)} />
              )
            ) : null}
            {screen.tab === 'builder' ? <Builder pipeline={screen.id} gate={gateDraft} onGateUsed={() => setGateDraft(undefined)} onStarted={(id) => go({ tab: 'runs', id })} /> : null}
            {screen.tab === 'runs' ? (
              <Runs
                selected={screen.id}
                node={screen.node}
                pane={screen.pane}
                project={projects.current}
                onOpenFile={openFile}
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
            {screen.tab === 'graph' ? <GraphView note={screen.id} onNote={(path) => go(path ? { tab: 'graph', id: path } : { tab: 'graph' })} onOpenFile={(path) => go({ tab: 'code', id: path })} /> : null}
            {screen.tab === 'crew' ? <Crew bot={screen.id} onBot={(id) => go(id ? { tab: 'crew', id } : { tab: 'crew' })} /> : null}
            {screen.tab === 'triggers' ? <Triggers /> : null}
          </main>
          {phone ? <BottomBar active={screen.tab} settingsOpen={settingsOpen} onGo={openScreen} onSettings={openSettings} /> : null}
        </div>
      )}
      <SettingsDrawer open={settingsOpen} onClose={() => goNow(screen)} choice={choice} onChoice={setChoice} vault={health.data?.vault} home={health.data?.home} connection={connection} tools={tools} returnFocus={settingsHome} />
      <CommandMenu open={palette} onOpenChange={setPalette} onGo={go} onSettings={openSettings} onTheme={setChoice} ws={projects.current?.id} />
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

/** Code without a project: open a folder first. */
function NoProject(p: { loading: boolean; onOpen: () => void }) {
  return (
    <Loading loading={p.loading} lines={4} label="Loading projects">
      <EmptyState
        title="No project open"
        description="Open a folder to browse its code, see what runs changed and edit files."
        action={
          <Button variant="primary" onClick={p.onOpen}>
            Open folder…
          </Button>
        }
      />
    </Loading>
  );
}
