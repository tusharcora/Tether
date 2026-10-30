import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError, type RunView } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import type { RunAct } from '../Runs';
import { useMenu } from '../ui/studio/useMenu';
import type { StoryRow } from './storyModel';

export interface StepAction {
  label: string;
  hint?: string;
  onPick: () => void;
}

/** What a finished step's ⋯ offers (board 6): rewind to before it, fork from after it, open its changes. */
export function stepActions(r: RunView, row: StoryRow, o: { rewind: () => void; fork: () => void; changes: () => void }): StepAction[] {
  const n = row.node ? r.pipeline.nodes.find((x) => x.id === row.node) : undefined;
  if (!n || r.probe || n.manager || (row.state !== 'done' && row.state !== 'failed')) return [];
  const out: StepAction[] = [];
  if (!r.ship?.url) out.push({ label: 'Rewind to before this step', hint: 'undo its code and everything after', onPick: o.rewind });
  // a fork starts from a step that is done, among the steps the run began with
  if (row.state === 'done' && r.kind !== 'team' && !n.spawn) out.push({ label: 'Fork from after this step', hint: 'a new run starting from here', onPick: o.fork });
  if (n.kind === 'agent' && r.nodes[n.id]?.commit) out.push({ label: 'Open its changes', onPick: o.changes });
  return out;
}

/** The ⋯ beside a story row: a keyboard menu (arrows, Home, End, Escape) of the step's actions, each with a muted hint. */
export function StepMenu({ label, items }: { label: string; items: StepAction[] }) {
  const menu = useMenu();
  if (!items.length) return null;
  return (
    <span className="rp-st-more">
      <button ref={menu.triggerRef} type="button" className="rp-st-dots" aria-label={`Step actions for ${label}`} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
        <Ellipsis size={15} aria-hidden="true" />
      </button>
      {menu.open ? (
        <div ref={menu.menuRef} className="sl-menu rp-st-menu" role="menu" aria-label="Step actions" onKeyDown={menu.onMenuKey}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" onClick={() => (menu.close(), it.onPick())}>
              <span className="rp-mi">
                {it.label}
                {it.hint ? <small>{it.hint}</small> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * "Undo <step> and everything after?": the rewind's confirm (a focus-trapped dialog). A live run is stopped first (Stop &
 * rewind); the rewind is then tried until the run has let go of its worktree.
 */
export function RewindDialog({ run: r, node, name, onAct, onClose }: { run: RunView; node: string; name: string; onAct: RunAct; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const live = r.live && (r.status === 'running' || r.status === 'paused');
  const go = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (live && !(await onAct('stop'))) return;
      // a stopped run lets go of its worktree a moment later
      for (let i = 0; ; i++) {
        try {
          await api('POST', `/api/runs/${encodeURIComponent(r.id)}/rewind`, { node });
          break;
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 409 && /still going/.test(e.message)) || i >= 20) throw e;
          await pause(300);
        }
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title={`Undo “${name}” and everything after?`} description="You can undo the rewind until the run moves on.">
        <p className="rp-dialog-note">The code goes back to how it was before this step. The steps after it run again when you resume; what they cost stays spent.</p>
        {error ? (
          <p className="sl-alert" role="alert">
            {error}
          </p>
        ) : null}
        <div className="row end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void go()}>
            {live ? 'Stop & rewind' : 'Rewind'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** After a rewind, until the run moves on: where it went back to, Undo, Resume. */
export function RewindBanner({ run: r, name, onAct }: { run: RunView; name: (node: string) => string; onAct: RunAct }) {
  if (!r.rewind || r.live) return null;
  return (
    <div className="rp-rewound" role="status">
      <span className="rp-rewound-t">
        <b>{`Rewound to before “${name(r.rewind.node)}”`}</b>
        <span>The newer code is kept aside until the run moves on, so you can still undo.</span>
      </span>
      <Button variant="secondary" size="sm" onClick={() => void onAct('rewind/undo')}>
        Undo
      </Button>
      <Button variant="primary" size="sm" onClick={() => void onAct('resume')}>
        Resume
      </Button>
    </div>
  );
}
