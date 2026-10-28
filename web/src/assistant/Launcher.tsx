import { ChevronDown } from 'lucide-react';
import { forwardRef } from 'react';
import { TetherFace } from '../components/faces/TetherFace';
import { cn } from '../ui/cn';
import { isApple } from '../ui/studio/Kbd';

/**
 * Tether's launcher: its face in an ink circle at the bottom right of every screen (above the bottom bar on a phone). While
 * something needs the person and they have not opened the panel since, an amber count sits on it and a soft ring breathes.
 * With the floating panel open it shows a chevron that closes it.
 */
export const Launcher = forwardRef<HTMLButtonElement, { open: boolean; unseen: number; onClick: () => void }>(function Launcher(p, ref) {
  const key = isApple() ? '⌘J' : 'Ctrl J';
  const label = p.open ? `Close Tether (${key})` : `Ask Tether (${key})${p.unseen ? ` — ${p.unseen} need${p.unseen === 1 ? 's' : ''} you` : ''}`;
  return (
    <button ref={ref} type="button" className={cn('tether-launcher', { needs: p.unseen > 0 })} aria-label={label} title={p.open ? undefined : `Ask Tether  ${key}`} aria-expanded={p.open} onClick={p.onClick}>
      {p.open ? <ChevronDown size={20} strokeWidth={2} aria-hidden="true" /> : <TetherFace size={30} eyeScale={1.15} />}
      {p.unseen > 0 ? (
        <span className="tether-badge" aria-hidden="true">
          {p.unseen > 9 ? '9+' : p.unseen}
        </span>
      ) : null}
    </button>
  );
});
