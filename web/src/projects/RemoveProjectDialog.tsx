import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import type { WorkspaceRow } from '../home/workspaces';

/** Asks before Tether forgets a project: its folder stays, but the API client's secrets for it are deleted. */
export function RemoveProjectDialog(p: { project: WorkspaceRow | undefined; onCancel: () => void; onRemove: (w: WorkspaceRow) => void }) {
  const w = p.project;
  return (
    <Dialog open={!!w} onOpenChange={(o) => !o && p.onCancel()}>
      {w ? (
        <DialogContent title={`Remove ${w.name} from Tether?`} description={`The folder ${w.path} and its files stay where they are. Tether stops listing it and deletes the API client's secrets saved for it.`}>
          <div className="row end">
            <Button variant="secondary" onClick={p.onCancel}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => p.onRemove(w)}>
              Remove
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
