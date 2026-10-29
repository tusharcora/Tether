import { Bot, Hash, MessagesSquare, PanelLeftClose, Pencil, Play, Plus, Search, Send, Settings, SquarePen, Target, Workflow, Zap } from 'lucide-react';
import { MARK, type TeamSummary } from '../../teams/teamsApi';
import { useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import type { Pin, RunRow } from '../../api';
import type { ChatSummary } from '../../assistant/api';
import type { Screen } from '../../hooks';
import { CreateMenu } from '../../components/bencho/CreateMenu';
import { cn } from '../cn';
import { AccountRow } from './AccountRow';
import { Kbd, isApple } from './Kbd';
import { NAV, goHint, type CreateKind } from './nav';
import { PinList } from './PinList';
import { ProjectSwitcher, type ProjectsProps } from './ProjectSwitcher';
import { RUN_STATE_LABEL, RunGlyph, runState, shortRunId, type RunState } from './RunGlyph';
import { SideRow, SideSection, type TipProps } from './SideParts';
import './shell.css';

const KEY = 'tether.sidebar';
const TIP_DELAY_MS = 300;
/** Finished runs the Runs section keeps under the live and waiting ones. */
export const RECENT_FINISHED = 5;
/** Chats the Chats section lists (the rest are in All chats). */
export const RECENT_CHATS = 5;

function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === 'collapsed';
  } catch {
    return false;
  }
}

/** Expanded (244 px) or collapsed to the 56 px icon rail, remembered on this device; ⌘\ toggles. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const toggle = useRef(() => {});
  toggle.current = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(KEY, collapsed ? 'open' : 'collapsed');
    } catch {
      /* storage unavailable */
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\' || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      toggle.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return [collapsed, () => toggle.current()];
}

const ORDER: Record<RunState, number> = { running: 0, needs: 1, idle: 2, done: 3, failed: 3 };
/** The Runs section: live first, then the ones waiting on you, then queued or paused, then the last five finished. */
export function sideRuns(runs: RunRow[]): { run: RunRow; state: RunState }[] {
  const rows = runs.filter((r) => !r.probe).map((run) => ({ run, state: runState(run) }));
  const open = rows.filter((x) => ORDER[x.state] < 3).sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.run.startedAt - a.run.startedAt);
  const finished = rows.filter((x) => ORDER[x.state] === 3).sort((a, b) => (b.run.finishedAt ?? b.run.startedAt) - (a.run.finishedAt ?? a.run.startedAt));
  return [...open, ...finished.slice(0, RECENT_FINISHED)];
}

const firstLine = (t: string) => t.split('\n')[0]!.slice(0, 120);

export interface SidebarProps {
  active: Screen;
  /** The Settings drawer is open over the active screen. */
  settingsOpen?: boolean;
  onGo: (s: Screen) => void;
  onSearch: () => void;
  onSettings: () => void;
  /** New run (⌘N / C). */
  onCompose: () => void;
  /** A new workflow, bot, trigger or request, from the Create menu. */
  onCreate: (what: Exclude<CreateKind, 'run'>) => void;
  /** Inbox: items that need you (amber). Runs: live runs (blue). */
  counts: { needs: number; live: number; goals: number };
  /** The current project's runs (all runs when no project is open), and the run shown in Runs. */
  runs: { list: RunRow[]; current?: string; onOpen: (id: string) => void };
  /** The project's chats, newest first; `current` is what the Chats screen shows: '' All chats, 'new', or a chat id. */
  chats: { list: ChatSummary[]; current?: string; onNew: () => void; onOpen: (id: string) => void; onAll: () => void };
  /** Every team (spec Teams §6.4); `current` is the team on screen ('new' while making one). */
  teams: { list: TeamSummary[]; current?: string; onNew: () => void; onOpen: (id: string) => void };
  projects: ProjectsProps;
  pins: { list: Pin[]; canPin: boolean; onPin: () => void; onOpen: (p: Pin) => void; onUnpin: (p: Pin) => void; onReorder: (next: Pin[]) => void };
  account: { name: string; provider?: string; onOpen: () => void };
}

/**
 * The left sidebar (900 px and wider), Linear-style (spec §2): the project switcher (the Tether glyph and the project's
 * name), compose and the collapse button; Search, Home, Inbox and Runs; the project's Tether chats (New chat, the five
 * latest, All chats; one chat icon on the rail); the Workspace screens with their `G` shortcuts;
 * the project's recent runs with status glyphs; Favorites (pins, drag to reorder); Settings and the account row at the
 * bottom. Collapsed (⌘\ or the panel button) it is a 56 px icon rail, and the collapse is seamless (spec §6): the markup
 * does not change, every row keeps an 8 px gutter and a 40 px icon cell, so each icon's centre is the same in both states;
 * only the width animates while labels fade and clip, section headers become hairlines, and the glyph turns into the
 * expand control. Every rail icon shows its label as a tooltip on hover and focus (Escape dismisses it), level with the
 * row's centre; counts become dots.
 */
export function Sidebar(p: SidebarProps) {
  const [collapsed, toggle] = useSidebarCollapsed();
  const asideRef = useRef<HTMLElement>(null);
  /** Fixed to the viewport: the aside clips its own content while the width animates, so the tip lives outside that box. */
  const [tip, setTip] = useState<{ key: string; label: string; top: number; left: number }>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tipId = useId();
  const hideTip = () => {
    clearTimeout(timer.current);
    setTip(undefined);
  };
  // the tip goes on Escape wherever focus and pointer are (WCAG 1.4.13); its timer dies with the sidebar
  useEffect(() => {
    if (!tip) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && hideTip();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tip]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(hideTip, [collapsed]);
  /** Rail tooltip wiring for one control (nothing while expanded: the label is in view). */
  const tipFor = (key: string, label: string): TipProps | undefined => {
    if (!collapsed) return undefined;
    const show = (e: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
      const el = e.currentTarget;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const box = el.getBoundingClientRect();
        setTip({ key, label, top: box.top + box.height / 2, left: (asideRef.current?.getBoundingClientRect().right ?? 56) + 6 });
      }, TIP_DELAY_MS);
    };
    return { onPointerEnter: show, onFocus: show, onPointerLeave: hideTip, onBlur: hideTip, 'aria-describedby': tip?.key === key ? tipId : undefined };
  };
  const page = (s: Screen) => !p.settingsOpen && p.active === s;
  const top = NAV.filter((n) => n.top);
  const work = NAV.filter((n) => !n.top);
  const runs = sideRuns(p.runs.list);
  const mod = isApple() ? '⌘' : 'Ctrl ';
  const navRow = (n: (typeof NAV)[number]) => (
    <SideRow
      key={n.id}
      label={n.long ?? n.label}
      Icon={n.Icon}
      page
      current={page(n.id)}
      count={n.id === 'inbox' ? { n: p.counts.needs, tone: 'needs' } : n.id === 'runs' ? { n: p.counts.live, tone: 'live' } : n.id === 'goals' ? { n: p.counts.goals } : undefined}
      hint={(n.id === 'inbox' && p.counts.needs) || (n.id === 'runs' && p.counts.live) || (n.id === 'goals' && p.counts.goals) ? undefined : goHint(n.id)}
      onClick={() => p.onGo(n.id)}
      rail={tipFor(n.id, n.long ?? n.label)}
    />
  );

  return (
    <aside ref={asideRef} className={cn('sl-side', { collapsed })} aria-label="Sidebar">
      <div className="sl-side-head">
        <ProjectSwitcher {...p.projects} collapsed={collapsed} onExpand={toggle} rail={tipFor('expand', `Expand sidebar  ${mod}\\`)} />
        <span className="sl-side-head-actions" inert={collapsed}>
          <CreateMenu
            label="Create"
            title={`Create  (New run  C · ${mod}N)`}
            className="sl-side-compose"
            items={[
              { id: 'run', label: 'New run', icon: <Play size={15} strokeWidth={1.8} />, hint: <Kbd>C</Kbd> },
              { id: 'workflow', label: 'New workflow', icon: <Workflow size={15} strokeWidth={1.8} /> },
              { id: 'bot', label: 'New bot', icon: <Bot size={15} strokeWidth={1.8} /> },
              { id: 'trigger', label: 'New trigger', icon: <Zap size={15} strokeWidth={1.8} /> },
              { id: 'request', label: 'New request', icon: <Send size={15} strokeWidth={1.8} /> },
              { id: 'goal', label: 'New goal', icon: <Target size={15} strokeWidth={1.8} /> },
            ]}
            onSelect={(id) => (id === 'run' ? p.onCompose() : p.onCreate(id as Exclude<CreateKind, 'run'>))}
          >
            <SquarePen size={15} strokeWidth={1.8} aria-hidden="true" />
          </CreateMenu>
          <button type="button" className="sl-side-icon-btn sl-side-toggle" aria-label="Collapse sidebar" title={`Collapse sidebar  ${mod}\\`} onClick={toggle}>
            <PanelLeftClose size={16} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </span>
      </div>

      <div className="sl-side-scroll">
        <nav className="sl-side-nav" aria-label="Main">
          <SideRow label="Search" Icon={Search} meta={<Kbd mod>K</Kbd>} onClick={p.onSearch} rail={tipFor('search', 'Search')} />
          {top.map(navRow)}
          <SideSection
            id="teams"
            title="Teams"
            collapsed={collapsed}
            actions={
              <button type="button" className="sl-side-icon-btn" aria-label="New team" title="New team" onClick={p.teams.onNew}>
                <Plus size={14} aria-hidden="true" />
              </button>
            }
            empty="No teams yet. Make one with +."
          >
            {collapsed
              ? [<SideRow key="teams" label="Teams" Icon={Hash} page current={p.teams.current !== undefined} onClick={() => (p.teams.list[0] ? p.teams.onOpen(p.teams.list[0].id) : p.teams.onNew())} rail={tipFor('teams', 'Teams')} />]
              : p.teams.list.map((t) => (
                  <SideRow
                    key={t.id}
                    label={t.name}
                    name={t.status === 'idle' ? t.name : `${t.name} · ${t.status === 'live' ? 'working' : 'needs you'}`}
                    lead={<span className="sl-side-mark">{MARK[t.place]}</span>}
                    page
                    current={p.teams.current === t.id}
                    meta={t.status === 'idle' ? undefined : <span className={cn('sl-side-status', t.status)} aria-hidden="true" />}
                    onClick={() => p.teams.onOpen(t.id)}
                  />
                ))}
          </SideSection>
          <SideSection
            id="chats"
            title="Chats"
            collapsed={collapsed}
            actions={
              <button type="button" className="sl-side-icon-btn" aria-label="New chat" title={`New chat  ${mod}⇧O`} onClick={p.chats.onNew}>
                <Plus size={14} aria-hidden="true" />
              </button>
            }
          >
            {collapsed
              ? [<SideRow key="all" label="Chats" Icon={MessagesSquare} page current={p.chats.current !== undefined} onClick={p.chats.onAll} rail={tipFor('chats', 'Chats')} />]
              : [
                  <SideRow key="new" label="New chat" Icon={Pencil} page current={p.chats.current === 'new'} hint={<Kbd mod>⇧O</Kbd>} onClick={p.chats.onNew} />,
                  ...p.chats.list.slice(0, RECENT_CHATS).map((c) => <SideRow key={c.id} label={c.title} page current={p.chats.current === c.id} onClick={() => p.chats.onOpen(c.id)} />),
                  <SideRow key="all" label="All chats →" name="All chats" page current={p.chats.current === ''} onClick={p.chats.onAll} />,
                ]}
          </SideSection>
          <SideSection id="workspace" title="Workspace" collapsed={collapsed}>
            {work.map(navRow)}
          </SideSection>
        </nav>

        <SideSection
          id="runs"
          title="Runs"
          label="Recent runs"
          collapsed={collapsed}
          count={runs.length}
          actions={
            <button type="button" className="sl-side-text-btn" onClick={() => p.onGo('runs')}>
              View all
            </button>
          }
          empty="No runs in this project yet."
        >
          {runs.map(({ run, state }) => (
            <SideRow
              key={run.id}
              className="run"
              label={firstLine(run.task)}
              name={`${firstLine(run.task)} · ${RUN_STATE_LABEL[state]} · ${shortRunId(run.id)}`}
              lead={<RunGlyph state={state} />}
              current={p.runs.current === run.id && page('runs')}
              meta={shortRunId(run.id)}
              onClick={() => p.runs.onOpen(run.id)}
              rail={tipFor(`run:${run.id}`, `${firstLine(run.task)} · ${RUN_STATE_LABEL[state]}`)}
            />
          ))}
        </SideSection>

        <SideSection
          id="favorites"
          title="Favorites"
          collapsed={collapsed}
          actions={
            <button type="button" className="sl-side-icon-btn" aria-label={p.pins.canPin ? 'Pin what is open' : 'Open a run, request, workflow or file to pin it'} title={p.pins.canPin ? 'Pin what is open' : 'Open a run, request, workflow or file to pin it'} disabled={!p.pins.canPin} onClick={p.pins.onPin}>
              <Plus size={14} aria-hidden="true" />
            </button>
          }
          empty="Pin a run, a request, a workflow or a file with +."
        >
          {p.pins.list.length ? [<PinList key="pins" pins={p.pins.list} collapsed={collapsed} onOpen={p.pins.onOpen} onUnpin={p.pins.onUnpin} onReorder={p.pins.onReorder} tipFor={tipFor} />] : []}
        </SideSection>
      </div>

      <div className="sl-side-foot">
        <SideRow label="Settings" Icon={Settings} page current={!!p.settingsOpen} hint={<Kbd mod>,</Kbd>} onClick={p.onSettings} rail={tipFor('settings', 'Settings')} />
        <div className="sl-side-rule" />
        <AccountRow {...p.account} rail={tipFor('account', `${p.account.name} · ${p.account.provider ? `${p.account.provider} connected` : 'Connect an account'}`)} />
      </div>
      {tip ? (
        <div className="sl-side-tip" role="tooltip" id={tipId} style={{ top: tip.top, left: tip.left }}>
          {tip.label}
        </div>
      ) : null}
    </aside>
  );
}

