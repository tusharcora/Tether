import { useState } from 'react';
import { SearchField } from '../components/beui/kit/fields';
import { Dialog, DialogContent, useDrawerItem } from '../components/beui/kit/overlays';
import type { BotDef } from '../crewStore';
import { Face } from '../Face';
import { canPlay } from './roles';

/** The keyboard way to put a library bot in a role (a drop's alternative): the bots of the role's kind, searchable. */
export function SwapPicker(p: { slot?: BotDef; bots: BotDef[]; onPick: (bench: BotDef) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  // the dialog keeps its role while it animates out
  const s = useDrawerItem(p.slot);
  const needle = q.trim().toLowerCase();
  const fits = s ? p.bots.filter((b) => canPlay(b, s) && (!needle || `${b.name} ${b.whenToUse ?? ''} ${b.persona}`.toLowerCase().includes(needle))) : [];
  return (
    <Dialog open={!!p.slot} onOpenChange={(o) => !o && (setQ(''), p.onClose())}>
      <DialogContent title={`Swap ${s?.name ?? ''}`} description={`Bots that can play ${s?.title ?? ''}. Applies to the next run.`}>
        <SearchField label="Find a stand-in" value={q} onValueChange={setQ} placeholder="Name or when to use" />
        <div className="cw-swap-list">
          {fits.length ? (
            fits.map((b) => (
              <button key={b.id} type="button" className="cw-swap" onClick={() => (setQ(''), p.onPick(b))}>
                <Face id={b.id} size={28} />
                <span className="cw-swap-text">
                  <b>{b.name}</b>
                  <span>{b.whenToUse || b.persona}</span>
                </span>
              </button>
            ))
          ) : (
            <p className="sl-quiet">{`No ${s?.kind ?? ''} bot in the library${needle ? ' matches' : ' yet'}.`}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
