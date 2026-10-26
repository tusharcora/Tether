import { ArrowRight, File, Play, Plus, Search, Settings, SquarePen, Workflow, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Pin, RunRow } from '../../api';
import type { Screen } from '../../hooks';
import { cn } from '../cn';
import { AccountRow } from './AccountRow';
import { Kbd, isApple } from './Kbd';
import { NAV, goHint } from './nav';
import { ProjectSwitcher, type ProjectsProps } from './ProjectSwitcher';
import { RUN_STATE_LABEL, RunGlyph, runState, shortRunId, type RunState } from './RunGlyph';
import { SideMenu, SideRow, SideSection } from './SideParts';
import './shell.css';

const KEY = 'tether.sidebar';
/** Finished runs the Runs section keeps under the live and waiting ones. */
export const RECENT_FINISHED = 5;
/** How long the peeking sidebar stays after the pointer leaves it. */
const PEEK_LEAVE_MS = 240;

function storedHidden(): boolean {
  try {
    return localStorage.getItem(KEY) === 'hidden';
  } catch {
    return false;
  }
}

/**
 * Docked or hidden (remembered on this device). ⌘\ toggles; while hidden, the pointer at the left edge peeks the sidebar
 * as a floating panel, which goes again when the pointer leaves it (or on Escape).
 */
export function useSidebarDock(): { hidden: boolean; peek: boolean; toggle: () => void; peekIn: () => void; peekOut: () => void } {
  const [hidden, setHidden] = useState(storedHidden);
  const [peek, setPeek] = useState(false);
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toggle = useRef(() => {});
  toggle.current = () => {
    setPeek(false);
    setHidden(!hidden);
    try {
      localStorage.setItem(KEY, hidden ? 'docked' : 'hidden');
    } catch {
      /* storage unavailable */
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle.current();
      } else if (e.key === 'Escape') setPeek(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => () => clearTimeout(leave.current), []);
  return {
    hidden,
    peek: hidden && peek,
    toggle: () => toggle.current(),
    peekIn: () => (clearTimeout(leave.current), setPeek(true)),
    peekOut: () => (clearTimeout(leave.current), (leave.current = setTimeout(() => setPeek(false), PEEK_LEAVE_MS))),
  };
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
  /** Peeking while hidden: drawn as a floating panel over the screen. */
  floating?: boolean;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

/**
 * The left sidebar (900 px and wider), Linear-style (spec §2): the project switcher and compose; Search, Home, Inbox and
 * Runs; the Workspace screens with their `G` shortcuts; the project's recent runs with status glyphs; Favorites (pins,
 * drag to reorder); Settings and the account row at the bottom.
 */
export function Sidebar(p: SidebarProps) {
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

  return (
    <aside className={cn('sl-side', { floating: !!p.floating })} aria-label="Sidebar" onPointerEnter={p.onPointerEnter} onPointerLeave={p.onPointerLeave}>
      <div className="sl-side-head">
        <ProjectSwitcher {...p.projects} />
        <button type="button" className="sl-side-compose" aria-label="New run" title={`New run  C · ${mod}N`} onClick={p.onCompose}>
          <SquarePen size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      <div className="sl-side-scroll">
        <nav className="sl-side-nav" aria-label="Main">
          <SideRow label="Search" Icon={Search} meta={<Kbd mod>K</Kbd>} onClick={p.onSearch} />
          {top.map((n) => (
            <SideRow
              key={n.id}
              label={n.long ?? n.label}
              Icon={n.Icon}
              page
              current={page(n.id)}
              count={n.id === 'inbox' ? { n: p.counts.needs, tone: 'needs' } : n.id === 'runs' ? { n: p.counts.live, tone: 'live' } : undefined}
              hint={(n.id === 'inbox' && p.counts.needs) || (n.id === 'runs' && p.counts.live) ? undefined : goHint(n.id)}
              onClick={() => p.onGo(n.id)}
            />
          ))}
          <SideSection id="workspace" title="Workspace">
            {work.map((n) => (
              <SideRow key={n.id} label={n.long ?? n.label} Icon={n.Icon} page current={page(n.id)} hint={goHint(n.id)} onClick={() => p.onGo(n.id)} />
            ))}
          </SideSection>
        </nav>

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
      </div>

      <div className="sl-side-foot">
        <SideRow label="Settings" Icon={Settings} page current={!!p.settingsOpen} hint={<Kbd mod>,</Kbd>} onClick={p.onSettings} />
        <div className="sl-side-rule" />
        <AccountRow {...p.account} />
      </div>
    </aside>
  );
}

/** The list with items i and j swapped (the keyboard way to reorder Favorites). */
const swap = <T,>(list: T[], i: number, j: number): T[] => {
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
};
