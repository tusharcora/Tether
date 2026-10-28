import { Ellipsis, Settings } from 'lucide-react';
import type { Screen } from '../../hooks';
import { cn } from '../cn';
import { NAV } from './nav';
import './shell.css';
import { useMenu } from './useMenu';

const MAIN: Screen[] = ['home', 'runs', 'builder', 'crew', 'api'];
// the bottom bar stays as it was before the Inbox route (Home shows what needs you on a phone)
const MORE = NAV.filter((n) => !MAIN.includes(n.id) && n.id !== 'inbox');

export interface BottomBarProps {
  active: Screen;
  /** The Settings page is open over the active screen. */
  settingsOpen?: boolean;
  onGo: (s: Screen) => void;
  onSettings: () => void;
}

/** Under 900 px: five screens and a More menu (the other screens and Settings). */
export function BottomBar(p: BottomBarProps) {
  const menu = useMenu();
  const moreActive = !!p.settingsOpen || MORE.some((n) => n.id === p.active);

  return (
    <nav className="sl-bottombar" aria-label="Main">
      {NAV.filter((n) => MAIN.includes(n.id)).map((n) => (
        <button key={n.id} type="button" className={cn('sl-bottom-btn', { current: !p.settingsOpen && p.active === n.id })} aria-current={!p.settingsOpen && p.active === n.id ? 'page' : undefined} onClick={() => p.onGo(n.id)}>
          <n.Icon size={18} strokeWidth={1.75} aria-hidden="true" />
          {n.label}
        </button>
      ))}
      <button ref={menu.triggerRef} type="button" className={cn('sl-bottom-btn', { current: moreActive })} aria-haspopup="menu" aria-expanded={menu.open} aria-current={moreActive ? 'page' : undefined} onClick={menu.toggle}>
        <Ellipsis size={18} strokeWidth={1.75} aria-hidden="true" />
        More
      </button>
      {menu.open ? (
        <div ref={menu.menuRef} className="sl-menu sl-bottom-menu" role="menu" aria-label="More" onKeyDown={menu.onMenuKey}>
          {MORE.map((n) => (
            <button key={n.id} type="button" role="menuitem" onClick={() => (menu.close(), p.onGo(n.id))}>
              <n.Icon size={16} aria-hidden="true" />
              {n.label}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => (menu.close(), p.onSettings())}>
            <Settings size={16} aria-hidden="true" />
            Settings
          </button>
        </div>
      ) : null}
    </nav>
  );
}
