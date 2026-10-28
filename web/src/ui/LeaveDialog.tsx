import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';

/** Asks before unsaved work is dropped (leaving a screen, switching project, closing a file). Open while `text` is set. */
export function LeaveDialog(p: { text: string | undefined; onKeep: () => void; onDiscard: () => void }) {
  return (
    <Dialog open={!!p.text} onOpenChange={(o) => !o && p.onKeep()}>
      {p.text ? (
        <DialogContent className="api-dialog" title="Discard unsaved changes?" description={p.text}>
          <div className="row end">
            <Button variant="secondary" onClick={p.onKeep}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={p.onDiscard}>
              Discard
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
