import { useId } from 'react';
import { Tabs, TabsList, TabsTrigger } from '../components/beui/kit/controls';
import { SearchField } from '../components/beui/kit/fields';
import type { BotDef } from '../crewStore';
import { Face } from '../Face';
import { cn } from '../ui/cn';
import { FloatBar } from '../ui/studio/ToolFrame';
import { isEcc, sourceOf, type Filter } from './types';

/** One library bot: a click opens it in the dock; dragging it onto a role of its kind makes it play that role. */
function Sub(p: { bot: BotDef; selected: boolean; onPick: () => void; onDrag: (id?: string) => void }) {
  const b = p.bot;
  const desc = useId();
  return (
    // shortcut: <button draggable> drags in Chromium (the app and Chrome); Firefox needs a draggable wrapper, add one if Firefox matters
    <button
      type="button"
      className={cn('cw-sub', { on: p.selected })}
      aria-label={`Edit ${b.name}`}
      aria-describedby={desc}
      aria-pressed={p.selected}
      onClick={p.onPick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer?.setData('text/plain', b.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        p.onDrag(b.id);
      }}
      onDragEnd={() => p.onDrag(undefined)}
    >
      <span className="cw-sub-head">
        <Face id={b.id} size={30} />
        <b>{b.name}</b>
      </span>
      <span className="cw-sub-when" id={desc}>
        {b.whenToUse || b.persona}
      </span>
      <span className="cw-chip mono" title={b.source}>
        {isEcc(b) ? 'ECC' : 'yours'}
      </span>
    </button>
  );
}

/** The library along the bottom (mockup .bench): your own bots and ECC's, searchable and filtered by source. */
export function Bench(p: { bots: BotDef[]; filter: Filter; onFilter: (f: Filter) => void; q: string; onQ: (q: string) => void; selected?: string; onPick: (id: string) => void; onDrag: (id?: string) => void }) {
  const hasEcc = p.bots.some(isEcc);
  const count = (f: Filter) => p.bots.filter((b) => f === 'all' || sourceOf(b) === f).length;
  const view: Filter = p.filter === 'ecc' && !hasEcc ? 'all' : p.filter;
  const needle = p.q.trim().toLowerCase();
  const shown = p.bots.filter((b) => (view === 'all' || sourceOf(b) === view) && (!needle || `${b.name} ${b.title} ${b.id} ${b.whenToUse ?? ''} ${b.persona}`.toLowerCase().includes(needle)));
  return (
    <FloatBar at="bottom" className="cw-bench">
      <div className="cw-bench-head">
        <b>Library</b>
        <Tabs value={view} onValueChange={(v) => p.onFilter(v as Filter)}>
          <TabsList aria-label="Bot source">
            <TabsTrigger value="all">{`All ${count('all')}`}</TabsTrigger>
            <TabsTrigger value="custom">{`Yours ${count('custom')}`}</TabsTrigger>
            {hasEcc ? <TabsTrigger value="ecc">{`ECC ${count('ecc')}`}</TabsTrigger> : null}
          </TabsList>
        </Tabs>
        <SearchField className="cw-bench-q" label="Find a bot" value={p.q} onValueChange={p.onQ} placeholder="Name or when to use" />
      </div>
      <div className="cw-strip">
        {shown.length ? shown.map((b) => <Sub key={b.id} bot={b} selected={p.selected === b.id} onPick={() => p.onPick(b.id)} onDrag={p.onDrag} />) : <p className="sl-quiet">{p.bots.length ? 'No bots match' : 'No bots of your own yet.'}</p>}
      </div>
    </FloatBar>
  );
}
