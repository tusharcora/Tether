import { useEffect, useState } from 'react';
import { MAX_REPEAT, type HttpGate, type HttpTree, type TreeCollection, type TreeRequest } from '../../src/http/types';
import { api } from './api';
import { Input } from './components/arc/input/input';
import SegmentedControl from './components/arc/segmented-control/segmented-control';
import { Select } from './components/arc/select/select';
import { NONE, fromNone } from './ui/cn';

export const flattenTree = (c: TreeCollection): TreeRequest[] => [...c.requests, ...c.collections.flatMap(flattenTree)];

/** A gate's saved-request settings: which request, which environment, how many sends, which ones count. */
export function RequestGateFields(props: { http: HttpGate; onChange: (h: HttpGate) => void }) {
  const [tree, setTree] = useState<HttpTree>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<HttpTree>('GET', '/api/http/tree')
      .then(setTree)
      .catch((e: Error) => setError(e.message === 'no workspace' ? 'Register this folder as a workspace (aorch workspace init) to pick saved requests.' : e.message));
  }, []);
  const reqs = tree ? flattenTree(tree.root).filter((r) => !r.invalid) : [];
  const h = props.http;
  // a gate switched to "Request" starts on the first saved request (with none, it stays `run: ''` and preflight says so)
  useEffect(() => {
    if (!h.run && reqs[0]) props.onChange({ ...h, run: reqs[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);
  /** `run` is always kept (possibly empty); the optional settings are dropped when back at their defaults. */
  const set = (patch: Partial<HttpGate>) => {
    const next: HttpGate = { ...h, ...patch };
    for (const k of ['env', 'repeat', 'expect'] as const) if (next[k] === undefined || next[k] === '') delete next[k];
    props.onChange(next);
  };
  if (error) return <p className="muted small">{error}</p>;
  return (
    <>
      <Select
        label="Saved request"
        options={reqs.length ? reqs.map((r) => ({ value: r.id, label: `${r.method} ${r.id}` })) : [{ value: NONE, label: tree ? 'no saved requests yet' : 'loading…', disabled: true }]}
        value={h.run || NONE}
        onValueChange={(v) => set({ run: fromNone(v) })}
      />
      <Select
        label="Environment"
        options={[{ value: NONE, label: "the workspace's active one" }, ...(tree?.environments ?? []).map((e) => ({ value: e, label: e }))]}
        value={h.env ?? NONE}
        onValueChange={(v) => set({ env: fromNone(v) || undefined })}
      />
      <Input
        label="Repeat"
        type="number"
        min="1"
        max={String(MAX_REPEAT)}
        value={h.repeat ?? 1}
        onChange={(e) => {
          const n = Math.min(MAX_REPEAT, Math.max(1, Math.trunc(Number(e.target.value) || 1)));
          set({ repeat: n === 1 ? undefined : n });
        }}
      />
      <SegmentedControl
        label="Which sends must pass"
        options={[
          { value: 'all', label: 'Every send' },
          { value: 'last', label: 'Last send' },
        ]}
        value={h.expect ?? 'all'}
        onValueChange={(v) => set({ expect: v === 'last' ? 'last' : undefined })}
      />
    </>
  );
}
