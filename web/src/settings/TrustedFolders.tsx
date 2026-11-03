import { useState } from 'react';
import { TRUST_BODY } from '../../../src/runLabels';
import { api } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import type { Poll } from '../hooks';
import { useNotify } from '../ui/notify';

export interface TrustView {
  folders: { folder: string; trusted: boolean; exists: boolean }[];
  /** Projects Tether hasn't asked about yet. */
  unanswered?: { folder: string; name: string }[];
}
export const TRUST_PATH = '/api/trust';

/** Every folder Tether asked about: withdrawing a yes, or forgetting a no, means it asks again next time. Projects not asked about yet can be trusted here. */
export function TrustedFolders({ poll }: { poll: Poll<TrustView> }) {
  const notify = useNotify();
  const [busy, setBusy] = useState<string>();
  const [ask, setAsk] = useState<string>();
  const forget = (folder: string) => {
    setBusy(folder);
    void api('DELETE', TRUST_PATH, { folder })
      .then(poll.refresh, notify.fail)
      .finally(() => setBusy(undefined));
  };
  const trust = (folder: string) => {
    setAsk(undefined);
    setBusy(folder);
    void api('PUT', TRUST_PATH, { folder, trusted: true })
      .then(poll.refresh, notify.fail)
      .finally(() => setBusy(undefined));
  };
  const folders = poll.data?.folders ?? [];
  const unanswered = poll.data?.unanswered ?? [];
  return (
    <>
      {poll.data && !folders.length && !unanswered.length ? <p className="st-help">No folders yet. Tether asks the first time agents need to work in one.</p> : null}
      {folders.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {folders.map((f) => (
            <li key={f.folder} className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <code className="block truncate" title={f.folder}>
                  {f.folder}
                </code>
                <span className="sl-meta">{!f.exists ? 'Folder not found' : f.trusted ? 'Agents can run commands here' : 'Agents can’t run commands here'}</span>
              </span>
              <Button size="sm" variant="secondary" loading={busy === f.folder} onClick={() => forget(f.folder)}>
                {f.trusted ? 'Withdraw' : 'Ask again'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {unanswered.length ? (
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
          {unanswered.map((f) => (
            <li key={f.folder} className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <code className="block truncate" title={f.folder}>
                  {f.folder}
                </code>
                <span className="sl-meta">Not asked yet</span>
              </span>
              <Button size="sm" variant="secondary" loading={busy === f.folder} onClick={() => setAsk(f.folder)}>
                Trust
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(undefined)}>
        <DialogContent title="Trust this folder?">
          <p className="m-0">{TRUST_BODY}</p>
          {ask ? <code className="mt-2 block truncate text-xs text-muted-foreground">{ask}</code> : null}
          <div className="row end mt-4">
            <Button variant="secondary" onClick={() => setAsk(undefined)}>
              Not now
            </Button>
            <Button variant="primary" onClick={() => ask && trust(ask)}>
              Trust this folder
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <p className="st-help">Trust covers the folder and every agent working in it. Some things always stop and ask first.</p>
    </>
  );
}
