import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, fmtDur, type ExecEntry, type ProcMessage, type RunView } from '../api';
import { Button } from '../components/beui/kit/Button';

export type ProcSubscribe = (fn: (m: ProcMessage) => void) => () => void;

/** "exit 0 · 3.1s", "stopped · 12.0s", with where a long output was saved. */
export function exitLine(e: Pick<ExecEntry, 'code' | 'signal' | 'durationMs' | 'spill'>): string {
  const how = e.signal ? 'stopped' : e.code === null || e.code === undefined ? 'could not run' : `exit ${e.code}`;
  return [how, e.durationMs !== undefined ? fmtDur(e.durationMs) : '', e.spill ? `full output in ${e.spill}` : ''].filter(Boolean).join(' · ');
}

/** Fold a stream message into the command list (a start adds one, output appends, an end closes it). */
export function applyProc(list: ExecEntry[], m: ProcMessage): ExecEntry[] {
  if (m.type === 'exec.start') return list.some((e) => e.id === m.id) ? list : [...list, { id: m.id, command: m.command, at: m.at, output: '', running: true }].slice(-50);
  return list.map((e) => (e.id !== m.id ? e : m.type === 'exec.output' ? { ...e, output: e.output + m.text } : { ...e, running: false, code: m.code, durationMs: m.durationMs, ...(m.signal ? { signal: m.signal } : {}), ...(m.spill ? { spill: m.spill } : {}) }));
}

/**
 * The Terminal tab (board 6): a command console in the run's worktree, not an interactive shell. The output keeps to the
 * bottom unless you scrolled up; ↑/↓ walk your earlier commands; Stop (or Ctrl+C in the field) ends the running one. Only
 * the exit lines are announced to screen readers.
 */
export function Terminal({ run: r, onProc }: { run: RunView; onProc?: ProcSubscribe }) {
  const [list, setList] = useState<ExecEntry[]>([]);
  const [error, setError] = useState<string>();
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  /** Where ↑/↓ is in the history (list length = the new line). */
  const [at, setAt] = useState<number>();
  const out = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const base = `/api/runs/${encodeURIComponent(r.id)}/exec`;

  useEffect(() => {
    let live = true;
    // subscribe first, so nothing between the read and the subscription is lost (a start already listed is ignored)
    const off = onProc?.((m) => setList((cur) => applyProc(cur, m)));
    api<{ commands: ExecEntry[] }>('GET', base).then(
      (h) => live && setList((cur) => [...h.commands.filter((e) => !cur.some((c) => c.id === e.id)), ...cur]),
      (e: unknown) => live && setError((e as Error).message),
    );
    return () => void ((live = false), off?.());
  }, [base, onProc]);

  useLayoutEffect(() => {
    const el = out.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [list]);

  const running = list.find((e) => e.running);
  const last = [...list].reverse().find((e) => !e.running && e.durationMs !== undefined);
  const commands = list.map((e) => e.command);
  const stop = () => void api('POST', `${base}/stop`).catch((e: unknown) => setError((e as Error).message));
  const run = async () => {
    const c = cmd.trim();
    if (!c || running || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const e = await api<ExecEntry>('POST', base, { command: c });
      setList((cur) => (cur.some((x) => x.id === e.id) ? cur : [...cur, e]));
      setCmd('');
      setAt(undefined);
      stick.current = true;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'c' && e.ctrlKey && running) return void (e.preventDefault(), stop());
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (!commands.length) return;
    e.preventDefault();
    const cur = at ?? commands.length;
    const next = Math.max(0, Math.min(commands.length, cur + (e.key === 'ArrowUp' ? -1 : 1)));
    setAt(next);
    setCmd(next === commands.length ? '' : commands[next]!);
  };

  return (
    <div className="rt">
      <div
        ref={out}
        className="rt-out"
        tabIndex={0}
        aria-label="Command output"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
        }}
      >
        {list.length ? null : <p className="rt-empty">Run a command in this run’s worktree: its tests, a build, git log. It is not an interactive shell.</p>}
        {list.map((e) => (
          <div key={e.id} className="rt-cmd">
            <span className="rt-ps">{`$ ${e.command}`}</span>
            {e.output ? <pre className="rt-text">{e.output}</pre> : null}
            {e.running ? <span className="rt-exit">running…</span> : <span className={e.code === 0 ? 'rt-exit' : 'rt-exit bad'}>{exitLine(e)}</span>}
          </div>
        ))}
      </div>
      {/* the exit lines only: every chunk would flood a screen reader */}
      <div className="rt-live" aria-live="polite">
        {last ? `${last.command}: ${exitLine(last)}` : ''}
      </div>
      {error ? (
        <p className="sl-alert compact" role="alert">
          {error}
        </p>
      ) : null}
      <form
        className="rt-form"
        aria-label="Run a command"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <span className="rt-dollar" aria-hidden="true">
          $
        </span>
        <input aria-label="Command" placeholder="Run a command in this run’s worktree" value={cmd} maxLength={2000} spellCheck={false} autoComplete="off" onChange={(e) => (setCmd(e.target.value), setAt(undefined))} onKeyDown={onKey} />
        {running ? (
          <Button type="button" size="sm" variant="secondary" onClick={stop}>
            Stop
          </Button>
        ) : (
          <span className="rt-hint">↑ history · Ctrl+C stops</span>
        )}
      </form>
    </div>
  );
}
