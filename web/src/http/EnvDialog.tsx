import './api.css';
import { useEffect, useState } from 'react';
import { Button } from '../components/arc/button/button';
import { Dialog, DialogContent } from '../components/arc/dialog/dialog';
import { Input } from '../components/arc/input/input';
import { Loading } from '../components/Loading';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { httpApi, type EnvValue } from './client';

interface Row {
  key: string;
  /** A plain value, or the secret key name when `secret` is set (never a secret value). */
  value: string;
  secret: boolean;
}
const toRows = (vars: Record<string, EnvValue>): Row[] => Object.entries(vars).map(([key, v]) => (typeof v === 'string' ? { key, value: v, secret: false } : { key, value: v.secret, secret: true }));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One environment: rows of name → value, or name → a secret key (the value stays in secrets.json and is never shown). */
export function EnvDialog(p: { ws?: string; open: boolean; onOpenChange: (o: boolean) => void; name?: string; onSaved: (name: string | null) => void }) {
  const notify = useNotify();
  const [name, setName] = useState(p.name ?? '');
  const [rows, setRows] = useState<Row[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string>();
  const [keysErr, setKeysErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!p.open) return;
    let live = true;
    setName(p.name ?? '');
    setRows([]);
    setLoadErr(undefined);
    setKeysErr(undefined);
    httpApi.secrets(p.ws).then(
      (r) => live && setKeys(r.keys),
      (e: unknown) => live && (setKeys([]), setKeysErr(message(e))),
    );
    if (p.name) {
      setLoading(true);
      httpApi.env(p.ws, p.name).then(
        (e) => live && (setRows(toRows(e.vars)), setLoading(false)),
        (e: unknown) => live && (setLoadErr(message(e)), setLoading(false)),
      );
    } else setLoading(false);
    return () => {
      live = false;
    };
  }, [p.open, p.name, p.ws]);
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = async () => {
    const vars: Record<string, EnvValue> = {};
    for (const r of rows) if (r.key.trim()) vars[r.key.trim()] = r.secret ? { secret: r.value } : r.value;
    setBusy(true);
    try {
      await httpApi.saveEnv(p.ws, name.trim(), { v: 1, vars });
      notify.ok(`Saved ${name.trim()}`);
      p.onSaved(name.trim());
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    try {
      await httpApi.deleteEnv(p.ws, p.name!);
      notify.ok(`Deleted ${p.name}`);
      p.onSaved(null);
    } catch (e) {
      notify.fail(e);
    }
  };
  const label = (r: Row, i: number) => r.key || `row ${i + 1}`;
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      {p.open ? (
        <DialogContent className="studio api-dialog" title={p.name ? `Environment ${p.name}` : 'New environment'} description="Saved in .aorch/http/environments/ (committed). Secret values stay on this machine.">
          <div className="dialog-body">
            <Input label="Environment name" placeholder="local" value={name} disabled={!!p.name} spellCheck={false} onChange={(e) => setName(e.target.value)} />
            {loadErr ? (
              <p className="resp-error" role="alert">
                {loadErr}
              </p>
            ) : null}
            {keysErr ? (
              <p className="resp-error" role="alert">
                {`Could not load secret keys: ${keysErr}`}
              </p>
            ) : null}
            <Loading loading={loading} lines={3} label="Loading environment">
              <div className="env-rows">
                {rows.map((r, i) => (
                  <div className="env-row" key={i}>
                    <input className="kv-input mono" aria-label={`Variable name ${i + 1}`} value={r.key} spellCheck={false} onChange={(e) => set(i, { key: e.target.value })} />
                    <label className="env-secret">
                      <input type="checkbox" aria-label={`${label(r, i)} is a secret`} checked={r.secret} onChange={(e) => set(i, { secret: e.target.checked, value: '' })} />
                      <span className="hint">secret</span>
                    </label>
                    {r.secret ? (
                      <select className="kv-input" aria-label={`Secret for ${label(r, i)}`} value={r.value} onChange={(e) => set(i, { value: e.target.value })}>
                        <option value="">choose a secret…</option>
                        {[...new Set([...keys, r.value].filter(Boolean))].map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input className="kv-input mono" aria-label={`Value for ${label(r, i)}`} value={r.value} spellCheck={false} onChange={(e) => set(i, { value: e.target.value })} />
                    )}
                    <button type="button" className="kv-x" aria-label={`Remove ${label(r, i)}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </Loading>
            <div className="row">
              <Button variant="ghost" size="sm" onClick={() => setRows((rs) => [...rs, { key: '', value: '', secret: false }])}>
                Add variable
              </Button>
            </div>
            <div className="row end">
              {p.name ? <ConfirmButton label="Delete environment" prompt={`Delete ${p.name}?`} confirmLabel="Yes, delete" disabled={busy} onConfirm={remove} /> : null}
              <span className="spacer" />
              <Button variant="primary" onClick={save} loading={busy} disabled={!name.trim() || loading || !!loadErr}>
                Save environment
              </Button>
            </div>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
