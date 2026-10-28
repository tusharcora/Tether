import { useLayoutEffect, useRef } from 'react';
import type { RunView, StoredEvent } from '../api';
import { crewFor, useCrew } from '../crewStore';
import { cn } from '../ui/cn';
import { QuietLine } from '../ui/studio/Section';
import { outputLines } from './outputModel';

/**
 * The run's live output (the demo's terminal): one line per event, the bot's name then what happened in its tone colour.
 * It sticks to the bottom while you are there; a line about a step opens that step.
 */
export function OutputLog({ run: r, events, onPick }: { run: RunView; events: StoredEvent[]; onPick: (node: string) => void }) {
  const { crew } = useCrew();
  const nameOf = (id: string) => {
    const n = r.pipeline.nodes.find((x) => x.id === id);
    return n ? (crew[crewFor(n, crew)]?.name ?? id) : id;
  };
  const lines = outputLines(events, nameOf);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    if (box.current && stick.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length]);
  return (
    <div ref={box} className="term" role="log" aria-label="Output" onScroll={(e) => (stick.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 24)}>
      {!lines.length ? <QuietLine>No output yet.</QuietLine> : null}
      {lines.map((l) => {
        const body = (
          <>
            <span className="out-who">{l.who}</span>
            <span className={cn('out-text', `t-${l.tone}`)}>{l.text}</span>
          </>
        );
        return l.node ? (
          <button key={l.seq} type="button" className="out-line" data-node={l.node} onClick={() => onPick(l.node!)}>
            {body}
          </button>
        ) : (
          <div key={l.seq} className="out-line">
            {body}
          </div>
        );
      })}
    </div>
  );
}
