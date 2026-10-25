import { useEffect, useRef, useState } from 'react';
import { Builder } from './Builder';
import { CommandMenu } from './CommandMenu';
import { Button } from './components/arc/button/button';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { ToastStack, ToastStackProvider } from './components/arc/toast-stack/toast-stack';
import { Crew } from './Crew';
import { loadCrewDefs } from './crewStore';
import { GraphView } from './Graph';
import { Home } from './home/Home';
import { ApiTab } from './http/ApiTab';
import { useHashRoute, usePoll, type Route, type Screen } from './hooks';
import { Runs } from './Runs';
import { useTheme } from './theme';
import { Triggers } from './Triggers';
import { cn } from './ui/cn';
import { BottomBar } from './ui/studio/BottomBar';
import { useConnection } from './ui/studio/connection';
import { Rail } from './ui/studio/Rail';
import { SettingsDrawer } from './ui/studio/SettingsDrawer';
import { PHONE, useMediaQuery } from './ui/studio/useMediaQuery';
import './ui/studio/shell.css';

type ScreenRoute = Omit<Route, 'tab'> & { tab: Screen };

const isTextField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export function App() {
  /** The API tab has a request with unsaved edits: leaving the tab asks first (the tab unmounts and the draft would be lost). */
  const [apiDirty, setApiDirty] = useState(false);
  const [leaving, setLeaving] = useState<Route>();
  /** The screen shown under the Settings drawer. Settings opens over it and it stays mounted. */
  const screenRef = useRef<ScreenRoute>({ tab: 'home' });
  const leavesDirtyApi = (next: Route) => screenRef.current.tab === 'api' && apiDirty && next.tab !== 'api' && next.tab !== 'settings';
  const [route, goNow] = useHashRoute(leavesDirtyApi, setLeaving);
  if (route.tab !== 'settings') screenRef.current = route as ScreenRoute;
  const screen = screenRef.current;

  /** Every way out of a screen (rail, bottom bar, ⌘K, in-screen links) comes through here; browser moves through the hook's guard. */
  const go = (r: Route) => (leavesDirtyApi(r) ? setLeaving(r) : goNow(r));
  const [lastRun, setLastRun] = useState(route.tab === 'runs' ? route.id : undefined);
  const { choice, setChoice } = useTheme();
  const [palette, setPalette] = useState(false);
  /** A request gate handed over by the API tab, waiting for the Builder to place it (cleared once used). */
  const [gateDraft, setGateDraft] = useState<{ run: string; env?: string }>();
  const health = usePoll<{ ok: boolean; vault?: string }>('/api/health', 5000);
  const connection = useConnection(health);
  const phone = useMediaQuery(PHONE);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => void loadCrewDefs(), []);
  useEffect(() => {
    if (route.tab === 'runs' && route.id) setLastRun(route.id);
  }, [route]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey)) return;
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
  const settingsHome = () => shellRef.current?.querySelector<HTMLElement>(phone ? '.sl-bottombar [aria-haspopup="menu"]' : '.sl-rail [aria-label="Settings"]');

  return (
    <ToastStackProvider>
      <div ref={shellRef} className={cn('shell', { phone })}>
        {phone ? null : <Rail active={screen.tab} settingsOpen={settingsOpen} onGo={openScreen} onSearch={() => setPalette(true)} onSettings={openSettings} />}
        <main className="shell-main">
          {screen.tab === 'home' ? <Home onGo={go} /> : null}
          {screen.tab === 'builder' ? <Builder pipeline={screen.id} gate={gateDraft} onGateUsed={() => setGateDraft(undefined)} onStarted={(id) => go({ tab: 'runs', id })} /> : null}
          {screen.tab === 'runs' ? (
            <Runs
              selected={screen.id}
              node={screen.node}
              pane={screen.pane}
              onSelect={(id) => go(id ? { tab: 'runs', id } : { tab: 'runs' })}
              onSelectNode={(node) => screen.id && go({ tab: 'runs', id: screen.id, ...(node ? { node } : {}) })}
              onStart={() => go({ tab: 'home' })}
            />
          ) : null}
          {screen.tab === 'api' ? <ApiTab onStarted={(id) => go({ tab: 'runs', id })} onUseAsGate={(g) => (setGateDraft(g), go({ tab: 'builder' }))} onDirtyChange={setApiDirty} /> : null}
          {screen.tab === 'graph' ? <GraphView /> : null}
          {screen.tab === 'crew' ? <Crew /> : null}
          {screen.tab === 'triggers' ? <Triggers /> : null}
        </main>
        {phone ? <BottomBar active={screen.tab} settingsOpen={settingsOpen} onGo={openScreen} onSettings={openSettings} /> : null}
      </div>
      <SettingsDrawer open={settingsOpen} onClose={() => goNow(screen)} choice={choice} onChoice={setChoice} vault={health.data?.vault} connection={connection} returnFocus={settingsHome} />
      <CommandMenu open={palette} onOpenChange={setPalette} onGo={go} onSettings={openSettings} onTheme={setChoice} />
      <LeaveDialog
        to={leaving}
        onKeep={() => setLeaving(undefined)}
        onDiscard={(r) => {
          setLeaving(undefined);
          setApiDirty(false);
          goNow(r);
        }}
      />
      <ToastStack />
    </ToastStackProvider>
  );
}

/** Asks before a dirty API request is dropped by leaving the API screen. */
function LeaveDialog(p: { to: Route | undefined; onKeep: () => void; onDiscard: (r: Route) => void }) {
  const to = p.to;
  return (
    <Dialog open={!!to} onOpenChange={(o) => !o && p.onKeep()}>
      {to ? (
        <DialogContent className="studio api-dialog" title="Discard unsaved changes?" description="The open API request has edits that are not saved.">
          <div className="row end">
            <Button variant="secondary" onClick={p.onKeep}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={() => p.onDiscard(to)}>
              Discard
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
