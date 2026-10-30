import { useEffect, useState } from 'react';
import { api, type AgentPick, type RunView } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';

/** GET /api/runs/:id/attempts: four default picks (none where the owner has nothing else), every choice, the original's agent. */
export interface PicksReply {
  picks: (AgentPick | null)[];
  choices: AgentPick[];
  original: AgentPick;
}

const key = (a: AgentPick) => `${a.agent}|${a.model ?? ''}`;
export const pickLabel = (a: AgentPick) => `${a.agent}${a.model ? ` · ${a.model}` : ''}${a.agent === 'openrouter' || a.agent === 'nvidia' || a.model?.endsWith(':free') ? ' · free' : ''}`;

/**
 * Try more ways: how many more attempts (1–4) and which agent or model each runs on, the defaults filled in (free first,
 * none twice, never the run's own). Start runs them as one set and opens Compare.
 */
export function TryMore({ run: r, onClose, onStarted }: { run: RunView; onClose: () => void; onStarted: (set: string) => void }) {
  const [data, setData] = useState<PicksReply>();
  const [error, setError] = useState<string>();
  const [count, setCount] = useState(2);
  const [rows, setRows] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<PicksReply>('GET', `/api/runs/${encodeURIComponent(r.id)}/attempts?count=4`).then(
      (d) => (setData(d), setRows(d.picks.map((p) => key(p ?? d.original)))),
      (e: unknown) => setError((e as Error).message),
    );
  }, [r.id]);
  const options = data ? [data.original, ...data.choices.filter((c) => key(c) !== key(data.original))] : [];
  const byKey = new Map(options.map((o) => [key(o), o]));
  const start = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const agents = rows.slice(0, count).map((k) => byKey.get(k) ?? data!.original);
      const res = await api<{ ids: string[]; set: string }>('POST', `/api/runs/${encodeURIComponent(r.id)}/attempts`, { count, agents });
      onStarted(res.set);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title="Try more ways" description="The same task on other agents or models at once, each on its own branch. Compare them, then pick one to ship.">
        {!data && !error ? <p className="sl-meta">Loading your agents…</p> : null}
        {data ? (
          <div className="tm">
            <label className="tm-row">
              <span>How many more</span>
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {rows.slice(0, count).map((k, i) => (
              <label key={i} className="tm-row">
                <span>{`Way ${i + 1}`}</span>
                <select value={k} onChange={(e) => setRows(rows.map((x, j) => (j === i ? e.target.value : x)))}>
                  {options.map((o) => (
                    <option key={key(o)} value={key(o)}>
                      {key(o) === key(data.original) ? `${pickLabel(o)} (same as this run)` : pickLabel(o)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <p className="sl-meta">Each one counts toward the goal’s and the team’s limits like any run.</p>
          </div>
        ) : null}
        {error ? (
          <p className="sl-alert" role="alert">
            {error}
          </p>
        ) : null}
        <div className="row end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!data} onClick={() => void start()}>
            {`Start ${count} more`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
