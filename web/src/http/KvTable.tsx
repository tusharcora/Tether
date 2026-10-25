import { useState } from 'react';
import { Button } from '../components/arc/button/button';
import type { KV } from './client';

/** Rows of name → value (params, headers, form fields, variables). Existing rows edit in place; new rows come from the add line. */
export function KvTable(props: { rows: KV[]; onChange: (rows: KV[]) => void; noun: string; toggles?: boolean }) {
  const { rows, noun } = props;
  const Noun = noun[0]!.toUpperCase() + noun.slice(1);
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const set = (i: number, patch: Partial<KV>) => props.onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => {
    props.onChange([...rows, { key: k.trim(), value: v, on: true }]);
    setK('');
    setV('');
  };
  return (
    <div className="kv">
      {rows.map((r, i) => (
        <div className="kv-row" key={i} data-off={r.on ? undefined : ''}>
          {props.toggles !== false ? <input type="checkbox" aria-label={`Use ${noun} ${r.key || i + 1}`} checked={r.on} onChange={(e) => set(i, { on: e.target.checked })} /> : <span />}
          <input className="kv-input mono" aria-label={`${Noun} name ${i + 1}`} value={r.key} spellCheck={false} onChange={(e) => set(i, { key: e.target.value })} />
          <input className="kv-input mono" aria-label={`${Noun} value ${i + 1}`} value={r.value} spellCheck={false} onChange={(e) => set(i, { value: e.target.value })} />
          <button type="button" className="kv-x" aria-label={`Remove ${noun} ${r.key || i + 1}`} onClick={() => props.onChange(rows.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <form
        className="kv-row kv-new"
        onSubmit={(e) => {
          e.preventDefault();
          if (k.trim()) add();
        }}
      >
        <span />
        <input className="kv-input mono" aria-label={`New ${noun} name`} placeholder="name" value={k} spellCheck={false} onChange={(e) => setK(e.target.value)} />
        <input className="kv-input mono" aria-label={`New ${noun} value`} placeholder="value or {{var}}" value={v} spellCheck={false} onChange={(e) => setV(e.target.value)} />
        <Button type="submit" variant="ghost" size="sm" disabled={!k.trim()}>
          Add {noun}
        </Button>
      </form>
    </div>
  );
}
