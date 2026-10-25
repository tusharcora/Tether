import { useEffect, useState } from 'react';
import { Builder } from './Builder';
import { CommandMenu } from './CommandMenu';
import { Badge } from './components/arc/badge/badge';
import { Button } from './components/arc/button/button';
import { Dialog, DialogContent } from './components/arc/dialog/dialog';
import { Tabs, TabsList, TabsTrigger } from './components/arc/tabs/tabs';
import { ThemeSwitch } from './components/arc/theme-switch/theme-switch';
import { ToastStack, ToastStackProvider } from './components/arc/toast-stack/toast-stack';
import { Tooltip } from './components/arc/tooltip/tooltip';
import { Crew } from './Crew';
import { loadCrewDefs } from './crewStore';
import { GraphView } from './Graph';
import { ApiTab } from './http/ApiTab';
import { SCREENS, TAB_LABEL, useHashRoute, usePoll, type Route, type Screen } from './hooks';
import { Runs } from './Runs';
import { useTheme } from './theme';
import { Triggers } from './Triggers';

const isTextField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export function App() {
  const [route, goNow] = useHashRoute();
  /** The API tab has a request with unsaved edits: leaving the tab asks first (the tab unmounts and the draft would be lost). */
  const [apiDirty, setApiDirty] = useState(false);
  const [leaving, setLeaving] = useState<Route>();
  const go = (r: Route) => (route.tab === 'api' && r.tab !== 'api' && apiDirty ? setLeaving(r) : goNow(r));
  const [lastRun, setLastRun] = useState(route.tab === 'runs' ? route.id : undefined);
  const { theme, setChoice } = useTheme();
  const [palette, setPalette] = useState(false);
  /** A request gate handed over by the API tab, waiting for the Builder to place it (cleared once used). */
  const [gateDraft, setGateDraft] = useState<{ run: string; env?: string }>();
  const health = usePoll<{ ok: boolean; vault?: string }>('/api/health', 5000);

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

  const online = !!health.data?.ok && !health.error;
  const vault = health.data?.vault;
  const openTab = (t: Screen) => go(t === 'runs' && lastRun ? { tab: 'runs', id: lastRun } : { tab: t });

  return (
    <ToastStackProvider>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="logo">◈</span> aorch
          </div>
          <Tabs value={route.tab} onValueChange={(v) => openTab(v as Screen)}>
            <TabsList aria-label="Main">
              {SCREENS.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {TAB_LABEL[t]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button variant="secondary" size="sm" onClick={() => setPalette(true)}>
            Search or jump to… <kbd>Ctrl K</kbd>
          </Button>
          <div className="status">
            {vault ? (
              <Tooltip content={vault}>
                <span className="info-badge" tabIndex={0}>
                  <Badge size="sm">vault · {vault.split('/').filter(Boolean).slice(-2).join('/')}</Badge>
                </span>
              </Tooltip>
            ) : null}
            <Tooltip content="The API starts agents and writes files, so it only listens on this machine.">
              <span className="info-badge" tabIndex={0}>
                <Badge size="sm">loopback only</Badge>
              </span>
            </Tooltip>
            <Badge size="sm" tone={online ? 'success' : 'danger'}>
              {online ? 'connected' : 'offline'}
            </Badge>
            <ThemeSwitch theme={theme} onThemeChange={(t) => setChoice(t)} iconOnly />
          </div>
        </header>
        <main>
          {route.tab === 'builder' ? <Builder pipeline={route.id} gate={gateDraft} onGateUsed={() => setGateDraft(undefined)} onStarted={(id) => go({ tab: 'runs', id })} /> : null}
          {route.tab === 'runs' ? <Runs selected={route.id} onSelect={(id) => go({ tab: 'runs', id })} /> : null}
          {route.tab === 'api' ? <ApiTab onStarted={(id) => go({ tab: 'runs', id })} onUseAsGate={(g) => (setGateDraft(g), go({ tab: 'builder' }))} onDirtyChange={setApiDirty} /> : null}
          {route.tab === 'graph' ? <GraphView /> : null}
          {route.tab === 'crew' ? <Crew /> : null}
          {route.tab === 'triggers' ? <Triggers /> : null}
        </main>
        <CommandMenu open={palette} onOpenChange={setPalette} onGo={go} />
        <Dialog open={!!leaving} onOpenChange={(o) => !o && setLeaving(undefined)}>
          {leaving ? (
            <DialogContent className="studio api-dialog" title="Discard unsaved changes?" description="The open API request has edits that are not saved.">
              <div className="row end">
                <Button variant="secondary" onClick={() => setLeaving(undefined)}>
                  Keep editing
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    const r = leaving;
                    setLeaving(undefined);
                    setApiDirty(false);
                    goNow(r);
                  }}
                >
                  Discard
                </Button>
              </div>
            </DialogContent>
          ) : null}
        </Dialog>
      </div>
      <ToastStack />
    </ToastStackProvider>
  );
}
