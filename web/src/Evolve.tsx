import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Accordion, Checkbox } from './components/beui/kit/fields';
import { Button } from './components/beui/kit/Button';
import { cn } from './ui/cn';
import { ConfirmButton } from './ui/ConfirmButton';
import { SectionHeading } from './ui/studio/SectionHeading';
import { StatusBadge, type Tone } from './ui/studio/StatusBadge';
import './evolve.css';

/** Shapes from src/evolveops.ts (views are plain data; every string here is rendered as text, never as HTML). */
interface LessonRef { id: string; text?: string; polarity?: string; runs?: number; provenance?: string; status?: string }
interface EditView { n: number; field: string; op: string; before?: string; after?: string; roleNote?: true; lessons: LessonRef[]; probe?: 'kept' | 'dropped' | 'unprobed'; probeNote?: string }
interface ProposalView {
  id: string;
  bot: string;
  base: number;
  status: 'open' | 'accepted' | 'rejected';
  label: 'open' | 'accepted' | 'rejected' | 'superseded';
  note?: string;
  createdAt: string;
  picked?: number[];
  version?: number;
  costUsd?: number;
  stale: boolean;
  edits: EditView[];
  probe?: { spentUsd: number; budgetUsd: number; stoppedBy?: string; results: { task: string; edit?: number; verdict: string; baseline: string; candidate: string }[] };
  composed?: { kept: number[]; dropped: number[]; unprobed: number[] };
}
interface LessonView { id: string; text: string; polarity: string; provenance: string; status: string; runs: number; evidence: { run: string; node: string; signal: string }[] }
interface HarnessView { bot: string; evolvable: boolean; current: { version: number; persona: string; guidance: string[]; skills: string[]; note?: string }; versions: { version: number; at: string; note?: string; base?: number }[]; total: number }

const LABEL_TONE: Record<string, Tone> = { open: 'needs', accepted: 'done', rejected: 'failed', superseded: 'neutral' };
const PROBE: Record<'kept' | 'dropped' | 'unprobed', { tone: Tone; label: (note?: string) => string }> = {
  kept: { tone: 'done', label: () => 'kept by the probe' },
  dropped: { tone: 'failed', label: () => 'dropped by the probe' },
  unprobed: { tone: 'needs', label: (note) => `not probed${note ? `: ${note}` : ''}` },
};

/** Harness, proposals and lessons of one bot. Review only: proposals are made with `tether evolve <bot>` (a model call), never from here. */
/** `inDrawer`: the Drawer already frames and titles it, so the panel drops its own frame and heading. */
export function EvolvePanel(props: { bot: string; name: string; onClose: () => void; onChange?: () => void; inDrawer?: boolean }) {
  const [harness, setHarness] = useState<HarnessView | undefined>();
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [lessons, setLessons] = useState<LessonView[]>([]);
  const [picks, setPicks] = useState<Record<string, number[]>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // load() reads the latest picks without being recreated on every tick
  const picksRef = useRef(picks);
  picksRef.current = picks;

  const load = useCallback(async () => {
    try {
      const [h, p, l] = await Promise.all([
        api<HarnessView>('GET', `/api/harness/${encodeURIComponent(props.bot)}`),
        api<{ proposals: ProposalView[] }>('GET', `/api/proposals?bot=${encodeURIComponent(props.bot)}`),
        api<{ lessons: LessonView[] }>('GET', `/api/lessons?bot=${encodeURIComponent(props.bot)}`),
      ]);
      setHarness(h);
      setProposals(p.proposals);
      setLessons(l.lessons);
      // start each open proposal with every edit picked (the person unticks what they do not want), except when the probe dropped some: then nothing is picked for them
      const next: Record<string, number[]> = {};
      for (const x of p.proposals) if (x.status === 'open') next[x.id] = picksRef.current[x.id] ?? (x.composed?.dropped.length ? [] : x.edits.map((e) => e.n));
      setPicks(next);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }, [props.bot]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string, n: number) =>
    setPicks((all) => {
      const cur = all[id] ?? [];
      return { ...all, [id]: cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].sort((a, b) => a - b) };
    });
  async function run(what: () => Promise<string>) {
    setBusy(true);
    try {
      setMsg(await what());
      await load();
      props.onChange?.();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const accept = (p: ProposalView) =>
    run(async () => {
      const r = await api<{ harness: { version: number } }>('POST', `/api/proposals/${encodeURIComponent(p.id)}/accept`, { pick: picks[p.id] ?? [] });
      return `${props.name}'s harness is now v${r.harness.version}; the next run uses it`;
    });
  const reject = (p: ProposalView) =>
    run(async () => {
      await api('POST', `/api/proposals/${encodeURIComponent(p.id)}/reject`, {});
      return `rejected ${p.id}: its edits will not be proposed again`;
    });
  const rollback = (v: number) =>
    run(async () => {
      const r = await api<{ harness: { version: number } }>('POST', `/api/harness/${encodeURIComponent(props.bot)}/rollback`, { version: v });
      return `rolled back: v${r.harness.version} is a copy of v${v}`;
    });

  const rejectButton = (p: ProposalView) => (
    <ConfirmButton label="Reject" prompt={`Reject all ${p.edits.length} edits? They will not be proposed again.`} confirmLabel="Yes, reject" disabled={busy} onConfirm={() => reject(p)} />
  );

  const h = harness;
  return (
    <div className={cn('ev-panel', { 'in-drawer': !!props.inDrawer })} role="region" aria-label={`Evolve ${props.name}`}>
      <div className="ev-top">
        {props.inDrawer ? null : <h3>Evolve · {props.name}</h3>}
        <Button variant="ghost" size="sm" onClick={() => props.onClose()}>
          Close
        </Button>
        {msg ? (
          <span className="ev-msg" role="status">
            {msg}
          </span>
        ) : null}
      </div>
      <p className="ev-help">
        Proposals are made from the command line with <code>tether evolve {props.bot}</code> (one model call). Here you review them: tick the edits you want, accept or reject. Nothing changes until you accept, and any
        version can be rolled back.
      </p>

      {h ? (
        <section className="ev-section">
          <SectionHeading title={`Harness v${h.current.version}`} action={!h.evolvable ? <StatusBadge tone="neutral" label="not evolvable" /> : undefined} />
          <p className="ev-persona">{h.current.persona}</p>
          {h.current.guidance.length ? (
            <ul className="ev-guidance">
              {h.current.guidance.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          ) : (
            <p className="ev-help">No guidance notes yet.</p>
          )}
          <Accordion
            defaultOpen={-1}
            items={[
              {
                title: `Versions (${h.total})`,
                content: (
                  <ul className="ev-versions">
                    {[...h.versions].reverse().map((v) => (
                      <li key={v.version}>
                        <b>v{v.version}</b>
                        <span className="sl-meta">
                          {v.at.slice(0, 16).replace('T', ' ')}
                          {v.note ? ` · ${v.note}` : ''}
                        </span>
                        {v.version !== h.current.version ? (
                          <ConfirmButton variant="secondary" label={`Roll back to v${v.version}`} prompt={`Make a new version that copies v${v.version}?`} confirmLabel="Roll back" disabled={busy} onConfirm={() => rollback(v.version)} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ),
              },
            ]}
          />
        </section>
      ) : null}

      <section className="ev-section">
        <SectionHeading title="Proposals" count={proposals.length} />
        {proposals.length ? (
          proposals.map((p) => {
            const picked = picks[p.id] ?? [];
            return (
              <div className="ev-proposal" key={p.id}>
                <div className="ev-proposal-head">
                  <code>{p.id}</code>
                  <StatusBadge tone={LABEL_TONE[p.label] ?? 'neutral'} label={p.label} />
                  {p.stale ? <StatusBadge tone="needs" label="stale" /> : null}
                  <span className="sl-meta">
                    based on v{p.base}
                    {p.version !== undefined ? ` · made v${p.version}` : ''}
                    {p.costUsd !== undefined ? ` · editor $${p.costUsd.toFixed(4)}` : ''}
                  </span>
                </div>
                {p.note ? <p className="ev-help">{p.note}</p> : null}
                {p.stale ? (
                  <p className="ev-help">
                    The harness moved on since this was written, so it cannot be accepted. Run <code>tether evolve {p.bot}</code> again.
                  </p>
                ) : null}
                {p.edits.map((e) => {
                  const title = `${e.n}. ${e.roleNote ? 'role note' : `${e.field} ${e.op}`}`;
                  return (
                    <div className="ev-edit" key={e.n}>
                      <div className="ev-edit-head">
                        {p.status === 'open' ? (
                          <Checkbox label={title} checked={picked.includes(e.n)} disabled={p.stale} onCheckedChange={() => toggle(p.id, e.n)} />
                        ) : (
                          <span>
                            {p.picked?.includes(e.n) ? '✔ ' : ''}
                            <b>{e.n}.</b> {e.roleNote ? 'role note' : `${e.field} ${e.op}`}
                          </span>
                        )}
                        {e.probe ? <StatusBadge tone={PROBE[e.probe].tone} label={PROBE[e.probe].label(e.probeNote)} /> : null}
                      </div>
                      {e.roleNote ? (
                        <p className="ev-help">added to the bot's role prompt; {e.before !== undefined ? 'replaces the earlier role note' : 'nothing is removed'}</p>
                      ) : null}
                      <pre className="ev-diff">
                        {e.before !== undefined ? <span className="del">- {e.before}</span> : null}
                        {e.after !== undefined ? <span className="add">+ {e.after}</span> : null}
                      </pre>
                      {e.lessons.map((l) => (
                        <p className="ev-help" key={l.id}>
                          because <code>{l.id}</code>
                          {l.text !== undefined ? ` (${l.polarity}, ${l.runs} runs, ${l.provenance}): ${l.text}` : ' (lesson no longer stored)'}
                        </p>
                      ))}
                    </div>
                  );
                })}
                {p.probe ? (
                  <div className="ev-probe ev-help">
                    <b>Probe</b> spent ${p.probe.spentUsd.toFixed(4)} of ${p.probe.budgetUsd.toFixed(2)}
                    {p.probe.stoppedBy ? ` · stopped by ${p.probe.stoppedBy}` : ''}
                    <ul>
                      {p.probe.results.slice(0, 10).map((r, i) => (
                        <li key={i}>
                          <b>{r.verdict}</b> edit {r.edit ?? 'all'} on "{r.task.slice(0, 60)}" · baseline: {r.baseline}; candidate: {r.candidate}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {p.status === 'open' && !p.stale ? (
                  <div className="ev-actions">
                    <Button variant="primary" size="sm" disabled={busy || !picked.length} onClick={() => void accept(p)}>
                      Accept {picked.length === p.edits.length ? 'all' : `${picked.length} of ${p.edits.length}`}
                    </Button>
                    {p.composed ? (
                      <Button variant="secondary" size="sm" disabled={busy || !p.composed.kept.length} onClick={() => setPicks((all) => ({ ...all, [p.id]: [...p.composed!.kept] }))}>
                        Pick the kept edits
                      </Button>
                    ) : null}
                    {rejectButton(p)}
                  </div>
                ) : null}
                {p.status === 'open' && p.stale ? <div className="ev-actions">{rejectButton(p)}</div> : null}
              </div>
            );
          })
        ) : (
          <p className="ev-help">No proposals yet.</p>
        )}
      </section>

      <section className="ev-section">
        <SectionHeading title="Lessons" count={lessons.length} />
        <p className="ev-help">A lesson is tentative until at least 3 different runs support it without conflicting evidence; only confident lessons are proposed.</p>
        {lessons.length ? (
          <ul className="ev-lessons">
            {lessons.map((l) => (
              <li key={l.id}>
                <StatusBadge tone={l.status === 'confident' ? 'done' : 'neutral'} label={l.status} />
                <span>{l.text}</span>
                <span className="sl-meta">
                  {l.polarity} · {l.runs} run{l.runs === 1 ? '' : 's'} · from {l.provenance} · <code>{l.id}</code>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ev-help">No lessons yet: they come from runs with rework, handoff problems or your thumbs up / down.</p>
        )}
      </section>
    </div>
  );
}
