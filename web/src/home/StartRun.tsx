import { Check, ChevronDown } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { api, type RosterPreview } from '../api';
import { Button } from '../components/beui/kit/Button';
import { CopyButton } from '../components/beui/kit/CopyButton';
import { Loading } from '../components/Loading';
import { Face } from '../Face';
import { usePoll, type Poll, type Route } from '../hooks';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import { Kbd } from '../ui/studio/Kbd';
import { QuietLine } from '../ui/studio/Section';
import { useMenu } from '../ui/studio/useMenu';
import '../ui/studio/shell.css';
import { useRosterPreview } from './useRosterPreview';
import { INIT_COMMAND, pickWorkspace, WORKSPACES_MS, WORKSPACES_PATH, type WorkspaceRow } from './workspaces';

type Mode = 'live' | 'autonomous';
const MODE_LABEL: Record<Mode, string> = { live: 'Squad · live', autonomous: 'Squad · autonomous' };
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
 * The Home composer (the demo's): one growing "Ask the crew to…" field, suggestions while it is empty and focused, and a
 * chip row (project, run kind with a hand-off to the Builder for workflows, who picks the crew) with Start run. It starts
 * team runs. `workspaces` is Home's one shared /api/workspaces poll; without it (standalone use) StartRun polls on its own.
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
  const [focused, setFocused] = useState(false);
  const wsMenu = useMenu();
  const kindMenu = useMenu();
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
    <div className="start">
      <Loading loading={list === undefined && !workspaces.error} lines={3} label="Loading workspaces">
        {workspaces.error && !list ? (
          <InlineError message={workspaces.error} onRetry={() => void workspaces.refresh()} />
        ) : !list?.length ? (
          <div className="start-none">
            <QuietLine>
              No workspace yet. Run <code>{INIT_COMMAND}</code> in the project folder.
            </QuietLine>
            <CopyButton value={INIT_COMMAND} label="Copy command" onCopied={() => notify.ok('Command copied', INIT_COMMAND)} />
          </div>
        ) : (
          <>
            <div className="composer">
              {/* suggestions stay while focus is anywhere in the field, so Tab can reach them */}
              <div onFocus={() => setFocused(true)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocused(false)}>
                <textarea aria-label="Task" placeholder="Ask the crew to…" rows={1} value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={onKeyDown} />
                {focused && !task ? (
                  <div className="start-chips">
                    {EXAMPLES.map((x) => (
                      // mouse-down picks before the field blurs; click covers the keyboard
                      <button key={x} type="button" className="start-chip" onMouseDown={(e) => (e.preventDefault(), setTask(x))} onClick={() => setTask(x)}>
                        {x}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="composer-row">
                <span className="composer-anchor">
                  <button ref={wsMenu.triggerRef} type="button" className="composer-chip" aria-haspopup="menu" aria-expanded={wsMenu.open} onClick={wsMenu.toggle}>
                    {ws?.name ?? 'Workspace'}
                    <ChevronDown size={12} aria-hidden="true" />
                  </button>
                  {wsMenu.open ? (
                    <div ref={wsMenu.menuRef} className="sl-menu composer-menu" role="menu" aria-label="Workspace" onKeyDown={wsMenu.onMenuKey}>
                      {list.map((w) => (
                        <button key={w.id} type="button" role="menuitem" aria-current={w.id === ws?.id ? 'true' : undefined} onClick={() => (wsMenu.close(), setPicked(w.id))}>
                          <span>{w.name}</span>
                          <span className="composer-hint">{w.exists ? w.path : 'folder missing'}</span>
                          {w.id === ws?.id ? <Check size={14} aria-hidden="true" /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </span>
                <span className="composer-anchor">
                  <button ref={kindMenu.triggerRef} type="button" className="composer-chip" aria-haspopup="menu" aria-expanded={kindMenu.open} onClick={kindMenu.toggle}>
                    {MODE_LABEL[mode]}
                    <ChevronDown size={12} aria-hidden="true" />
                  </button>
                  {kindMenu.open ? (
                    <div ref={kindMenu.menuRef} className="sl-menu composer-menu" role="menu" aria-label="Run kind" onKeyDown={kindMenu.onMenuKey}>
                      {(['live', 'autonomous'] as const).map((m) => (
                        <button key={m} type="button" role="menuitem" aria-current={m === mode ? 'true' : undefined} onClick={() => (kindMenu.close(), setMode(m))}>
                          <span>{MODE_LABEL[m]}</span>
                          {m === mode ? <Check size={14} aria-hidden="true" /> : null}
                        </button>
                      ))}
                      <div className="sl-menu-rule" role="separator" />
                      <button type="button" role="menuitem" onClick={() => (kindMenu.close(), props.onGo({ tab: 'builder' }))}>
                        Workflow…
                      </button>
                    </div>
                  ) : null}
                </span>
                <span className="composer-label">Tether picks the crew</span>
                <span className="composer-spacer" />
                <Kbd mod>↵</Kbd>
                <Button variant="primary" size="sm" loading={busy} disabled={!ready} onClick={() => void start()}>
                  Start run
                </Button>
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
          </>
        )}
      </Loading>
    </div>
  );
}
