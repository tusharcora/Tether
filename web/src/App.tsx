import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { api } from './api';
import { Builder } from './Builder';
import { loadCrewDefs } from './bots';
import { Crew } from './Crew';
import { GraphView } from './Graph';
import { Runs } from './Runs';
import { Triggers } from './Triggers';

type Tab = 'builder' | 'runs' | 'graph' | 'crew' | 'triggers';

const fromHash = (): { tab: Tab; run?: string } => {
  const [t, r] = location.hash.replace(/^#\/?/, '').split('/');
  return { tab: t === 'runs' || t === 'graph' || t === 'crew' || t === 'triggers' ? t : 'builder', run: r };
};

export function App() {
  const init = fromHash();
  const [tab, setTab] = createSignal<Tab>(init.tab);
  const [run, setRun] = createSignal<string | undefined>(init.run);
  const [health, setHealth] = createSignal<{ ok: boolean; vault?: string } | undefined>();

  const go = (t: Tab, r?: string) => {
    setTab(t);
    if (r !== undefined) setRun(r);
    location.hash = t === 'runs' && (r ?? run()) ? `#/runs/${r ?? run()}` : `#/${t}`;
  };

  onMount(() => {
    void loadCrewDefs();
    const beat = async () => {
      try {
        setHealth(await api('GET', '/api/health'));
      } catch {
        setHealth({ ok: false });
      }
    };
    void beat();
    const t = setInterval(beat, 5000);
    const onHash = () => {
      const h = fromHash();
      setTab(h.tab);
      if (h.run) setRun(h.run);
    };
    window.addEventListener('hashchange', onHash);
    onCleanup(() => (clearInterval(t), window.removeEventListener('hashchange', onHash)));
  });

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <span class="logo">◈</span> aorch
        </div>
        <nav class="tabs">
          <button classList={{ active: tab() === 'builder' }} onClick={() => go('builder')}>Builder</button>
          <button classList={{ active: tab() === 'runs' }} onClick={() => go('runs')}>Runs</button>
          <button classList={{ active: tab() === 'graph' }} onClick={() => go('graph')}>Graph</button>
          <button classList={{ active: tab() === 'crew' }} onClick={() => go('crew')}>Crew</button>
          <button classList={{ active: tab() === 'triggers' }} onClick={() => go('triggers')}>Triggers</button>
        </nav>
        <div class="status">
          <Show when={health()?.vault}>
            <span class="chip" title={health()!.vault}>vault · {health()!.vault!.split('/').filter(Boolean).slice(-2).join('/')}</span>
          </Show>
          <span class="chip" title="The API starts agents and writes files, so it only listens on this machine.">loopback only</span>
          <span class="conn" classList={{ ok: !!health()?.ok }}>
            <i /> {health()?.ok ? 'connected' : 'offline'}
          </span>
        </div>
      </header>
      <main>
        <Show when={tab() === 'builder'}>
          <Builder onStarted={(id) => go('runs', id)} />
        </Show>
        <Show when={tab() === 'runs'}>
          <Runs selected={run()} onSelect={(id) => go('runs', id)} />
        </Show>
        <Show when={tab() === 'crew'}>
          <Crew />
        </Show>
        <Show when={tab() === 'triggers'}>
          <Triggers />
        </Show>
        <Show when={tab() === 'graph'}>
          <GraphView />
        </Show>
      </main>
    </div>
  );
}
