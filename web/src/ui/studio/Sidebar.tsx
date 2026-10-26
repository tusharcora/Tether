import { Folder, PanelLeftClose, PanelLeftOpen, Pin as PinIcon, Search, Settings } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import type { Pin } from '../../api';
import type { WorkspaceRow } from '../../home/workspaces';
import type { Screen } from '../../hooks';
import { cn } from '../cn';
import { Glyph } from './Glyph';
import { Kbd, isApple } from './Kbd';
import { NAV } from './nav';
import { SideItem, SideSection, type TipProps } from './SideParts';
import { BELOW_WIDE, useMediaQuery } from './useMediaQuery';
import './shell.css';

const KEY = 'aorch.sidebar';
const TIP_DELAY_MS = 300;

function storedOpen(): boolean | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'open' ? true : v === 'closed' ? false : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Expanded or collapsed. From 1200 px the choice is remembered on this device (expanded by default); below 1200 px the
 * sidebar starts collapsed and a toggle lasts until the width class changes.
 */
export function useSidebarOpen(): [boolean, () => void] {
  const narrow = useMediaQuery(BELOW_WIDE);
  const [wide, setWide] = useState(storedOpen);
  const [narrowOpen, setNarrowOpen] = useState(false);
  useEffect(() => setNarrowOpen(false), [narrow]);
  const open = narrow ? narrowOpen : (wide ?? true);
  const toggle = () => {
    if (narrow) return setNarrowOpen(!open);
    setWide(!open);
    try {
      localStorage.setItem(KEY, open ? 'closed' : 'open');
    } catch {
      /* storage unavailable */
    }
  };
  return [open, toggle];
}

export interface SidebarProps {
  active: Screen;
  /** The Settings drawer is open over the active screen. */
  settingsOpen?: boolean;
  onGo: (s: Screen) => void;
  onSearch: () => void;
  onSettings: () => void;
  /** Home: items that need you (amber). Runs: live runs (blue). */
  counts: { needs: number; live: number };
  projects: { list: WorkspaceRow[]; current?: string; live: ReadonlySet<string>; onSelect: (id: string) => void; onAdd: () => void; onRemove: (w: WorkspaceRow) => void };
  pins: { list: Pin[]; canPin: boolean; onPin: () => void; onOpen: (p: Pin) => void; onUnpin: (p: Pin) => void };
}

/**
 * The left sidebar (900 px and wider): the Tether mark, ⌘K search, the screens with their counts, the Projects and Pinned
 * sections and Settings. ⌘\ or the button by the mark toggles 300 px ↔ 76 px; collapsed, every icon shows its label as a tooltip.
 */
export function Sidebar(p: SidebarProps) {
  const [open, toggle] = useSidebarOpen();
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const asideRef = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<{ key: string; label: string; top: number }>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tipId = useId();

  const hideTip = () => {
    clearTimeout(timer.current);
    setTip(undefined);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\' || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      hideTip();
      toggleRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // the tip can be dismissed with Escape wherever focus and pointer are (WCAG 1.4.13); its timer dies with the sidebar
  useEffect(() => {
    if (!tip) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && hideTip();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tip]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(hideTip, [open]);

  const tipFor = (key: string, label: string): TipProps => {
    const show = (e: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
      if (open) return;
      const el = e.currentTarget;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const box = el.getBoundingClientRect();
        setTip({ key, label, top: box.top - (asideRef.current?.getBoundingClientRect().top ?? 0) + box.height / 2 });
      }, TIP_DELAY_MS);
    };
    return { onPointerEnter: show, onFocus: show, onPointerLeave: hideTip, onBlur: hideTip, 'aria-describedby': tip?.key === key ? tipId : undefined };
  };
  const current = p.projects.list.find((w) => w.id === p.projects.current);
  const toggleLabel = open ? 'Collapse sidebar' : 'Expand sidebar';
  const toggleHint = `${toggleLabel}  ${isApple() ? '⌘' : 'Ctrl '}\\`;

  return (
    <aside ref={asideRef} className={cn('sl-side', { collapsed: !open })} aria-label="Sidebar">
      <div className="sl-side-head">
        <Glyph size={30} />
        {open ? <span className="sl-wordmark">Tether</span> : null}
        {open ? (
          <button type="button" className="sl-side-icon-btn sl-side-toggle" aria-label={toggleLabel} title={toggleHint} onClick={toggle}>
            <PanelLeftClose size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {open ? (
        <button type="button" className="sl-side-search" aria-label="Search or jump to" onClick={p.onSearch}>
          <Search size={17} aria-hidden="true" />
          <span className="sl-side-label">Search</span>
          <Kbd mod>K</Kbd>
        </button>
      ) : (
        <button type="button" className="sl-side-item sl-side-expand" aria-label={toggleLabel} title={toggleHint} onClick={toggle} {...tipFor('expand', 'Expand sidebar')}>
          <PanelLeftOpen size={17} aria-hidden="true" />
        </button>
      )}

      <div className="sl-side-scroll">
        <nav className="sl-side-nav" aria-label="Main">
          {NAV.map((n) => (
            <SideItem
              key={n.id}
              label={n.long ?? n.label}
              Icon={n.Icon}
              open={open}
              page
              current={!p.settingsOpen && n.id === p.active}
              count={n.id === 'home' ? { n: p.counts.needs, tone: 'needs' } : n.id === 'runs' ? { n: p.counts.live, tone: 'live' } : undefined}
              onClick={() => p.onGo(n.id)}
              tip={tipFor(n.id, n.long ?? n.label)}
            />
          ))}
        </nav>
        <div className="sl-side-rule" />
        <SideSection
          title="Projects"
          open={open}
          addLabel="Open folder…"
          onAdd={p.projects.onAdd}
          moreLabel="Project options"
          menu={current ? [{ label: `Remove ${current.name} from Tether`, onPick: () => p.projects.onRemove(current) }] : [{ label: 'No project open', onPick: () => {}, disabled: true }]}
          empty="No projects yet. Open a folder with +."
        >
          {p.projects.list.map((w) => (
            <SideItem key={w.id} small label={w.name} Icon={Folder} open={open} current={w.id === p.projects.current} live={p.projects.live.has(w.id)} onClick={() => p.projects.onSelect(w.id)} tip={tipFor(`project:${w.id}`, w.name)} />
          ))}
        </SideSection>
        <SideSection
          title="Pinned"
          open={open}
          addLabel={p.pins.canPin ? 'Pin this run or request' : 'Open a run or a saved request to pin it'}
          addDisabled={!p.pins.canPin}
          onAdd={p.pins.onPin}
          moreLabel="Pinned options"
          menu={p.pins.list.length ? p.pins.list.map((x) => ({ label: `Unpin ${x.label}`, onPick: () => p.pins.onUnpin(x) })) : [{ label: 'Nothing pinned', onPick: () => {}, disabled: true }]}
          empty="Pin a run or a saved request with +."
        >
          {p.pins.list.map((x) => (
            <SideItem key={`${x.kind}:${x.id}`} small label={x.label} Icon={PinIcon} open={open} meta={x.kind === 'run' ? 'run' : 'API'} onClick={() => p.pins.onOpen(x)} tip={tipFor(`pin:${x.kind}:${x.id}`, x.label)} />
          ))}
        </SideSection>
      </div>

      <div className="sl-side-foot">
        <SideItem label="Settings" Icon={Settings} open={open} current={!!p.settingsOpen} page meta={<Kbd mod>,</Kbd>} onClick={p.onSettings} tip={tipFor('settings', 'Settings')} />
      </div>
      {tip ? (
        <div className="sl-side-tip" role="tooltip" id={tipId} style={{ top: tip.top }}>
          {tip.label}
        </div>
      ) : null}
    </aside>
  );
}
