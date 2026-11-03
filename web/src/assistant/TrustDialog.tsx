import { TRUST_BODY } from '../../../src/runLabels';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';

/** What a 409 `needsTrust` answer says about the folder. */
export interface TrustAsk {
  folder?: string;
  ownShell?: boolean;
  refused?: boolean;
}

/** "Trust this folder?": shared by the route card and Preview. A refused folder gets no Trust button, only where to change it. */
export function TrustDialog({ ask, onNotNow, onTrust, onClose }: { ask: TrustAsk | undefined; onNotNow: () => void; onTrust: () => void; onClose: () => void }) {
  return (
    <Dialog open={!!ask} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Trust this folder?">
        {ask?.ownShell ? <p className="m-0 mb-2 font-medium">This agent runs commands on its own, so it needs this folder trusted.</p> : null}
        <p className="m-0">{TRUST_BODY}</p>
        {ask?.folder ? <code className="mt-2 block truncate text-xs text-muted-foreground">{ask.folder}</code> : null}
        {ask?.refused ? <p className="m-0 mt-2">You said no to this folder before. Change it in Settings.</p> : null}
        <div className="row end mt-4">
          {ask?.ownShell ? null : (
            <Button variant="secondary" onClick={onNotNow}>
              Not now
            </Button>
          )}
          {ask?.refused ? null : (
            <Button variant="primary" onClick={onTrust}>
              Trust
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
