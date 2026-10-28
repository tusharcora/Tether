import type { Pipeline } from '../../../src/types';
import { crewFor, useCrew } from '../crewStore';
import { Face } from '../Face';
import { stepOrder } from '../runs/graphModel';
import { cn } from '../ui/cn';
import { flowLine, loopSentence, stepPreview, stepTitle } from './stepText';

export type BuilderMode = 'canvas' | 'outline';

/**
 * The workflow as a numbered document (mockup .outline): its name, a line generated from the steps (§15.3), then one block
 * per step in run order. A click selects the step for the docked editor; "/" (or the line at the end) adds one.
 */
export function Outline(p: { pl: Pipeline; selected?: string; issueNodes: Set<string>; onSelect: (id: string) => void; /** Absent where the workflow cannot be edited (phone). */ onAdd?: () => void }) {
  const { crew } = useCrew();
  const bot = (id: string) => crew[id]?.name ?? id;
  const byId = new Map(p.pl.nodes.map((n) => [n.id, n]));
  return (
    <div className="bl-outline">
      <div className="bl-paper">
        <h2>{p.pl.name || 'untitled'}</h2>
        <p className="bl-desc">{flowLine(p.pl, (n) => bot(crewFor(n, crew)))}</p>
        <ol className="bl-flow">
          {stepOrder(p.pl.nodes, p.pl.edges).map((id, i) => {
            const n = byId.get(id)!;
            const on = [n.agent, n.model].filter(Boolean).join(' · ');
            const loop = loopSentence(n, p.pl.nodes);
            return (
              <li key={id}>
                <button type="button" className={cn('bl-blk', { issue: p.issueNodes.has(id) })} aria-pressed={p.selected === id} onClick={() => p.onSelect(id)}>
                  <span className="bl-blk-n">{i + 1}</span>
                  <span className="bl-blk-t">
                    <Face id={crewFor(n, crew)} size={24} />
                    <b>{stepTitle(n)}</b>
                    <span className="bl-blk-who">{`· ${bot(crewFor(n, crew))}${on ? ` on ${on}` : ''}`}</span>
                    {n.readOnly ? <span className="sl-tag">read-only</span> : null}
                    {n.kind !== 'agent' ? <span className="sl-tag">{n.kind}</span> : null}
                  </span>
                  <span className="bl-blk-p">{stepPreview(n)}</span>
                  {loop ? <span className="bl-blk-loop">{loop}</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
        {p.onAdd ? (
          <button type="button" className="bl-slash" onClick={p.onAdd}>
            ＋ type <kbd className="sl-kbd">/</kbd> to add a step
          </button>
        ) : null}
      </div>
    </div>
  );
}
