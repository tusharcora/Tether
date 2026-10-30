import { Plus } from 'lucide-react';
import { useContext } from 'react';
import { Picker, type PickerOption } from '../components/bencho/Picker';
import { Face } from '../Face';
import { Avatars, Roster, useWho } from './Avatars';
import type { Assignee } from './goalsApi';
import './goals.css';

const key = (a: Assignee) => `${a.kind}:${a.id}`;
const fromKey = (k: string): Assignee => ({ kind: k.slice(0, k.indexOf(':')) as Assignee['kind'], id: k.slice(k.indexOf(':') + 1) });

/**
 * Who works on a goal or a step: one multi-select Picker with Teams and Agents as groups. An assignee whose team or agent is
 * gone stays in the list, chosen, as "removed". `compact`: just the faces and a "+" that open the same list.
 */
export function AssigneePicker({ value, onChange, compact, label = 'Assignees' }: { value: Assignee[]; onChange: (v: Assignee[]) => void; compact?: boolean; label?: string }) {
  const roster = useContext(Roster);
  const whoIs = useWho();
  const known: Assignee[] = [...(roster?.teams ?? []).map((t) => ({ kind: 'team' as const, id: t.id })), ...(roster?.agents ?? []).map((a) => ({ kind: 'agent' as const, id: a.id }))];
  const options = [...known, ...value.filter((v) => !known.some((k) => key(k) === key(v)))].map((a): PickerOption => {
    const w = whoIs(a);
    return { id: key(a), name: w.removed ? `${w.name} (removed)` : w.name, group: a.kind === 'team' ? 'Teams' : 'Agents', lead: a.kind === 'agent' ? <Face id={a.id} size={28} label="" /> : undefined };
  });
  return (
    <Picker
      label={label}
      hideLabel={compact}
      multiple
      options={options}
      value={value.map(key)}
      onChange={(ids) => onChange(ids.map(fromKey))}
      placeholder="Nobody yet"
      className={compact ? 'ap-compact' : undefined}
      trigger={
        compact ? (
          <>
            <Avatars who={value} size={22} />
            <span className="ap-plus" aria-hidden="true">
              <Plus size={12} strokeWidth={2} />
            </span>
          </>
        ) : undefined
      }
    />
  );
}
