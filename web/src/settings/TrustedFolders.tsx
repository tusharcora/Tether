import { useState } from 'react';
import { api } from '../api';
import { Button } from '../components/beui/kit/Button';
import type { Poll } from '../hooks';
import { useNotify } from '../ui/notify';

export interface TrustView {
  folders: { folder: string; trusted: boolean; exists: boolean }[];
}
export const TRUST_PATH = '/api/trust';

/** Every folder Tether asked about: withdrawing a yes, or forgetting a no, means it asks again next time. */
export function TrustedFolders({ poll }: { poll: Poll<TrustView> }) {
  const notify = useNotify();
  const [busy, setBusy] = useState<string>();
  const forget = (folder: string) => {
    setBusy(folder);
    void api('DELETE', TRUST_PATH, { folder })
      .then(poll.refresh, notify.fail)
      .finally(() => setBusy(undefined));
  };
  const folders = poll.data?.folders ?? [];
  return (
    <>
      {poll.data && !folders.length ? <p className="st-help">No folders yet. Tether asks the first time agents need to work in one.</p> : null}
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
      <p className="st-help">Trust covers the folder and every agent working in it. Some things always stop and ask first.</p>
    </>
  );
}
