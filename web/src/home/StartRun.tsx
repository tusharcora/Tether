import { useState, type KeyboardEvent } from 'react';
import { api, type RosterPreview } from '../api';
import { Button } from '../components/arc/button/button';
import { CopyButton } from '../components/arc/copy-button/copy-button';
import SegmentedControl from '../components/arc/segmented-control/segmented-control';
import { Select } from '../components/arc/select/select';
import { Textarea } from '../components/arc/textarea/textarea';
import { Loading } from '../components/Loading';
import { Face } from '../Face';
import { usePoll, type Poll, type Route } from '../hooks';
import { EmptyState } from '../ui/studio/EmptyState';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import { Kbd } from '../ui/studio/Kbd';
import { Panel } from '../ui/studio/Panel';
import { useRosterPreview } from './useRosterPreview';
import { INIT_COMMAND, pickWorkspace, WORKSPACES_MS, WORKSPACES_PATH, type WorkspaceRow } from './workspaces';

type Mode = 'live' | 'autonomous';
const EXAMPLES = ['Add rate limiting to the public API', 'Fix the flaky login test', 'Write a README section for the CLI'];

function PreviewRow({ preview }: { preview: RosterPreview }) {
  const core = `${preview.core.slice(0, 3).join(', ')}${preview.core.length > 3 ? '…' : ''}`;
  return (
    <div className="start-preview" aria-label="Tether would pick">
      <span className="sl-meta">Tether would pick · a guess</span>
      {preview.bots.length ? (
        <>
          <ul className="sl-list start-picks">
            {preview.bots.map((b) => (
              <li key={b.id}>
                <Face id={b.id} size={20} label={b.name} />
                <b>{b.name}</b>
                <span className="start-why">{b.why}</span>
              </li>
            ))}
          </ul>
          <span className="sl-meta">core crew ({core}) always available</span>
        </>
      ) : (
        <span>Tether will use the core crew</span>
      )}
    </div>
  );
}

/**
 * Start a team run from Home (workflow runs start from the Builder's run dialog).
 * `workspaces` is Home's one shared /api/workspaces poll; without it (standalone use) StartRun polls on its own.
 */
export function StartRun(props: { onGo: (r: Route) => void; onStarted: (id: string) => void; workspaces?: Poll<WorkspaceRow[]> }) {
  const own = usePoll<WorkspaceRow[]>(props.workspaces ? null : WORKSPACES_PATH, WORKSPACES_MS);
  const workspaces = props.workspaces ?? own;
  const notify = useNotify();
  const [picked, setPicked] = useState<string>();
  const ws = pickWorkspace(workspaces.data ?? [], picked);
  const [task, setTask] = useState('');
  const [mode, setMode] = useState<Mode>('live');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const preview = useRosterPreview(task, ws?.id);
  const ready = !!task.trim() && !!ws?.exists && !busy;

  async function start() {
    if (!ready || !ws) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ id: string }>('POST', '/api/runs', { kind: 'team', mode, task: task.trim(), repo: ws.path });
      setTask('');
      props.onStarted(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    void start();
  };

  const list = workspaces.data;
  return (
    <Panel title="Start a run" className="s-start">
      <Loading loading={list === undefined && !workspaces.error} lines={5} label="Loading workspaces">
        {workspaces.error && !list ? (
          <InlineError message={workspaces.error} onRetry={() => void workspaces.refresh()} />
        ) : !list?.length ? (
          <EmptyState
            title="No workspace yet"
            description={`Register the project the team should work on: run ${INIT_COMMAND} in its folder.`}
            action={<CopyButton value={INIT_COMMAND} label="Copy command" onCopied={() => notify.ok('Command copied', INIT_COMMAND)} />}
          />
        ) : (
          <div className="start-form">
            <Textarea label="Task" rows={3} value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={onKeyDown} placeholder="What should the team do?" />
            <div className="start-chips">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" className="start-chip" onClick={() => setTask(x)}>
                  {x}
                </button>
              ))}
            </div>
            <div className="start-row">
              <Select label="Workspace" value={ws?.id} onValueChange={setPicked} options={list.map((w) => ({ value: w.id, label: w.exists ? w.name : `${w.name} (folder missing)` }))} />
              <div className="start-mode">
                <SegmentedControl label="Run as" options={[{ value: 'live', label: 'Team · live' }, { value: 'autonomous', label: 'Team · autonomous' }]} value={mode} onValueChange={(v) => setMode(v as Mode)} />
                <button type="button" className="link" onClick={() => props.onGo({ tab: 'builder' })}>
                  Workflow…
                </button>
              </div>
            </div>
            {preview ? <PreviewRow preview={preview} /> : null}
            {ws && !ws.exists ? (
              <p className="sl-note" role="note">
                The folder for {ws.name} is missing: {ws.path}
              </p>
            ) : null}
            {error ? (
              <p className="sl-alert" role="alert">
                {error}
              </p>
            ) : null}
            <div className="start-go">
              <Kbd mod>↵</Kbd>
              <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void start()}>
                Start
              </Button>
            </div>
          </div>
        )}
      </Loading>
    </Panel>
  );
}
