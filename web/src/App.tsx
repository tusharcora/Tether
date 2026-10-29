import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { AttentionItem, Pin, RunRow } from './api';
import { assistantApi, chatsPath, type ChatSummary } from './assistant/api';
import { Assistant } from './assistant/Assistant';
import { useActiveChat, useAssistant } from './assistant/useAssistant';
import { useAssistantShell } from './assistant/useAssistantShell';
import { contextOf } from './assistant/context';
import { AllChats } from './chats/AllChats';
import { Conversation } from './chats/Conversation';
import { NewChat } from './chats/NewChat';
import { Builder } from './Builder';
import { CommandMenu } from './CommandMenu';
import { ToastStack, ToastStackProvider } from './components/beui/kit/toast';
import { Crew } from './Crew';
import { loadCrewDefs } from './crewStore';
import { GraphView } from './Graph';
import { Goals } from './goals/Goals';
import { inProject, isOpen, useGoals } from './goals/goalsApi';
import { Home } from './home/Home';
import { Inbox } from './home/Inbox';
import type { WorkspaceRow } from './home/workspaces';
import { ApiTab } from './http/ApiTab';
import { bridge, useBridgeEvents } from './bridge';
import { useHashRoute, usePoll, type Route, type Screen } from './hooks';
import { OpenFolderDialog } from './projects/OpenFolderDialog';
import { liveProjects, projectOf, runProject, samePin, usePins, useProjects } from './projects/projects';
import { RemoveProjectDialog } from './projects/RemoveProjectDialog';
import { Runs } from './Runs';
import { NewTeam } from './teams/NewTeam';
import { TeamScreen } from './teams/TeamScreen';
import { TEAMS_PATH, type TeamsReply } from './teams/teamsApi';
import { useTheme } from './theme';
import { Triggers } from './Triggers';
import { Button } from './components/beui/kit/Button';
import { Loading } from './components/Loading';
import { cn } from './ui/cn';
import { EmptyState } from './ui/studio/EmptyState';
import { LeaveDialog } from './ui/LeaveDialog';
import { useNotify } from './ui/notify';
import { useAppSignals, useNotifyPref } from './useAppSignals';
import { TOOLS_PATH, type Tools } from './welcome/ToolsStrip';
import { Welcome } from './welcome/Welcome';
import { MCP_PATH, type McpServerView } from './settings/McpServers';
import { CONNECTORS_PATH, type ConnectorView } from './settings/Connectors';
import { ACCOUNTS_MS, ACCOUNTS_PATH, accountChip, type AccountsView } from './settings/accountsApi';
import { BottomBar } from './ui/studio/BottomBar';
import { useConnection } from './ui/studio/connection';
import { SettingsPage } from './ui/studio/SettingsPage';
import { Sidebar } from './ui/studio/Sidebar';
import { isTyping, useGoKeys } from './ui/studio/useGoKeys';
import { CREATE_SCREEN, type CreateKind } from './ui/studio/nav';
import { PHONE, useMediaQuery } from './ui/studio/useMediaQuery';
import './ui/studio/shell.css';

type ScreenRoute = Omit<Route, 'tab'> & { tab: Screen };

/** CodeMirror is most of the Code screen's weight: it loads the first time Code opens. */
const Code = lazy(() => import('./code/Code').then((m) => ({ default: m.Code })));

/** How often the sidebar's counts (needs you, live) and project dots refresh. */
const COUNTS_MS = 5000;
/** How often the sidebar's chat titles refresh (a new chat also refreshes them at once). */
const CHATS_MS = 10_000;
/** What the leave dialog says about a screen's unsaved work. */
const UNSAVED: Partial<Record<Screen, string>> = { api: 'The open API request has edits that are not saved.', code: 'Some open files have edits that are not saved.' };


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
  /** The screen shown under the Settings page. Settings opens over it and it stays mounted. */
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
  /** The last screen that is not a chat: Pop out goes back to it. */
  const lastOther = useRef<ScreenRoute>({ tab: 'home' });
  if (screen.tab !== 'chats') lastOther.current = screen;
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
  /** The project's chats: the sidebar's Chats section and the mini chat's switcher. */
  const chats = usePoll<{ chats: ChatSummary[] }>(chatsPath(projects.current?.id), CHATS_MS);
  /** Every team, for the sidebar's Teams section (its dots: working, needs you). */
  const teams = usePoll<TeamsReply>(TEAMS_PATH, COUNTS_MS);
  /**
   * Tether: the panel (mini chat) and the full-screen chat show one active chat per project. A chat screen's route makes its
   * chat the active one; a new chat's first message makes the chat (and, on New chat, moves to it); a chat that is gone
   * falls back to a new one.
   */
  const shell = useAssistantShell({ needs: attention.data?.items.length ?? 0, phone });
  const [activeChat, setActiveChat] = useActiveChat(projects.current?.id);
  const onChatScreen = screen.tab === 'chats' && !!screen.id;
  const chat = useAssistant(projects.current?.id, activeChat, shell.mode !== 'closed' || screen.tab === 'chats', {
    created: (id) => {
      setActiveChat(id);
      void chats.refresh();
      if (screenRef.current.tab === 'chats' && screenRef.current.id === 'new') goNow({ tab: 'chats', id });
    },
    gone: (id) => {
      setActiveChat(undefined);
      if (screenRef.current.tab === 'chats' && screenRef.current.id === id) goNow({ tab: 'chats', id: 'new' });
    },
  });
  useEffect(() => {
    if (route.tab === 'chats' && route.id) setActiveChat(route.id === 'new' ? undefined : route.id);
  }, [route.tab, route.id, setActiveChat]);
  const newChat = () => go({ tab: 'chats', id: 'new' });
  /** New chat about a run or a file: the New chat screen with that starter in the composer. */
  const newChatAbout = (starter: 'run' | 'file') => go({ tab: 'chats', id: 'new', node: starter });
  /** Pop out: the chat moves to the mini chat over the screen the person came from. */
  const popOut = () => {
    shell.open('float');
    go(lastOther.current);
  };
  const deleteChat = async (id: string) => {
    await assistantApi.remove(projects.current?.id, id);
    if (activeChat === id) setActiveChat(undefined);
    void chats.refresh();
    go({ tab: 'chats' });
  };
  const goals = useGoals();
  const { pins, save: savePins } = usePins();
  const tools = usePoll<Tools>(route.tab === 'settings' ? TOOLS_PATH : null, 60_000);
  /** Connected accounts: the sidebar's account row, and Settings → Accounts. */
  const accounts = usePoll<AccountsView>(ACCOUNTS_PATH, ACCOUNTS_MS);
  const mcp = usePoll<{ servers: McpServerView[] }>(route.tab === 'settings' ? MCP_PATH : null, 60_000);
  const connectors = usePoll<{ connectors: ConnectorView[] }>(route.tab === 'settings' ? CONNECTORS_PATH : null, 15_000);
  /** First launch shows the welcome screen until a folder is opened or the person continues without one (this session); File → Welcome reopens it. */
  const [skipWelcome, setSkipWelcome] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const welcome = welcomeOpen || (!skipWelcome && projects.list.data?.length === 0);
  const closeWelcome = () => (setSkipWelcome(true), setWelcomeOpen(false));
  const [notifyOn, setNotifyOn] = useNotifyPref();
  useAppSignals(runs.data, attention.data?.items, notifyOn);
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
        : screen.tab === 'builder' && screen.id
          ? { kind: 'workflow', id: screen.id, label: screen.id }
          : screen.tab === 'code' && screen.id && projects.current
            ? { kind: 'file', id: screen.id, label: screen.id.split('/').pop()!, ws: projects.current.id }
            : undefined;
  const savePinsOr = (next: Pin[]) => void savePins(next).catch(notify.fail);
  /** A file a run changed (from its diff) opens in Code, in the project that holds the run's folder. */
  const openFile = (repo: string, file: string) => {
    const w = projectOf(projects.list.data ?? [], repo);
    if (!w) return notify.info(`${repo} is not one of your projects: open it as a folder to see its files`);
    switchProject(w.id, () => go({ tab: 'code', id: file }));
  };
  /** A folder to open as a project (Open folder…, a drop, the app's menu or Dock): registered, made current, shown in Code. */
  const openProject = async (path: string) => {
    try {
      const w = await projects.register(path);
      if (w.id === projects.current?.id) go({ tab: 'code' });
      else switchProject(w.id, () => goNow({ tab: 'code' }));
    } catch (e) {
      notify.fail(e);
    }
  };
  /** Open folder…: the native picker in Tether.app, the path dialog in a browser. */
  const pickFolder = () => {
    const b = bridge();
    if (!b) return setOpenFolder(true);
    void b.openFolder().then((path) => void (path && openProject(path)));
  };
  useBridgeEvents({ open: (path) => void openProject(path), command: (c) => c === 'welcome' && setWelcomeOpen(true) });
  const openPin = (x: Pin) => {
    const to: Route = { tab: x.kind === 'run' ? 'runs' : x.kind === 'request' ? 'api' : x.kind === 'workflow' ? 'builder' : 'code', id: x.id };
    if (x.ws) switchProject(x.ws, () => goNow(to));
    else go(to);
  };

  useEffect(() => void loadCrewDefs(), []);
  useEffect(() => {
    if (route.tab === 'runs' && route.id) setLastRun(route.id);
    if (route.tab === 'code') setLastFile(route.id);
  }, [route]);
  /** New run (the sidebar's compose, ⌘N, C): Home's Start a run, its task field focused. */
  const compose = () => {
    go({ tab: 'home' });
    setTimeout(() => document.querySelector<HTMLTextAreaElement>('.shell-main .home textarea')?.focus());
  };
  /**
   * A new workflow, bot, trigger or request from the Create menu: go to its screen and hand the screen a counter. The screen
   * starts its own new thing when the counter arrives (asking first about unsaved edits, as its own New button does); the
   * counter is dropped once the screen has seen it, so coming back later opens nothing.
   */
  const [create, setCreate] = useState<{ what: Exclude<CreateKind, 'run'>; n: number }>();
  const createNew = (what: Exclude<CreateKind, 'run'>) => {
    go({ tab: CREATE_SCREEN[what] });
    setCreate((c) => ({ what, n: (c?.n ?? 0) + 1 }));
  };
  useEffect(() => {
    if (!create) return;
    const t = setTimeout(() => setCreate(undefined), 0);
    return () => clearTimeout(t);
  }, [create]);
  const keys = useRef({ settings: () => {}, folder: () => {}, compose: () => {}, newChat: () => {} });
  keys.current = { settings: () => go({ tab: 'settings' }), folder: pickFolder, compose, newChat };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === ',') return e.preventDefault(), keys.current.settings();
      if (k === 'o' && !e.shiftKey) return e.preventDefault(), keys.current.folder();
      // ⌘⇧O: New chat (⌘N stays New run)
      if (k === 'o') return e.preventDefault(), keys.current.newChat();
      if (k === 'n' && !e.shiftKey && !isTyping(e.target)) return e.preventDefault(), keys.current.compose();
      if (k !== 'k') return;
      // Ctrl-K edits text in fields (macOS: delete to end of line); only Meta-K is taken there
      if (!e.metaKey && isTyping(e.target)) return;
      e.preventDefault();
      setPalette(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openScreen = (s: Screen) => go(s === 'runs' && lastRun ? { tab: 'runs', id: lastRun } : s === 'code' && lastFile ? { tab: 'code', id: lastFile } : { tab: s });
  useGoKeys(openScreen, compose);
  const openSettings = () => go({ tab: 'settings' });
  const settingsOpen = route.tab === 'settings';
  /** Where focus goes when Settings closes and its opener (a More menu item, the ⌘K field) is gone. */
  const settingsHome = () => shellRef.current?.querySelector<HTMLElement>(phone ? '.sl-bottombar [aria-haspopup="menu"]' : '.sl-side [aria-label="Settings"]');
  const list = projects.list.data ?? [];
  /** Settings as a page over the content area (the screen under it stays mounted); over the Welcome screen it covers the window. */
  const settingsPage = settingsOpen ? (
    <SettingsPage onClose={() => goNow(screen)} choice={choice} onChoice={setChoice} vault={health.data?.vault} home={health.data?.home} connection={connection} tools={tools} accounts={accounts} mcp={mcp} connectors={connectors} section={route.tab === 'settings' ? route.id : undefined} notifications={bridge() ? { on: notifyOn, onChange: setNotifyOn } : undefined} returnFocus={settingsHome} />
  ) : null;
  /** The sidebar's Runs section: the current project's runs (every run when no project is open). */
  const projectRuns = (runs.data ?? []).filter((r) => !projects.current || runProject(list, r)?.id === projects.current.id);

  return (
    <>
      {welcome ? (
        <Welcome
          recent={list}
          onAdd={async (path) => (await projects.add(path), setWelcomeOpen(false), goNow({ tab: 'code' }))}
          onPick={(id) => (projects.select(id), setWelcomeOpen(false), goNow({ tab: 'code' }))}
          onSkip={closeWelcome}
          skipLabel={list.length ? 'Back to Tether' : 'Continue without a project'}
        />
      ) : (
        <div ref={shellRef} className={cn('shell', { phone })}>
          {phone ? null : (
            <Sidebar
              active={screen.tab}
              settingsOpen={settingsOpen}
              onGo={openScreen}
              onSearch={() => setPalette(true)}
              onSettings={openSettings}
              onCompose={compose}
              onCreate={createNew}
              counts={{ needs: attention.data?.items.length ?? 0, live: runs.data?.filter((r) => r.live).length ?? 0, goals: inProject(goals.goals, projects.current?.id).filter(isOpen).length }}
              chats={{ list: chats.data?.chats ?? [], current: screen.tab === 'chats' ? (screen.id ?? '') : undefined, onNew: newChat, onStarter: newChatAbout, onOpen: (id) => go({ tab: 'chats', id }), onAll: () => go({ tab: 'chats' }) }}
              teams={{ list: teams.data?.teams ?? [], current: screen.tab === 'teams' ? (screen.id ?? 'new') : undefined, onNew: () => go({ tab: 'teams', id: 'new' }), onOpen: (id) => go({ tab: 'teams', id }) }}
              runs={{ list: projectRuns, current: screen.tab === 'runs' ? screen.id : undefined, onOpen: (id) => go({ tab: 'runs', id }) }}
              account={{ ...accountChip(accounts.data), onOpen: () => go({ tab: 'settings', id: 'accounts' }) }}
              projects={{
                list,
                current: projects.current?.id,
                live: liveProjects(list, runs.data ?? []),
                loading: !projects.list.data && !projects.list.error,
                error: !projects.list.data && projects.list.error ? { message: "Couldn't load projects", onRetry: () => void projects.list.refresh() } : undefined,
                onSelect: (id) => switchProject(id),
                onAdd: pickFolder,
                onRemove: setRemoving,
                onReveal: bridge() && ((w: WorkspaceRow) => bridge()!.revealInFinder(w.path)),
              }}
              pins={{ list: pins, canPin: !!pinHere && !pins.some((x) => samePin(x, pinHere)), onPin: () => pinHere && savePinsOr([...pins, pinHere]), onOpen: openPin, onUnpin: (x) => savePinsOr(pins.filter((y) => !samePin(x, y))), onReorder: savePinsOr }}
            />
          )}
          <main className="shell-main" tabIndex={-1}>
            {screen.tab === 'home' ? <Home onGo={go} goals={goals.goals} onGoal={goals.set} accounts={accounts} /> : null}
            {screen.tab === 'inbox' ? <Inbox onGo={go} goals={goals.goals} onGoal={goals.set} /> : null}
            {screen.tab === 'code' ? (
              projects.current ? (
                <Suspense fallback={<Loading loading lines={8} label="Loading Code" className="shell-loading" />}>
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
                <NoProject loading={!projects.list.data && !projects.list.error} onOpen={pickFolder} />
              )
            ) : null}
            {screen.tab === 'builder' ? <Builder pipeline={screen.id} gate={gateDraft} onGateUsed={() => setGateDraft(undefined)} onStarted={(id) => go({ tab: 'runs', id })} create={create?.what === 'workflow' ? create.n : undefined} /> : null}
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
                create={create?.what === 'request' ? create.n : undefined}
              />
            ) : null}
            {screen.tab === 'graph' ? <GraphView note={screen.id} onNote={(path) => go(path ? { tab: 'graph', id: path } : { tab: 'graph' })} onOpenFile={(path) => go({ tab: 'code', id: path })} /> : null}
            {screen.tab === 'crew' ? <Crew bot={screen.id} onBot={(id) => go(id ? { tab: 'crew', id } : { tab: 'crew' })} create={create?.what === 'bot' ? create.n : undefined} /> : null}
            {screen.tab === 'triggers' ? <Triggers create={create?.what === 'trigger' ? create.n : undefined} /> : null}
            {screen.tab === 'chats' && !screen.id ? (
              <AllChats
                key={projects.current?.id ?? '_'}
                ws={projects.current?.id}
                project={projects.current}
                active={activeChat}
                onOpen={(id) => go({ tab: 'chats', id })}
                onPopOut={(id) => (setActiveChat(id), shell.open('float'))}
                onNew={newChat}
                onGo={go}
                onTurnDone={(id) => id === activeChat && chat.refresh()}
              />
            ) : null}
            {screen.tab === 'chats' && screen.id === 'new' ? <NewChat key={screen.node ?? ''} chat={chat} project={projects.current} context={contextOf(screen)} runs={projectRuns} lastFile={lastFile} starter={screen.node === 'run' || screen.node === 'file' ? screen.node : undefined} /> : null}
            {onChatScreen && screen.id !== 'new' ? <Conversation chat={chat} project={projects.current} context={contextOf(screen)} onGo={go} onPopOut={popOut} onRenamed={() => void chats.refresh()} onDelete={() => deleteChat(screen.id!)} /> : null}
            {screen.tab === 'teams' && (!screen.id || screen.id === 'new') ? (
              <NewTeam agents={teams.data?.agents ?? []} projects={list} project={projects.current} onCreated={(id) => (void teams.refresh(), go({ tab: 'teams', id }))} onCancel={() => go({ tab: 'home' })} onNewAgent={() => createNew('bot')} />
            ) : null}
            {screen.tab === 'teams' && screen.id && screen.id !== 'new' ? (
              <TeamScreen key={screen.id} id={screen.id} goals={goals.goals} agents={teams.data?.agents ?? []} projects={list} onGo={go} onChanged={() => void teams.refresh()} onNewAgent={() => createNew('bot')} />
            ) : null}
            {screen.tab === 'goals' ? <Goals goals={goals} projects={list} project={projects.current} selected={screen.id} onSelect={(id) => go(id ? { tab: 'goals', id } : { tab: 'goals' })} onGo={go} create={create?.what === 'goal' ? create.n : undefined} teams={teams.data} /> : null}
          </main>
          {settingsPage}
          {phone ? <BottomBar active={screen.tab} settingsOpen={settingsOpen} onGo={openScreen} onSettings={openSettings} /> : null}
          <Assistant
            shell={shell}
            chat={chat}
            chats={chats.data?.chats ?? []}
            project={projects.current}
            route={screen}
            phone={phone}
            hidden={onChatScreen}
            onPick={setActiveChat}
            onFullScreen={() => (shell.close(), go({ tab: 'chats', id: activeChat ?? 'new' }))}
            onAllChats={() => go({ tab: 'chats' })}
            onStarter={newChatAbout}
            onGo={go}
          />
        </div>
      )}
      {welcome && settingsPage ? <div className="st-alone">{settingsPage}</div> : null}
      <CommandMenu open={palette} onOpenChange={setPalette} onGo={go} onSettings={openSettings} onTheme={setChoice} ws={projects.current?.id} goals={inProject(goals.goals, projects.current?.id)} onNewGoal={() => createNew('goal')} />
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
