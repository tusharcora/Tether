import { ArrowRight, File, PanelLeftClose, PanelLeftOpen, Play, Plus, Search, Settings, SquarePen, Workflow, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import type { Pin, RunRow } from '../../api';
import type { Screen } from '../../hooks';
import { cn } from '../cn';
import { AccountRow } from './AccountRow';
import { Kbd, isApple } from './Kbd';
import { NAV, goHint } from './nav';
import { ProjectSwitcher, type ProjectsProps } from './ProjectSwitcher';
import { RUN_STATE_LABEL, RunGlyph, runState, shortRunId, type RunState } from './RunGlyph';
import { SideMenu, SideRow, SideSection, type TipProps } from './SideParts';
import './shell.css';

const KEY = 'tether.sidebar';
const TIP_DELAY_MS = 300;
/** Finished runs the Runs section keeps under the live and waiting ones. */
export const RECENT_FINISHED = 5;

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

const PIN_ICON: Record<Pin['kind'], LucideIcon> = { run: Play, request: ArrowRight, workflow: Workflow, file: File };
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
  /** Inbox: items that need you (amber). Runs: live runs (blue). */
  counts: { needs: number; live: number };
  /** The current project's runs (all runs when no project is open), and the run shown in Runs. */
  runs: { list: RunRow[]; current?: string; onOpen: (id: string) => void };
  projects: ProjectsProps;
  pins: { list: Pin[]; canPin: boolean; onPin: () => void; onOpen: (p: Pin) => void; onUnpin: (p: Pin) => void; onReorder: (next: Pin[]) => void };
  account: { name: string; provider?: string; onOpen: () => void };
}

/**
 * The left sidebar (900 px and wider), Linear-style (spec §2): the project switcher (the Tether glyph and the project's
 * name), compose and the collapse button; Search, Home, Inbox and Runs; the Workspace screens with their `G` shortcuts;
 * the project's recent runs with status glyphs; Favorites (pins, drag to reorder); Settings and the account row at the
 * bottom. Collapsed (⌘\ or the panel button) it is a 56 px icon rail: every icon shows its label as a tooltip on hover
 * and focus (Escape dismisses it) and counts become dots.
 */
export function Sidebar(p: SidebarProps) {
  const [collapsed, toggle] = useSidebarCollapsed();
  const asideRef = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<{ key: string; label: string; top: number }>();
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
        setTip({ key, label, top: box.top - (asideRef.current?.getBoundingClientRect().top ?? 0) + box.height / 2 });
      }, TIP_DELAY_MS);
    };
    return { onPointerEnter: show, onFocus: show, onPointerLeave: hideTip, onBlur: hideTip, 'aria-describedby': tip?.key === key ? tipId : undefined };
  };
  const [dragging, setDragging] = useState<number>();
  const page = (s: Screen) => !p.settingsOpen && p.active === s;
  const top = NAV.filter((n) => n.top);
  const work = NAV.filter((n) => !n.top);
  const runs = sideRuns(p.runs.list);
  const move = (to: number) => {
    if (dragging === undefined || dragging === to) return;
    const next = [...p.pins.list];
    const [it] = next.splice(dragging, 1);
    next.splice(to, 0, it!);
    setDragging(undefined);
    p.pins.onReorder(next);
  };
  const mod = isApple() ? '⌘' : 'Ctrl ';
  const toggleLabel = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  const toggleButton = (
    <button type="button" className="sl-side-icon-btn sl-side-toggle" aria-label={toggleLabel} title={collapsed ? undefined : `${toggleLabel}  ${mod}\\`} onClick={toggle} {...tipFor('toggle', `${toggleLabel}  ${mod}\\`)}>
      {collapsed ? <PanelLeftOpen size={16} strokeWidth={1.7} aria-hidden="true" /> : <PanelLeftClose size={16} strokeWidth={1.7} aria-hidden="true" />}
    </button>
  );
  const compose = (
    <button type="button" className="sl-side-compose" aria-label="New run" title={collapsed ? undefined : `New run  C · ${mod}N`} onClick={p.onCompose} {...tipFor('compose', 'New run')}>
      <SquarePen size={15} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
  const navRow = (n: (typeof NAV)[number]) => (
    <SideRow
      key={n.id}
      label={n.long ?? n.label}
      Icon={n.Icon}
      page
      current={page(n.id)}
      count={n.id === 'inbox' ? { n: p.counts.needs, tone: 'needs' } : n.id === 'runs' ? { n: p.counts.live, tone: 'live' } : undefined}
      hint={(n.id === 'inbox' && p.counts.needs) || (n.id === 'runs' && p.counts.live) ? undefined : goHint(n.id)}
      onClick={() => p.onGo(n.id)}
      rail={tipFor(n.id, n.long ?? n.label)}
    />
  );

  return (
    <aside ref={asideRef} className={cn('sl-side', { collapsed })} aria-label="Sidebar">
      {collapsed ? (
        <div className="sl-side-head">
          <ProjectSwitcher {...p.projects} compact />
          {toggleButton}
          {compose}
        </div>
      ) : (
        <div className="sl-side-head">
          <ProjectSwitcher {...p.projects} />
          {compose}
          {toggleButton}
        </div>
      )}

      <div className="sl-side-scroll">
        <nav className="sl-side-nav" aria-label="Main">
          <SideRow label="Search" Icon={Search} meta={<Kbd mod>K</Kbd>} onClick={p.onSearch} rail={tipFor('search', 'Search')} />
          {top.map(navRow)}
          {collapsed ? (
            <>
              <div className="sl-side-rule" />
              {work.map(navRow)}
            </>
          ) : (
            <SideSection id="workspace" title="Workspace">
              {work.map(navRow)}
            </SideSection>
          )}
        </nav>
        {collapsed ? null : (
          <>

        <SideSection
          id="runs"
          title="Runs"
          label="Recent runs"
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
            />
          ))}
        </SideSection>

        <SideSection
          id="favorites"
          title="Favorites"
          actions={
            <button type="button" className="sl-side-icon-btn" aria-label={p.pins.canPin ? 'Pin what is open' : 'Open a run, request, workflow or file to pin it'} title={p.pins.canPin ? 'Pin what is open' : 'Open a run, request, workflow or file to pin it'} disabled={!p.pins.canPin} onClick={p.pins.onPin}>
              <Plus size={14} aria-hidden="true" />
            </button>
          }
          empty="Pin a run, a request, a workflow or a file with +."
        >
          {p.pins.list.map((x, i) => (
            <SideRow
              key={`${x.kind}:${x.ws ?? ''}:${x.id}`}
              className={cn('pin', { dragging: dragging === i })}
              label={x.label}
              Icon={PIN_ICON[x.kind]}
              onClick={() => p.pins.onOpen(x)}
              draggable
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => move(i)}
              extra={<SideMenu className="sl-side-row-more" label={`${x.label} options`} items={[{ label: `Unpin ${x.label}`, onPick: () => p.pins.onUnpin(x) }, ...(i > 0 ? [{ label: 'Move up', onPick: () => p.pins.onReorder(swap(p.pins.list, i, i - 1)) }] : []), ...(i < p.pins.list.length - 1 ? [{ label: 'Move down', onPick: () => p.pins.onReorder(swap(p.pins.list, i, i + 1)) }] : [])]} />}
            />
          ))}
        </SideSection>
          </>
        )}
      </div>

      <div className="sl-side-foot">
        <SideRow label="Settings" Icon={Settings} page current={!!p.settingsOpen} hint={<Kbd mod>,</Kbd>} onClick={p.onSettings} rail={tipFor('settings', 'Settings')} />
        <div className="sl-side-rule" />
        <AccountRow {...p.account} rail={tipFor('account', `${p.account.name} · ${p.account.provider ? `${p.account.provider} connected` : 'Connect an account'}`)} />
      </div>
      {tip ? (
        <div className="sl-side-tip" role="tooltip" id={tipId} style={{ top: tip.top }}>
          {tip.label}
        </div>
      ) : null}
    </aside>
  );
}

/** The list with items i and j swapped (the keyboard way to reorder Favorites). */
const swap = <T,>(list: T[], i: number, j: number): T[] => {
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
};
