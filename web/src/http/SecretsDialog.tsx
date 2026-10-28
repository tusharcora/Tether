import './api.css';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import { Input } from '../components/beui/kit/fields';
import { Loading } from '../components/Loading';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { httpApi } from './client';

/**
 * Secret keys for this workspace. Values go in and never come back: the server only ever returns key names, inputs are
 * password fields that clear after saving, and nothing here fetches, shows or pre-fills a value. The secret inputs are
 * uncontrolled: a controlled input makes React mirror the value into the DOM `value` attribute, so the typed secret is
 * read from the element on submit and never kept in React state (only whether the field has text).
 */
export function SecretsDialog(p: { ws?: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const notify = useNotify();
  const [keys, setKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string>();
  const [key, setKey] = useState('');
  const valueRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const [hasValue, setHasValue] = useState(false);
  const [replacing, setReplacing] = useState<string>();
  const [hasNext, setHasNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const clear = (el: HTMLInputElement | null) => {
    if (el) el.value = '';
  };
  const stopReplacing = () => {
    clear(nextRef.current);
    setHasNext(false);
    setReplacing(undefined);
  };
  useEffect(() => {
    if (!p.open) {
      // The inputs unmount with the content; reset what said they had text so a reopened dialog starts empty.
      setHasValue(false);
      setHasNext(false);
      setReplacing(undefined);
      return;
    }
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
  const save = async (k: string, el: HTMLInputElement | null, done: () => void) => {
    const v = el?.value ?? '';
    if (!k || !v) return;
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
        <DialogContent className="api-dialog" title="Secrets" description="Stored on this machine (secrets.json, mode 600). Values are never shown again, never sent to the browser and never put in a prompt.">
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
                        <form className="row" onSubmit={(e) => (e.preventDefault(), void save(k, nextRef.current, stopReplacing))}>
                          <input ref={nextRef} className="kv-input mono" type="password" autoComplete="off" aria-label={`New value for ${k}`} onChange={(e) => setHasNext(!!e.target.value)} />
                          <Button type="submit" size="sm" variant="primary" disabled={!hasNext || busy}>
                            Save new value
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={stopReplacing}>
                            Cancel
                          </Button>
                        </form>
                      ) : (
                        <Button size="sm" variant="ghost" aria-label={`Replace ${k}`} onClick={() => (clear(nextRef.current), setHasNext(false), setReplacing(k))}>
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
            <form className="secret-add" onSubmit={(e) => (e.preventDefault(), void save(key.trim(), valueRef.current, () => (setKey(''), clear(valueRef.current), setHasValue(false))))}>
              <Input label="Key" placeholder="aorch_token" value={key} spellCheck={false} autoComplete="off" onChange={(e) => setKey(e.target.value)} />
              <Input ref={valueRef} label="Value" type="password" autoComplete="off" onChange={(e) => setHasValue(!!e.target.value)} />
              <Button type="submit" variant="primary" disabled={!key.trim() || !hasValue || busy}>
                Save secret
              </Button>
            </form>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
