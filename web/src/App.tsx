import { useEffect, useState } from 'react';
import { Builder } from './Builder';
import { CommandMenu } from './CommandMenu';
import { Badge } from './components/arc/badge/badge';
import { Button } from './components/arc/button/button';
import { Tabs, TabsList, TabsTrigger } from './components/arc/tabs/tabs';
import { ThemeSwitch } from './components/arc/theme-switch/theme-switch';
import { ToastStack, ToastStackProvider } from './components/arc/toast-stack/toast-stack';
import { Tooltip } from './components/arc/tooltip/tooltip';
import { Crew } from './Crew';
import { loadCrewDefs } from './crewStore';
import { GraphView } from './Graph';
import { TAB_LABEL, TABS, useHashRoute, usePoll, type Tab } from './hooks';
import { Runs } from './Runs';
import { useTheme } from './theme';
import { Triggers } from './Triggers';

const isTextField = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export function App() {
  const [route, go] = useHashRoute();
  const [lastRun, setLastRun] = useState(route.tab === 'runs' ? route.id : undefined);
  const [theme, setTheme] = useTheme();
  const [palette, setPalette] = useState(false);
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
  const openTab = (t: Tab) => go(t === 'runs' && lastRun ? { tab: 'runs', id: lastRun } : { tab: t });

  return (
    <ToastStackProvider>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="logo">◈</span> aorch
          </div>
          <Tabs value={route.tab} onValueChange={(v) => openTab(v as Tab)}>
            <TabsList aria-label="Main">
              {TABS.map((t) => (
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
            <ThemeSwitch theme={theme} onThemeChange={(t) => setTheme(t)} iconOnly />
          </div>
        </header>
        <main>
          {route.tab === 'builder' ? <Builder pipeline={route.id} onStarted={(id) => go({ tab: 'runs', id })} /> : null}
          {route.tab === 'runs' ? <Runs selected={route.id} onSelect={(id) => go({ tab: 'runs', id })} /> : null}
          {route.tab === 'graph' ? <GraphView /> : null}
          {route.tab === 'crew' ? <Crew /> : null}
          {route.tab === 'triggers' ? <Triggers /> : null}
        </main>
        <CommandMenu open={palette} onOpenChange={setPalette} onGo={go} />
      </div>
      <ToastStack />
    </ToastStackProvider>
  );
}
