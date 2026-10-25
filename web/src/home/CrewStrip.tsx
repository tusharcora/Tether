import type { RunRow } from '../api';
import { useCrew } from '../crewStore';
import { Face } from '../Face';
import { cn } from '../ui/cn';
import { Panel } from '../ui/studio/Panel';
import { busyBots } from './runText';

const MAX = 24;

/** The roster's faces: bots of running steps in live runs breathe, the rest are dimmed. Imported bots show only while busy. */
export function CrewStrip(props: { runs: RunRow[] | undefined }) {
  const { crew } = useCrew();
  const busy = busyBots(props.runs ?? []);
  const ids = Object.keys(crew).filter((id) => !crew[id]!.source || busy.has(id));
  return (
    <Panel title="Crew" count={ids.length} className="s-crew">
      <ul className="crew-strip">
        {ids.slice(0, MAX).map((id) => {
          const on = busy.has(id);
          const name = crew[id]!.name;
          return (
            <li key={id} className={cn('crew-face', { idle: !on })}>
              {on ? <Face id={id} size={36} mood="working" animate="always" label={`${name}, busy`} /> : <Face id={id} size={36} label={name} />}
              <span className="crew-name" aria-hidden="true">
                {name}
              </span>
            </li>
          );
        })}
      </ul>
      {ids.length > MAX ? <p className="sl-meta">{ids.length - MAX} more in Crew</p> : null}
    </Panel>
  );
}
