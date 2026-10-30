import { fmtUsd, type RunView } from '../api';
import type { GoalView } from '../goals/goalsApi';
import type { Route } from '../hooks';
import { cn } from '../ui/cn';
import { gateSummary } from './ApprovalBar';
import { FileBars } from './FileBars';
import { commitsKey } from './RunFiles';
import { useDiff } from './useDiff';

const FROM = { chat: 'Chat', goal: 'Goal', team: 'Team', trigger: 'Trigger', schedule: 'Schedule' } as const;
/** Cost bar colours: the crew's own hues would need a palette; the tokens keep it to four, then repeat. */
const TONES = ['var(--warn)', 'var(--ok)', 'var(--accInk)', 'var(--mut)'];

/**
 * The run's outcome on the right (board 4): its check, branch, PR, where it was started from and its team; the files it
 * changed with ± bars; what it cost per agent and model; and More: every event (the raw timeline).
 */
export function OutcomeRail(p: { run: RunView; goal?: GoalView; teamName?: string; cost: { label: string; usd: number }[]; onGo?: (r: Route) => void; onOpenFile?: (file: string) => void; onEvents: () => void }) {
  const r = p.run;
  const diff = useDiff(`/api/runs/${r.id}/diff`, commitsKey(r));
  const c = p.goal?.lastCheck;
  const total = p.cost.reduce((a, x) => a + x.usd, 0);
  const o = r.origin;
  const from = o ? (o.kind === 'chat' ? { tab: 'chats', id: o.id } : o.kind === 'goal' ? { tab: 'goals', id: o.id } : o.kind === 'team' ? { tab: 'teams', id: o.id } : o.kind === 'trigger' ? { tab: 'triggers' } : undefined) : undefined;
  const link = (label: string, to?: Route) =>
    to && p.onGo ? (
      <button type="button" className="rp-link" onClick={() => p.onGo!(to)}>
        {label}
      </button>
    ) : (
      label
    );
  return (
    <aside className="rp-outcome" aria-label="Outcome">
      <section>
        <h2>Outcome</h2>
        <dl className="rp-dl">
          <dt>Check</dt>
          <dd className={cn(c ? (c.ok ? 'ok' : 'bad') : undefined)}>{c ? `${c.ok ? 'passes' : 'fails'}${c.summary ? ` · ${c.summary}` : ''}` : gateSummary(r)}</dd>
          <dt>Branch</dt>
          <dd className="mono">{r.branch}</dd>
          {r.ship?.url ? (
            <>
              <dt>PR</dt>
              <dd>
                <a href={r.ship.url} target="_blank" rel="noreferrer">{`#${r.ship.number}${r.ship.merged ? ' merged' : ' open'}`}</a>
              </dd>
            </>
          ) : r.ship?.error ? (
            <>
              <dt>PR</dt>
              <dd className="bad">{r.ship.error}</dd>
            </>
          ) : null}
          <dt>Started from</dt>
          <dd>{o ? link(o.kind === 'goal' && p.goal ? `Goal: ${p.goal.title}` : FROM[o.kind], from as Route | undefined) : '—'}</dd>
          {o?.team ? (
            <>
              <dt>Team</dt>
              <dd>{link(`# ${p.teamName ?? o.team}`, { tab: 'teams', id: o.team })}</dd>
            </>
          ) : null}
        </dl>
      </section>
      <section>
        <h2>Files</h2>
        {diff.text ? <FileBars diff={diff.text} onOpen={p.onOpenFile} /> : <p className="sl-meta">{diff.loading ? 'Loading…' : diff.error ? 'Could not read the changes.' : 'No changes yet.'}</p>}
      </section>
      {total > 0 ? (
        <section>
          <h2>Cost</h2>
          <div className="rp-costbar" role="img" aria-label={`Cost: ${p.cost.map((x) => `${x.label} ${fmtUsd(x.usd)}`).join(', ')}`}>
            {p.cost.map((x, i) => (
              <span key={x.label} style={{ width: `${(x.usd / total) * 100}%`, background: TONES[i % TONES.length] }} />
            ))}
          </div>
          <ul className="rp-costs">
            {p.cost.map((x) => (
              <li key={x.label}>
                <span>{x.label}</span>
                <span className="mono">{fmtUsd(x.usd)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h2>More</h2>
        <button type="button" className="rp-link" onClick={p.onEvents}>
          Every event (raw timeline)
        </button>
      </section>
    </aside>
  );
}
