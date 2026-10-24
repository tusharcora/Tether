import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Accordion } from './components/arc/accordion/accordion';
import { Badge } from './components/arc/badge/badge';
import { Button } from './components/arc/button/button';
import { Checkbox } from './components/arc/checkbox/checkbox';
import { cn } from './ui/cn';
import { ConfirmButton } from './ui/ConfirmButton';

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

const LABEL_TONE: Record<string, 'info' | 'success' | 'danger' | 'neutral'> = { open: 'info', accepted: 'success', rejected: 'danger', superseded: 'neutral' };

/** Harness, proposals and lessons of one bot. Review only: proposals are made with `aorch evolve <bot>` (a model call), never from here. */
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
    <div className={cn('evolve-panel', { 'in-drawer': !!props.inDrawer })} role="region" aria-label={`Evolve ${props.name}`}>
      <div className="row">
        {props.inDrawer ? null : <h3>Evolve · {props.name}</h3>}
        <Button variant="ghost" size="sm" onClick={() => props.onClose()}>Close</Button>
        {msg ? <span className="chip" role="status">{msg}</span> : null}
      </div>
      <p className="muted small">
        Proposals are made from the command line with <code>aorch evolve {props.bot}</code> (one model call). Here you review them: tick the edits you want, accept or reject.
        Nothing changes until you accept, and any version can be rolled back.
      </p>

      {h ? (
        <section>
          <h4>Harness v{h.current.version} {!h.evolvable ? <span className="muted small">(not evolvable)</span> : null}</h4>
          <p className="muted small persona">{h.current.persona}</p>
          {h.current.guidance.length ? (
            <ul className="small">
              {h.current.guidance.map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          ) : (
            <p className="muted small">No guidance notes yet.</p>
          )}
          <Accordion
            defaultOpen={-1}
            items={[
              {
                title: `Versions (${h.total})`,
                content: (
                  <ul className="small versions">
                    {[...h.versions].reverse().map((v) => (
                      <li key={v.version}>
                        <b>v{v.version}</b> <span className="muted">{v.at.slice(0, 16).replace('T', ' ')}{v.note ? ` · ${v.note}` : ''}</span>{' '}
                        {v.version !== h.current.version ? (
                          <ConfirmButton
                            variant="secondary"
                            label={`Roll back to v${v.version}`}
                            prompt={`Make a new version that copies v${v.version}?`}
                            confirmLabel="Roll back"
                            disabled={busy}
                            onConfirm={() => rollback(v.version)}
                          />
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

      <section>
        <h4>Proposals</h4>
        {proposals.length ? (
          proposals.map((p) => {
            const picked = picks[p.id] ?? [];
            return (
              <div className="proposal" key={p.id}>
                <div className="row">
                  <b><code>{p.id}</code></b>
                  <Badge tone={LABEL_TONE[p.label] ?? 'neutral'} size="sm">{p.label}</Badge>
                  {p.stale ? <Badge tone="warning" size="sm" title="Written for an older version">stale</Badge> : null}
                  <span className="muted small">based on v{p.base}{p.version !== undefined ? ` · made v${p.version}` : ''}{p.costUsd !== undefined ? ` · editor $${p.costUsd.toFixed(4)}` : ''}</span>
                </div>
                {p.note ? <p className="muted small">{p.note}</p> : null}
                {p.stale ? <p className="muted small">The harness moved on since this was written, so it cannot be accepted. Run <code>aorch evolve {p.bot}</code> again.</p> : null}
                {p.edits.map((e) => {
                  const title = `${e.n}. ${e.roleNote ? 'role note' : `${e.field} ${e.op}`}`;
                  return (
                    <div className="edit" key={e.n}>
                      <div className="check">
                        {p.status === 'open' ? (
                          <Checkbox label={title} checked={picked.includes(e.n)} disabled={p.stale} onCheckedChange={() => toggle(p.id, e.n)} />
                        ) : (
                          <>
                            <span>{p.picked?.includes(e.n) ? '✔' : ''}</span> <b>{e.n}.</b> {e.roleNote ? 'role note' : `${e.field} ${e.op}`}
                          </>
                        )}
                        {e.roleNote ? (
                          <span className="muted small"> added to the bot's role prompt; {e.before !== undefined ? 'replaces the earlier role note' : 'nothing is removed'}</span>
                        ) : null}
                        {e.probe ? (
                          <span className={`chip probe-${e.probe}`}>{e.probe === 'dropped' ? 'dropped by the probe' : e.probe === 'unprobed' ? `not probed${e.probeNote ? `: ${e.probeNote}` : ''}` : 'kept by the probe'}</span>
                        ) : null}
                      </div>
                      <pre className="diff small">
                        {e.before !== undefined ? <span className="del">- {e.before}{'\n'}</span> : null}
                        {e.after !== undefined ? <span className="add">+ {e.after}</span> : null}
                      </pre>
                      {e.lessons.map((l) => (
                        <p className="muted small" key={l.id}>
                          because <code>{l.id}</code>{l.text !== undefined ? ` (${l.polarity}, ${l.runs} runs, ${l.provenance}): ${l.text}` : ' (lesson no longer stored)'}
                        </p>
                      ))}
                    </div>
                  );
                })}
                {p.probe ? (
                  <div className="small">
                    <b>Probe</b> <span className="muted">spent ${p.probe.spentUsd.toFixed(4)} of ${p.probe.budgetUsd.toFixed(2)}{p.probe.stoppedBy ? ` · stopped by ${p.probe.stoppedBy}` : ''}</span>
                    <ul>
                      {p.probe.results.slice(0, 10).map((r, i) => (
                        <li key={i}>
                          <b>{r.verdict}</b> edit {r.edit ?? 'all'} on "{r.task.slice(0, 60)}" <span className="muted">baseline: {r.baseline}; candidate: {r.candidate}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {p.status === 'open' && !p.stale ? (
                  <div className="row">
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
                {p.status === 'open' && p.stale ? <div className="row">{rejectButton(p)}</div> : null}
              </div>
            );
          })
        ) : (
          <p className="muted small">No proposals yet.</p>
        )}
      </section>

      <section>
        <h4>Lessons</h4>
        <p className="muted small">A lesson is tentative until at least 3 different runs support it without conflicting evidence; only confident lessons are proposed.</p>
        {lessons.length ? (
          <ul className="small">
            {lessons.map((l) => (
              <li key={l.id}>
                <Badge tone={l.status === 'confident' ? 'success' : 'neutral'} size="sm">{l.status}</Badge> {l.text}{' '}
                <span className="muted">{l.polarity} · {l.runs} run{l.runs === 1 ? '' : 's'} · from {l.provenance} · <code>{l.id}</code></span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No lessons yet: they come from runs with rework, handoff problems or your thumbs up / down.</p>
        )}
      </section>
    </div>
  );
}
