import { createContext, useContext } from 'react';
import { useCrew } from '../crewStore';
import { Face } from '../Face';
import type { TeamsReply } from '../teams/teamsApi';
import { cn } from '../ui/cn';
import type { Assignee } from './goalsApi';
import './goals.css';

/** The teams and crew agents a goal can go to (GET /api/teams): names, faces, and who is gone. */
export const Roster = createContext<TeamsReply | undefined>(undefined);

export interface Who {
  a: Assignee;
  name: string;
  /** Its team or agent no longer exists: kept, shown grey. */
  removed: boolean;
}

/** Who an assignee is now. A team is only called removed once the teams have loaded, so nothing flashes grey. */
export function useWho(): (a: Assignee) => Who {
  const roster = useContext(Roster);
  const { crew } = useCrew();
  return (a) => {
    if (a.kind === 'team') {
      const t = roster?.teams.find((x) => x.id === a.id);
      return { a, name: t?.name ?? a.id, removed: !!roster && !t };
    }
    const bot = crew[a.id];
    const agent = roster?.agents.find((x) => x.id === a.id);
    return { a, name: bot?.name ?? agent?.name ?? a.id, removed: !bot && !agent };
  };
}

/** Up to three faces, overlapping, then "+N": an agent is its bot face, a team a rounded square with its initial. */
export function Avatars({ who, size = 26 }: { who: Assignee[]; size?: 22 | 26 }) {
  const whoIs = useWho();
  if (!who.length) return null;
  const all = who.map(whoIs);
  const shown = all.slice(0, 3);
  const more = all.length - shown.length;
  const named = (w: Who) => (w.removed ? `${w.name} (removed)` : w.name);
  return (
    <span className={cn('gav', `s${size}`)} role="img" aria-label={`Assigned to ${shown.map(named).join(', ')}${more ? ` and ${more} more` : ''}`}>
      {shown.map((w, i) => (
        <span key={`${i}:${w.a.kind}:${w.a.id}`} className={cn('gav-face', w.a.kind, w.removed && 'removed')} title={named(w)}>
          {w.a.kind === 'team' ? w.name.slice(0, 1).toUpperCase() : <Face id={w.a.id} size={size} label="" />}
        </span>
      ))}
      {more ? <span className="gav-more">+{more}</span> : null}
    </span>
  );
}
