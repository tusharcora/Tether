import type { WorkspaceRow } from '../home/workspaces';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import { PathForm } from './PathForm';

/** The sidebar's + and ⌘O in a browser: type a folder path to open it as a project. */
export function OpenFolderDialog(p: { open: boolean; onOpenChange: (o: boolean) => void; onAdd: (path: string) => Promise<WorkspaceRow> }) {
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      {p.open ? (
        <DialogContent title="Open a folder" description="Type the folder's full path. Tether adds it to your projects; nothing is written into it.">
          <PathForm autoFocus onOpen={async (path) => (await p.onAdd(path), p.onOpenChange(false))} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
