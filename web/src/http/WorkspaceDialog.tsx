import './api.css';
import { useState } from 'react';
import type { BundlePlan } from '../../../src/wsexport';
import { api } from '../api';
import { Button } from '../components/arc/button/button';
import { Dialog, DialogContent } from '../components/arc/dialog/dialog';
import { Input } from '../components/arc/input/input';
import { Loading } from '../components/Loading';
import { useNotify } from '../ui/notify';

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Import a workspace export (<name>.aorch.json) into a folder on this machine. Shows what is created or overwritten first. */
export function WorkspaceDialog(p: { open: boolean; onOpenChange: (o: boolean) => void; onImported: (workspaceId: string) => void }) {
  const notify = useNotify();
  const [bundle, setBundle] = useState<unknown>();
  const [into, setInto] = useState('');
  const [plan, setPlan] = useState<BundlePlan>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const body = () => ({ bundle, into: into.trim() });
  const preview = async () => {
    setError(undefined);
    setBusy(true);
    try {
      setPlan(await api<BundlePlan>('POST', '/api/workspaces/import', body()));
    } catch (e) {
      setPlan(undefined);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api<{ workspace: string; written: string[] }>('POST', '/api/workspaces/import', { ...body(), confirm: true });
      notify.ok(`Imported workspace ${r.workspace}`, plural(r.written.length, 'file'));
      setPlan(undefined);
      p.onImported(r.workspace);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setPlan(undefined);
    setBundle(undefined);
    try {
      setBundle(JSON.parse(await f.text()));
      setError(undefined);
    } catch {
      setError('that file is not JSON');
    }
  };
  const nFiles = plan?.overwrite.length ?? 0;
  const nSecrets = plan?.overwriteSecrets.length ?? 0;
  // a secret the target workspace already holds is replaced too: it counts as an overwrite (key names only, never values)
  const n = nFiles + nSecrets;
  const replaced = [nFiles && plural(nFiles, 'file'), nSecrets && plural(nSecrets, 'secret')].filter(Boolean).join(' and ');
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      {p.open ? (
        <DialogContent className="api-dialog" title="Import a workspace" description="From an export made with Export or aorch workspace export. Nothing is written until you confirm.">
          <div className="dialog-body">
            <label className="file-pick">
              <span className="hint">Export file</span>
              <input type="file" accept=".json" aria-label="Export file" onChange={(e) => void pickFile(e.target.files?.[0])} />
            </label>
            <Input label="Into folder (absolute path)" placeholder="/home/you/code/project" value={into} spellCheck={false} onChange={(e) => (setInto(e.target.value), setPlan(undefined))} />
            {error ? (
              <p className="resp-error" role="alert">
                {error}
              </p>
            ) : null}
            {busy && !plan ? <Loading loading lines={3} label="Reading the export" /> : null}
            {plan ? (
              <div className="import-preview">
                {plan.create.length ? (
                  <>
                    <h4>Will create</h4>
                    <ul>
                      {plan.create.map((f) => (
                        <li key={f} className="mono">
                          {f}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {n ? (
                  <>
                    <h4>Will overwrite</h4>
                    <ul>
                      {plan.overwrite.map((f) => (
                        <li key={f} className="mono">
                          {f}
                        </li>
                      ))}
                      {plan.overwriteSecrets.map((k) => (
                        <li key={`secret:${k}`} className="mono">
                          {`secret ${k}`}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {plan.secrets.length ? <p className="hint warn">{`${plural(plan.secrets.length, 'secret')}: ${plan.secrets.join(', ')} (stored for the imported workspace)`}</p> : null}
              </div>
            ) : null}
            <div className="row end">
              <Button variant="secondary" onClick={preview} loading={busy && !plan} disabled={!bundle || !into.trim() || busy}>
                Preview
              </Button>
              {plan ? (
                <Button variant={n ? 'danger' : 'primary'} onClick={apply} loading={busy}>
                  {n ? `Import and overwrite ${replaced}` : 'Import'}
                </Button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
