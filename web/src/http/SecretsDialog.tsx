import './api.css';
import { useEffect, useState } from 'react';
import { Button } from '../components/arc/button/button';
import { Dialog, DialogContent } from '../components/arc/dialog/dialog';
import { Input } from '../components/arc/input/input';
import { Loading } from '../components/Loading';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { httpApi } from './client';

/**
 * Secret keys for this workspace. Values go in and never come back: the server only ever returns key names, inputs are
 * password fields that clear after saving, and nothing here fetches, shows or pre-fills a value.
 */
export function SecretsDialog(p: { ws?: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const notify = useNotify();
  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string>();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [replacing, setReplacing] = useState<string>();
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!p.open) return;
    let live = true;
    setLoading(true);
    setLoadErr(undefined);
    httpApi.secrets(p.ws).then(
      (r) => live && (setKeys(r.keys), setLoading(false)),
      (e: unknown) => live && (setLoadErr(e instanceof Error ? e.message : String(e)), setLoading(false)),
    );
    return () => {
      live = false;
    };
  }, [p.open, p.ws]);
  const save = async (k: string, v: string, done: () => void) => {
    setBusy(true);
    try {
      setKeys((await httpApi.setSecret(p.ws, k, v)).keys);
      done();
      notify.ok(`Saved ${k}`);
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (k: string) => {
    try {
      setKeys((await httpApi.deleteSecret(p.ws, k)).keys);
      notify.ok(`Deleted ${k}`);
    } catch (e) {
      notify.fail(e);
    }
  };
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      {p.open ? (
        <DialogContent className="studio api-dialog" title="Secrets" description="Stored on this machine (secrets.json, mode 600). Values are never shown again, never sent to the browser and never put in a prompt.">
          <div className="dialog-body">
            {loadErr ? (
              <p className="resp-error" role="alert">
                {loadErr}
              </p>
            ) : (
              <Loading loading={loading} lines={3} label="Loading secret keys">
                <ul className="secret-list" aria-label="Secret keys">
                  {keys.map((k) => (
                    <li key={k}>
                      <span className="mono">{k}</span>
                      <span className="spacer" />
                      {replacing === k ? (
                        <form className="row" onSubmit={(e) => (e.preventDefault(), void save(k, next, () => (setNext(''), setReplacing(undefined))))}>
                          <input className="kv-input mono" type="password" autoComplete="off" aria-label={`New value for ${k}`} value={next} onChange={(e) => setNext(e.target.value)} />
                          <Button type="submit" size="sm" variant="primary" disabled={!next || busy}>
                            Save new value
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => (setNext(''), setReplacing(undefined))}>
                            Cancel
                          </Button>
                        </form>
                      ) : (
                        <Button size="sm" variant="ghost" aria-label={`Replace ${k}`} onClick={() => (setReplacing(k), setNext(''))}>
                          Replace
                        </Button>
                      )}
                      <ConfirmButton label="Delete" prompt={`Delete ${k}?`} confirmLabel="Yes, delete" onConfirm={() => remove(k)} />
                    </li>
                  ))}
                  {!keys.length ? <li className="hint">No secrets yet.</li> : null}
                </ul>
              </Loading>
            )}
            <form className="secret-add" onSubmit={(e) => (e.preventDefault(), void save(key.trim(), value, () => (setKey(''), setValue(''))))}>
              <Input label="Key" placeholder="aorch_token" value={key} spellCheck={false} autoComplete="off" onChange={(e) => setKey(e.target.value)} />
              <Input label="Value" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
              <Button type="submit" variant="primary" disabled={!key.trim() || !value || busy}>
                Save secret
              </Button>
            </form>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
