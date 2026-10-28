import { File, Play, Workflow, ArrowRight, type LucideIcon } from 'lucide-react';
import type { Pin } from '../../api';
import { SortableList, SortableListGroup, SortableListHandle, SortableListItem, SortableListItemContent } from '../../components/beui/motion/sortable-list';
import { SideMenu, SideRow, type TipProps } from './SideParts';

const PIN_ICON: Record<Pin['kind'], LucideIcon> = { run: Play, request: ArrowRight, workflow: Workflow, file: File };
const pinId = (x: Pin) => `${x.kind}:${x.ws ?? ''}:${x.id}`;
const swap = <T,>(a: T[], i: number, j: number): T[] => {
  const b = [...a];
  [b[i], b[j]] = [b[j]!, b[i]!];
  return b;
};

/**
 * The classes passed to the beui parts only cancel their default card look (the rows are plain sidebar rows); the layout is
 * shell.css's `.sl-pin-*`, since Tailwind scans no folder outside components/ for utilities.
 *
 * Favorites as beui's sortable list: a handle on each row (shown on hover and focus) to drag it, or to move it with the arrow
 * keys, Home and End when the handle has focus, with the new position announced. The ⋯ menu keeps Unpin, Move up and Move
 * down. On the collapsed rail the rows stay put (no handle, no drag).
 */
export function PinList(p: { pins: Pin[]; collapsed: boolean; onOpen: (x: Pin) => void; onUnpin: (x: Pin) => void; onReorder: (next: Pin[]) => void; tipFor: (key: string, label: string) => TipProps | undefined }) {
  const items = p.pins.map((pin) => ({ id: pinId(pin), pin }));
  return (
    <SortableList
      items={items}
      label="Favorites"
      getItemLabel={(x) => x.pin.label}
      disabled={p.collapsed}
      showUndo={false}
      className="sl-pins max-w-none"
      onItemsChange={(next) => p.onReorder(next.map((x) => x.pin))}
    >
      {(rows) => (
        <SortableListGroup className="sl-pin-group space-y-0">
          {rows.map((x, i) => (
            <SortableListItem key={x.id} id={x.id} className="sl-pin-li gap-0 rounded-lg border-0 bg-transparent p-0">
              <SortableListHandle className="sl-pin-grip size-6" />
              <SortableListItemContent>
                <SideRow
                  className="pin"
                  label={x.pin.label}
                  Icon={PIN_ICON[x.pin.kind]}
                  onClick={() => p.onOpen(x.pin)}
                  rail={p.tipFor(`pin:${i}`, x.pin.label)}
                  extra={
                    <SideMenu
                      className="sl-side-row-more"
                      label={`${x.pin.label} options`}
                      items={[{ label: `Unpin ${x.pin.label}`, onPick: () => p.onUnpin(x.pin) }, ...(i > 0 ? [{ label: 'Move up', onPick: () => p.onReorder(swap(p.pins, i, i - 1)) }] : []), ...(i < p.pins.length - 1 ? [{ label: 'Move down', onPick: () => p.onReorder(swap(p.pins, i, i + 1)) }] : [])]}
                    />
                  }
                />
              </SortableListItemContent>
            </SortableListItem>
          ))}
        </SortableListGroup>
      )}
    </SortableList>
  );
}
