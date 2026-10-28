import { ExternalLink, FlaskConical, Filter, Link2, Pause, Play, Settings, Workflow, Zap } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api';
import { ActionNode } from '../components/bencho/ActionNode';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import { useNotify } from '../ui/notify';
import { DEFAULT_EVENTS, statusTip, who, type Trigger, type Workspace } from './types';
import './triggers.css';

/** What the Filter node says: the labels, drafts and forks the trigger cares about, or "All events" when it has none. */
export const filterLine = (t: Trigger): string => [t.labels?.length ? `Labels: ${t.labels.join(', ')}` : '', t.drafts ? 'drafts' : '', t.forks ? 'forks' : ''].filter(Boolean).join(' · ') || 'All events';

/** The selected trigger as Event → Filter → Workflow, three compact action nodes. */
export function TriggerFlow(p: { t: Trigger; workspace?: Workspace; onTestFire: () => void; onToggle: () => void; onSettings: () => void; onOpenWorkflow: () => void; onStarted: (id: string) => void }) {
  const notify = useNotify();
  const [confirm, setConfirm] = useState(false);
  const t = p.t;
  const paused = t.enabled === false;
  const url = `${location.origin}/api/webhooks/github`;
  const runNow = async () => {
    try {
      const { id } = await api<{ id: string }>('POST', '/api/runs', { pipeline: t.workflow, task: `Run ${t.workflow} by hand from trigger ${t.id}`, repo: p.workspace?.path });
      setConfirm(false);
      p.onStarted(id);
    } catch (e) {
      notify.fail(e);
    }
  };
  const link = <span className="tf-link" aria-hidden="true" />;
  return (
    <section className="tf" aria-label={`${t.id} flow`}>
      <ol className="tf-flow">
        <li>
          <ActionNode
            compact
            tabbable
            label="Event actions"
            mark={<Zap aria-hidden="true" />}
            title="Pull request event"
            line={(t.events ?? DEFAULT_EVENTS).join(', ')}
            tone={t.status === 'error' ? 'failed' : t.status === 'active' ? 'done' : 'idle'}
            toneLabel={statusTip[t.status]}
            actions={[
              { id: 'test', label: 'Test fire', icon: <FlaskConical />, onSelect: p.onTestFire },
              { id: 'pause', label: paused ? 'Resume trigger' : 'Pause trigger', icon: paused ? <Play /> : <Pause />, onSelect: p.onToggle },
              { id: 'copy', label: 'Copy URL', icon: <Link2 />, onSelect: () => void navigator.clipboard?.writeText(url).then(() => notify.ok('Webhook URL copied'), notify.fail) },
              { id: 'settings', label: 'Settings', icon: <Settings />, onSelect: p.onSettings },
            ]}
          />
        </li>
        <li>
          {link}
          <ActionNode compact label="Filter" mark={<Filter aria-hidden="true" />} title="Filter" line={filterLine(t)} tone="idle" toneLabel="Filter" actions={[]} />
        </li>
        <li>
          {link}
          <ActionNode
            compact
            tabbable
            label="Workflow actions"
            mark={<Workflow aria-hidden="true" />}
            title={t.workflow}
            line={`${t.repo} · ${who(t)}`}
            tone={paused ? 'idle' : 'done'}
            toneLabel={paused ? 'Paused' : 'Starts runs'}
            actions={[
              { id: 'open', label: 'Open workflow', icon: <ExternalLink />, onSelect: p.onOpenWorkflow },
              { id: 'run', label: 'Run now', icon: <Play />, onSelect: () => setConfirm(true), disabled: !p.workspace },
              { id: 'settings', label: 'Settings', icon: <Settings />, onSelect: p.onSettings },
            ]}
          />
        </li>
      </ol>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        {confirm ? (
          <DialogContent title={`Run ${t.workflow} now?`} description={`This starts a real run in ${p.workspace?.name ?? 'the workspace'} with your agents.`}>
            <div className="row end">
              <Button variant="secondary" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void runNow()}>
                Run now
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </section>
  );
}
