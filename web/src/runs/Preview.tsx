import { ExternalLink, RotateCw, X } from 'lucide-react';
import { useState } from 'react';
import { api, type PreviewView, type RunView } from '../api';
import { Button } from '../components/beui/kit/Button';
import { usePoll } from '../hooks';
import { cn } from '../ui/cn';

/** GET /api/runs/:id/preview: the run's preview, if any, and the command it would start by default. */
export interface PreviewReply {
  preview: PreviewView | null;
  command: string | null;
}

const WORD: Record<PreviewView['status'], string> = { starting: 'starting in the worktree…', running: 'running in the worktree', exited: 'stopped by itself', stopped: 'stopped' };

/**
 * Preview (board 6): the project's dev server started in the run's worktree, shown in a sandboxed frame. Before it runs:
 * Start preview with the detected command (editable). Running: the URL (read only), Reload, Open in browser, Stop, and
 * the command's status line. Only loopback URLs are ever shown (the server reads them from its output).
 */
export function Preview({ run: r, onClose }: { run: RunView; /** The side pane's ×. */ onClose?: () => void }) {
  const path = `/api/runs/${encodeURIComponent(r.id)}/preview`;
  const poll = usePoll<PreviewReply>(path, 1500);
  const [cmd, setCmd] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  const p = poll.data?.preview;
  const on = p && (p.status === 'starting' || p.status === 'running');
  const command = cmd ?? p?.command ?? poll.data?.command ?? '';
  const call = async (method: 'POST' | 'DELETE', body?: unknown) => {
    setBusy(true);
    setError(undefined);
    try {
      await api(method, path, body);
      await poll.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rpv" aria-label="Preview">
      <div className="rpv-bar">
        <b>Preview</b>
        <span className="rpv-url mono" aria-label="Preview address">
          {p?.url ? p.url.replace(/^https?:\/\//, '') : on ? 'waiting for its address…' : 'not running'}
        </span>
        {on ? (
          <>
            <button type="button" className="rpv-icon" aria-label="Reload preview" title="Reload" disabled={!p?.url} onClick={() => setReload((n) => n + 1)}>
              <RotateCw size={14} aria-hidden="true" />
            </button>
            <button type="button" className="rpv-icon" aria-label="Open in browser" title="Open in browser" disabled={!p?.url} onClick={() => p?.url && window.open(p.url, '_blank', 'noopener')}>
              <ExternalLink size={14} aria-hidden="true" />
            </button>
          </>
        ) : null}
        {onClose ? (
          <button type="button" className="rpv-icon" aria-label="Close the preview pane" title="Close" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {p ? (
        <div className="rpv-status">
          <span className={cn('rpv-dot', p.status)} aria-hidden="true" />
          <span className="mono">{p.command}</span>
          <span>{p.status === 'exited' && p.code !== undefined && p.code !== null ? `exited with ${p.code}` : WORD[p.status]}</span>
          {on ? (
            <button type="button" className="rp-link" disabled={busy} onClick={() => void call('DELETE')}>
              Stop
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="sl-alert compact" role="alert">
          {error}
        </p>
      ) : null}
      {on && p?.url ? (
        <iframe key={reload} className="rpv-frame" title={`Preview of ${p.url}`} src={p.url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" referrerPolicy="no-referrer" />
      ) : on ? (
        <p className="rpv-wait">The dev server is starting. Its page shows here once it prints its address.</p>
      ) : (
        <form
          className="rpv-start"
          onSubmit={(e) => {
            e.preventDefault();
            void call('POST', command.trim() ? { command: command.trim() } : {});
          }}
        >
          <p>See the app as this run left it: Tether starts its dev server inside the run’s worktree.</p>
          <label className="rpv-field">
            <span>Command</span>
            <input className="mono" value={command} placeholder="npm run dev" maxLength={2000} spellCheck={false} onChange={(e) => setCmd(e.target.value)} />
          </label>
          {p?.status === 'exited' && p.output ? <pre className="rp-out">{p.output.slice(-2000)}</pre> : null}
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!command.trim()}>
            Start preview
          </Button>
        </form>
      )}
    </section>
  );
}
