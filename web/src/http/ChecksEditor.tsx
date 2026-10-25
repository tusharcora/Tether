import { useState, type InputHTMLAttributes } from 'react';
import { Button } from '../components/arc/button/button';
import type { Check } from './client';

const OPS: Record<Check['kind'], string[]> = {
  status: ['eq', 'ne', 'in', 'lt', 'gte'],
  header: ['exists', 'eq', 'contains', 'matches'],
  json: ['exists', 'eq', 'ne', 'contains', 'matches', 'lt', 'gt'],
  time: ['lt'],
  body: ['contains', 'matches'],
};
const parseLoose = (t: string): unknown => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};

/** Build a well-formed check from the row's fields (the server validates again on save). */
export function checkFrom(kind: Check['kind'], op: string, field: string, text: string): Check {
  const o = OPS[kind].includes(op) ? op : OPS[kind][0]!;
  switch (kind) {
    case 'status':
      return o === 'in' ? { kind, op: 'in', value: text.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isInteger) } : { kind, op: o as 'eq', value: Number(text) || 0 };
    case 'header':
      return o === 'exists' ? { kind, name: field, op: 'exists' } : { kind, name: field, op: o as 'eq', value: text };
    case 'json':
      return o === 'exists' ? { kind, path: field || '$', op: 'exists' } : { kind, path: field || '$', op: o as 'eq', value: parseLoose(text) };
    case 'time':
      return { kind, op: 'lt', value: Number(text) || 1000 };
    case 'body':
      return { kind, op: o as 'contains', value: text };
  }
}
const fieldOf = (c: Check) => (c.kind === 'header' ? c.name : c.kind === 'json' ? c.path : '');
const textOf = (c: Check) => ('value' in c ? (typeof c.value === 'string' ? c.value : Array.isArray(c.value) && c.kind === 'status' ? c.value.join(',') : JSON.stringify(c.value)) : '');

/** A field whose typed text is kept while it has focus: the check is rebuilt on every keystroke, and a half-written
 *  value ("200," or an empty box) must not snap back to its parsed form under the cursor. */
function DraftInput({ value, onText, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onText: (t: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...rest}
      className="kv-input mono"
      spellCheck={false}
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value);
        onText(e.target.value);
      }}
    />
  );
}

export function ChecksEditor(props: { checks: Check[]; onChange: (c: Check[]) => void }) {
  const set = (i: number, c: Check) => props.onChange(props.checks.map((x, j) => (j === i ? c : x)));
  return (
    <div className="checks-edit">
      {props.checks.map((c, i) => {
        const n = i + 1;
        const hasField = c.kind === 'header' || c.kind === 'json';
        const hasValue = !(c.op === 'exists');
        return (
          <div className="check-row" key={i}>
            <select aria-label={`Check ${n} kind`} value={c.kind} onChange={(e) => set(i, checkFrom(e.target.value as Check['kind'], c.op, fieldOf(c), textOf(c)))}>
              {Object.keys(OPS).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            {hasField ? <DraftInput aria-label={`Check ${n} ${c.kind === 'json' ? 'path' : 'header name'}`} placeholder={c.kind === 'json' ? '$.items[0].id' : 'Content-Type'} value={fieldOf(c)} onText={(t) => set(i, checkFrom(c.kind, c.op, t, textOf(c)))} /> : null}
            <select aria-label={`Check ${n} op`} value={c.op} onChange={(e) => set(i, checkFrom(c.kind, e.target.value, fieldOf(c), textOf(c)))}>
              {OPS[c.kind].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            {hasValue ? <DraftInput aria-label={`Check ${n} value`} value={textOf(c)} onText={(t) => set(i, checkFrom(c.kind, c.op, fieldOf(c), t))} /> : <span />}
            <button type="button" className="kv-x" aria-label={`Remove check ${n}`} onClick={() => props.onChange(props.checks.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        );
      })}
      <Button variant="ghost" size="sm" onClick={() => props.onChange([...props.checks, { kind: 'status', op: 'eq', value: 200 }])}>
        Add check
      </Button>
    </div>
  );
}
