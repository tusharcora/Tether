import './api.css';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '../components/arc/button/button';
import SegmentedControl from '../components/arc/segmented-control/segmented-control';
import { Textarea } from '../components/arc/textarea/textarea';
import { useCrew } from '../crewStore';
import { Face } from '../Face';
import { useNotify } from '../ui/notify';
import { httpApi, type SendOutput } from './client';
import { fmtBytes } from './ResponseView';

/** Crew entries that cannot take a hand-off as a worker (the server refuses them too). */
const NOT_WORKERS = new Set(['orchestrator', 'approval', 'tester', 'manager']);
const MODES = [
  { value: 'solo', label: 'Solo' },
  { value: 'team', label: 'Team' },
];
type Target = { kind: 'run'; bot: string; mode: 'solo' | 'team' } | { kind: 'tether' };

export interface SendToAgentProps {
  ws?: string;
  /** The last send's output; without it nothing can be handed over yet. */
  output?: SendOutput;
  /** The saved request's id, for "Use as gate in a workflow". */
  requestId?: string;
  env?: string | null;
  onStarted: (runId: string) => void;
  onUseAsGate: (g: { run: string; env?: string }) => void;
}

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/** Hand the last response to a bot (a run), to Tether (a team run), or turn the request into a workflow gate. */
export function SendToAgent(p: SendToAgentProps) {
  const notify = useNotify();
  const { crew } = useCrew();
  const bots = Object.entries(crew).filter(([id]) => !NOT_WORKERS.has(id));
  const [bot, setBot] = useState(() => (crew.coder ? 'coder' : (bots[0]?.[0] ?? 'coder')));
  const [mode, setMode] = useState<'solo' | 'team'>('solo');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<Target['kind'] | null>(null);
  const o = p.output;
  const name = crew[bot]?.name ?? bot;

  const go = async (target: Target) => {
    if (!o || busy) return;
    setBusy(target.kind);
    try {
      const r = await httpApi.sendToAgent(p.ws, { historyId: o.historyId, target, note });
      notify.ok('Run started', r.runId);
      p.onStarted(r.runId);
    } catch (e) {
      notify.fail(e);
    } finally {
      setBusy(null);
    }
  };
  // ⌘↵ in the note hands the exchange over; it must not reach the editor's window-wide ⌘↵ (which re-sends the request)
  const onNoteKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    e.stopPropagation();
    void go({ kind: 'run', bot, mode });
  };

  return (
    <aside className="send-agent" aria-label="Send to agent">
      <h3>Send to agent</h3>
      <div className="bot-grid" role="group" aria-label="Bot">
        {bots.map(([id, c]) => (
          <button key={id} type="button" className="bot-pick" aria-pressed={bot === id} aria-label={`${c.name}, ${c.title}`} onClick={() => setBot(id)}>
            <Face id={id} size={32} />
            <span>{c.name}</span>
          </button>
        ))}
      </div>
      <SegmentedControl label="Run as" options={MODES} value={mode} onValueChange={(v) => setMode(v === 'team' ? 'team' : 'solo')} />
      <Textarea label="Note for the agent" rows={4} placeholder="What should it look at?" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={onNoteKey} />
      {o ? (
        <div className="attach" aria-label="Attached">
          <span className="attach-chip mono">{`${o.request.method} ${pathOf(o.request.url)}`}</span>
          <span className="attach-chip mono">{o.result.error ? o.result.error.kind : `${o.result.status} · ${fmtBytes(o.result.size)}`}</span>
          <span className="attach-chip mono">{`${o.result.ms} ms`}</span>
        </div>
      ) : (
        <p className="hint">Send the request first: the response goes with it.</p>
      )}
      <Button variant="primary" disabled={!o} loading={busy === 'run'} onClick={() => void go({ kind: 'run', bot, mode })}>
        {`Start run with ${name}`}
      </Button>
      <Button variant="secondary" disabled={!o} loading={busy === 'tether'} onClick={() => void go({ kind: 'tether' })}>
        Ask Tether
      </Button>
      <Button variant="ghost" disabled={!p.requestId} onClick={() => p.requestId && p.onUseAsGate({ run: p.requestId, ...(p.env ? { env: p.env } : {}) })}>
        Use as gate in a workflow
      </Button>
    </aside>
  );
}
