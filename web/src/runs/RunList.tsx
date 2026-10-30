import { useState } from 'react';
import { fmtDur, fmtUsd, type RunRow } from '../api';
import { Button } from '../components/beui/kit/Button';
import { SegmentedControl } from '../components/beui/kit/controls';
import { SearchField } from '../components/beui/kit/fields';
import { Loading } from '../components/Loading';
import { useCrew } from '../crewStore';
import type { GoalView } from '../goals/goalsApi';
import { useNow } from '../home/Elapsed';
import { taskTitle } from '../home/runText';
import type { WorkspaceRow } from '../home/workspaces';
import { usePoll, type Poll } from '../hooks';
import { TEAMS_PATH, type TeamsReply } from '../teams/teamsApi';
import { cn } from '../ui/cn';
import { FaceStack } from '../ui/studio/FaceStack';
import { InlineError } from '../ui/studio/InlineError';
import { RUN_STATE_LABEL, runState } from '../ui/studio/RunGlyph';
import { SideMenu } from '../ui/studio/SideParts';
import { QuietLine } from '../ui/studio/Section';
import { segmentsFor, trackLabel } from '../ui/studio/steps';
import { collapseSets, filterRows, groupRuns, nowLine, ORIGIN_LABEL, PAGE, spendByDay, startedFrom, weekStats, type RunsTab, type SetRow } from './runsModel';

/** A scheduled run (GET /api/schedules, once cron triggers exist; a 404 hides the section). */
interface Schedule {
  id: string;
  name: string;
  when: string;
  bot?: string;
  last?: string;
}

const DOT: Record<ReturnType<typeof runState>, string> = { running: 'live', needs: 'needs', done: 'done', failed: 'failed', idle: 'idle' };

/** One segment per step, coloured by its state (the run's mini step track). */
function Track({ r }: { r: RunRow }) {
  const segs = segmentsFor(r.steps, { planning: r.kind === 'team' && r.live });
  if (!segs.length) return <span className="rl-track" />;
  return (
    <span className="rl-track" role="img" aria-label={trackLabel(segs)}>
      {segs.map((s) => (
        <span key={s.id} className={cn('rl-seg', `s-${s.state}`)} />
      ))}
    </span>
  );
}

/** A run's row: status dot, title and what is happening now, its agents, its steps, ± and cost · duration. */
function Row({ r, team, goal, onOpen, now }: { r: RunRow; team?: string; goal?: boolean; onOpen: () => void; now: number }) {
  const st = runState(r);
  const line = nowLine(r);
  const where = [team && `# ${team}`, goal && 'ticket'].filter(Boolean).join(' · ');
  return (
    <button type="button" className="rl-row" aria-label={`${taskTitle(r)}, ${RUN_STATE_LABEL[st]}`} onClick={onOpen}>
      <span className={cn('rl-dot', DOT[st])} aria-hidden="true" />
      <span className="rl-t">
        <b>{taskTitle(r)}</b>
        <span className={cn(line.bad && 'bad')}>{[line.text, where].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="rl-faces">
        <FaceStack bots={r.bots} size={20} max={3} />
      </span>
      <Track r={r} />
      <span className="rl-num mono">{r.added !== undefined ? `+${r.added} −${r.deleted ?? 0}` : '—'}</span>
      <span className="rl-num">{`${fmtUsd(r.costUsd)} · ${fmtDur((r.finishedAt ?? (r.live ? now : r.lastTs)) - r.startedAt)}`}</span>
    </button>
  );
}

/** An attempt set as one row (board 3): the task with a "best of N" chip, one step track per attempt, their spend; it opens Compare. */
function SetRowView({ r, onOpen, now }: { r: SetRow & { set: RunRow[] }; onOpen: () => void; now: number }) {
  const live = r.set.some((x) => x.live);
  const st = live ? 'running' : runState(r);
  return (
    <button type="button" className="rl-row" aria-label={`${taskTitle(r)}, best of ${r.set.length}, ${live ? 'working' : RUN_STATE_LABEL[st]}`} onClick={onOpen}>
      <span className={cn('rl-dot', DOT[st])} aria-hidden="true" />
      <span className="rl-t">
        <b>
          {taskTitle(r)} <span className="rl-best">{`best of ${r.set.length}`}</span>
        </b>
        <span>{r.set.map((x) => `${x.attemptLabel ?? '?'} ${RUN_STATE_LABEL[runState(x)]}`).join(' · ')}</span>
      </span>
      <span className="rl-faces">
        <FaceStack bots={[...new Set(r.set.flatMap((x) => x.bots))]} size={20} max={3} />
      </span>
      <span className="rl-tracks">
        {r.set.map((x) => (
          <Track key={x.id} r={x} />
        ))}
      </span>
      <span className="rl-num mono">{`${r.set.length} ways`}</span>
      <span className="rl-num">{`${fmtUsd(r.set.reduce((a, x) => a + x.costUsd, 0))} · ${fmtDur(Math.max(...r.set.map((x) => (x.finishedAt ?? (x.live ? now : x.lastTs)) - x.startedAt)))}`}</span>
    </button>
  );
}

/** A run that waits on the person, with what it waits for inline: Approve & open PR and Review diff, or Answer. */
function NeedsCard({ r, team, onOpen, onShip }: { r: RunRow; team?: string; onOpen: () => void; onShip?: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const approval = r.steps.some((s) => s.status === 'awaiting' && s.kind === 'approval') && r.pending === 0;
  const line = nowLine(r);
  return (
    <div className="rl-needs" role="group" aria-label={taskTitle(r)}>
      <span className="rl-dot needs" aria-hidden="true" />
      <span className="rl-t">
        <b>{taskTitle(r)}</b>
        <span>{[line.text, r.added !== undefined ? `+${r.added} −${r.deleted ?? 0}` : '', team && `# ${team}`, r.origin?.kind === 'goal' && 'ticket'].filter(Boolean).join(' · ')}</span>
      </span>
      <Track r={r} />
      {approval && onShip ? (
        <>
          <Button size="sm" variant="primary" loading={busy} onClick={() => (setBusy(true), void onShip().finally(() => setBusy(false)))}>
            Approve &amp; open PR
          </Button>
          <Button size="sm" variant="secondary" onClick={onOpen}>
            Review diff
          </Button>
        </>
      ) : (
        <Button size="sm" variant="primary" onClick={onOpen}>
          {r.pending > 0 ? 'Answer' : r.planReady ? 'Review plan' : 'Open'}
        </Button>
      )}
    </div>
  );
}

const Sec = ({ title, meta }: { title: string; meta?: string }) => (
  <h2 className="rl-sec">
    <b>{title}</b>
    {meta ? <span>{meta}</span> : null}
  </h2>
);

/**
 * Runs (board 3): what needs you, what is live, what finished today and earlier, with search, filters (needs you, live,
 * a team, an agent, the project) and a right rail: this week's figures, spend per day, scheduled runs (once they exist)
 * and where runs were started from. Probe replays are in the ⋯ menu.
 */
export function RunList(props: {
  poll: Poll<RunRow[]>;
  probes: boolean;
  onProbes: (on: boolean) => void;
  onSelect: (id: string) => void;
  /** New run. */
  onStart?: () => void;
  /** The current project: a chip narrows the list to runs in its folder. */
  project?: WorkspaceRow;
  goals?: GoalView[];
  /** Approve & open PR, from a Needs you card. */
  onShip?: (id: string) => Promise<void>;
  /** An attempt set's row opens Compare. */
  onCompare?: (set: string) => void;
}) {
  const [tab, setTab] = useState<RunsTab>('all');
  const [team, setTeam] = useState('');
  const [agent, setAgent] = useState('');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [pages, setPages] = useState(1);
  const { crew } = useCrew();
  const teams = usePoll<TeamsReply>(TEAMS_PATH, 60_000).data?.squads ?? [];
  const schedules = usePoll<{ schedules: Schedule[] }>('/api/schedules', 60_000).data?.schedules;
  const { data, error, refresh } = props.poll;
  const all = data ?? [];
  const now = useNow(all.some((r) => r.live));
  const teamName = (id?: string) => (id ? (teams.find((t) => t.id === id)?.name ?? id) : undefined);
  const goalTitle = (id: string) => props.goals?.find((g) => g.id === id)?.title;
  const scoped = props.project && mine ? props.project : undefined;
  const rows = filterRows(all, { tab: tab === 'scheduled' ? 'all' : tab, team: team || undefined, agent: agent || undefined, project: scoped, q }, goalTitle);
  const g = groupRuns(collapseSets(rows, all), now);
  const counts = groupRuns(all, now);
  const earlier = [...g.week, ...g.older];
  const shown = earlier.slice(0, pages * PAGE);
  const agents = [...new Set(all.flatMap((r) => r.bots))];
  const week = weekStats(all, now);
  const days = spendByDay(all, now);
  const peak = Math.max(...days, 0.01);
  const from = startedFrom(all);
  const open = (r: RunRow) => props.onSelect(r.id);
  const row = (r: SetRow) =>
    r.set && r.set.length > 1 ? <SetRowView key={r.id} r={r as SetRow & { set: RunRow[] }} onOpen={() => (props.onCompare ? props.onCompare(r.attemptSet!) : open(r))} now={now} /> : <Row key={r.id} r={r} team={teamName(r.origin?.team)} goal={r.origin?.kind === 'goal'} onOpen={() => open(r)} now={now} />;
  const filtered = tab !== 'all' || team || agent || scoped || q.trim();

  return (
    <div className="rl">
      <section className="rl-main" aria-label="Runs">
        <header className="rl-head">
          <h1>Runs</h1>
          <span className="rl-gap" />
          <SearchField label="Search runs" placeholder="Search runs, goals…" value={q} onValueChange={setQ} className="rl-search" />
          {props.onStart ? (
            <Button size="sm" variant="primary" onClick={props.onStart}>
              New run
            </Button>
          ) : null}
        </header>
        <div className="rl-filters">
          <SegmentedControl
            label="Filter runs"
            options={[
              { value: 'all', label: 'All' },
              { value: 'needs', label: `Needs you · ${counts.needs.length}` },
              { value: 'live', label: `Live · ${counts.live.length}` },
              ...(schedules ? [{ value: 'scheduled', label: 'Scheduled' }] : []),
            ]}
            value={tab}
            onValueChange={(v) => setTab(v as RunsTab)}
          />
          <select className="rl-chip" aria-label="Squad" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Squad: any</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{`# ${t.name}`}</option>
            ))}
          </select>
          <select className="rl-chip" aria-label="Agent" value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">Agent: any</option>
            {agents.map((b) => (
              <option key={b} value={b}>
                {crew[b]?.name ?? b}
              </option>
            ))}
          </select>
          {props.project ? (
            <button type="button" className={cn('rl-chip', mine && 'on')} aria-pressed={mine} onClick={() => setMine(!mine)}>
              {`only ${props.project.name}`}
            </button>
          ) : null}
          <SideMenu className="rl-more" label="More run filters" items={[{ label: props.probes ? 'Hide probe replays' : 'Show probe replays', onPick: () => props.onProbes(!props.probes) }]} />
        </div>
        <Loading loading={data === undefined && !error} lines={6} label="Loading runs">
          {error && !data ? (
            <InlineError message={error} onRetry={() => void refresh()} />
          ) : (
            <>
              {/* a poll that fails after an earlier success keeps the list */}
              {error ? <InlineError compact message="Couldn't refresh" onRetry={() => void refresh()} /> : null}
              {tab === 'scheduled' ? (
                <div className="rl-list">
                  <Sec title="Scheduled" meta={String(schedules?.length ?? 0)} />
                  {(schedules ?? []).map((s) => (
                    <div key={s.id} className="rl-sched">
                      <b>{s.name}</b>
                      <span>{[s.when, s.bot && (crew[s.bot]?.name ?? s.bot), s.last && `last: ${s.last}`].filter(Boolean).join(' · ')}</span>
                    </div>
                  ))}
                </div>
              ) : !rows.length ? (
                <div className="run-list-none">
                  {all.length ? (
                    <>
                      <p className="sl-meta">No runs match.</p>
                      {filtered ? (
                        <Button variant="ghost" size="sm" onClick={() => (setTab('all'), setTeam(''), setAgent(''), setMine(false), setQ(''))}>
                          Show all
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <QuietLine>No runs yet.</QuietLine>
                      {props.onStart ? (
                        <Button variant="secondary" size="sm" onClick={props.onStart}>
                          Start a run
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : (
                <div className="rl-list">
                  {g.needs.length ? (
                    <section aria-label="Needs you">
                      <Sec title="Needs you" meta={String(g.needs.length)} />
                      <div className="rl-cards">
                        {g.needs.map((r) => (
                          <NeedsCard key={r.id} r={r} team={teamName(r.origin?.team)} onOpen={() => open(r)} onShip={props.onShip && (() => props.onShip!(r.id).then(() => void refresh()))} />
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {g.live.length ? (
                    <section aria-label="Live">
                      <Sec title="Live" meta={String(g.live.length)} />
                      {g.live.map(row)}
                    </section>
                  ) : null}
                  {g.today.length ? (
                    <section aria-label="Today">
                      <Sec title="Today" meta={`${g.today.length} · ${fmtUsd(g.today.reduce((a, r) => a + r.costUsd, 0))}`} />
                      {g.today.map(row)}
                    </section>
                  ) : null}
                  {earlier.length ? (
                    <section aria-label="Earlier">
                      <Sec title="Earlier" meta={g.week.length ? `this week · ${g.week.length}${g.older.length ? ` · older · ${g.older.length}` : ''}` : `older · ${g.older.length}`} />
                      {shown.map(row)}
                      {earlier.length > shown.length ? (
                        <Button variant="ghost" size="sm" onClick={() => setPages(pages + 1)}>
                          {`Show ${Math.min(PAGE, earlier.length - shown.length)} more`}
                        </Button>
                      ) : null}
                    </section>
                  ) : null}
                </div>
              )}
            </>
          )}
        </Loading>
      </section>

      <aside className="rl-rail" aria-label="Overview">
        <section aria-labelledby="rl-week">
          <h2 id="rl-week">This week</h2>
          <div className="rl-tiles">
            <div className="rl-tile">
              <b>{week.runs}</b>
              <span>runs</span>
            </div>
            <div className="rl-tile">
              <b>{week.merged}</b>
              <span>PRs merged</span>
            </div>
            <div className="rl-tile">
              <b>{fmtUsd(week.spent)}</b>
              <span>{`spent · ${Math.round(week.freeShare * 100)}% free models`}</span>
            </div>
            <div className="rl-tile">
              <b>{week.firstTry === undefined ? '—' : `${Math.round(week.firstTry * 100)}%`}</b>
              <span>passed first try</span>
            </div>
          </div>
          <div className="rl-bars" role="img" aria-label={`Spend per day, last 7 days: ${days.map(fmtUsd).join(', ')}; today last`}>
            {days.map((d, i) => (
              <span key={i} className={cn('rl-bar', i === 6 && 'today')} style={{ height: `${Math.max(4, (d / peak) * 100)}%` }} />
            ))}
          </div>
        </section>
        {schedules ? (
          <section aria-labelledby="rl-sched">
            <h2 id="rl-sched">Scheduled</h2>
            {schedules.length ? null : <p className="sl-meta">Nothing scheduled.</p>}
            {schedules.map((s) => (
              <div key={s.id} className="rl-sched">
                <b>{s.name}</b>
                <span>{[s.when, s.bot && (crew[s.bot]?.name ?? s.bot), s.last && `last: ${s.last}`].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
          </section>
        ) : null}
        {from.length ? (
          <section aria-labelledby="rl-from">
            <h2 id="rl-from">Started from</h2>
            <div className="rl-from">
              {from.map((x) => (
                <span key={x.key} className="rl-pill">{`${ORIGIN_LABEL[x.key]} ${x.n}`}</span>
              ))}
            </div>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
