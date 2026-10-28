import { useEffect, useState } from 'react';
import { ToolApproval } from './components/beui/agents/tool-approval';
import { fmtUsd, type Question, type RunView, type TeamMode } from './api';
import { Accordion } from './components/beui/kit/fields';
import { Button } from './components/beui/kit/Button';
import { RadioCards } from './components/beui/kit/RadioCards';
import { Select } from './components/beui/kit/fields';
import { SegmentedControl } from './components/beui/kit/controls';
import { Textarea } from './components/kept/textarea/textarea';
import { Face } from './Face';
import { ConfirmButton } from './ui/ConfirmButton';
import { ListRow } from './ui/studio/ListRow';
import { SectionHeading } from './ui/studio/SectionHeading';
import { StatusChip } from './ui/studio/StatusChip';
import './runs/team.css';

/** One pick per card: an option id, or the person's own words. */
type Pick = { option?: string; text?: string };
type Reply = { question: string; option?: string; text?: string };

const MODES: { id: TeamMode; label: string; hint: string }[] = [
  { id: 'live', label: 'Live', hint: 'Tether reports as the team works and asks you questions' },
  { id: 'autonomous', label: 'Autonomous', hint: 'Tether answers for you and reports at the end' },
];

/** Arc's SegmentedControl has no `disabled` prop, so picks are ignored while disabled. */
export function ModeToggle(props: { mode: TeamMode; onPick: (m: TeamMode) => void; disabled?: boolean }) {
  return (
    <SegmentedControl
      label="Team mode"
      options={MODES.map((m) => ({ value: m.id, label: m.label }))}
      value={props.mode}
      onValueChange={(v) => !props.disabled && v !== props.mode && props.onPick(v as TeamMode)}
    />
  );
}

/** A Code Mode outside-world call: the engine asks "Allow <bot> to <what>?" with the options Allow and Deny. */
function codeModeAsk(q: Question): { what: string; allow: string; deny: string } | undefined {
  const m = /^Allow .+? to (.+)\?$/s.exec(q.ask);
  const allow = q.options.find((o) => o.label.toLowerCase() === 'allow');
  const deny = q.options.find((o) => o.label.toLowerCase() === 'deny');
  return m && allow && deny && q.options.length === 2 ? { what: m[1]!, allow: allow.id, deny: deny.id } : undefined;
}

function QuestionCard(props: { q: Question; index: number; total: number; pick: Pick | undefined; onPick: (p: Pick | undefined) => void; asker?: string }) {
  const { q, pick, onPick } = props;
  const cm = codeModeAsk(q);
  if (cm)
    return (
      <div className="tm-qcard tm-approval">
        <ToolApproval
          tool="run_code"
          title={q.ask}
          description={q.why ?? (props.asker ? `Asked by ${props.asker}.` : undefined)}
          status={pick?.option === cm.allow ? 'approved' : pick?.option === cm.deny ? 'denied' : 'pending'}
          defaultOpen
          onApprove={() => onPick({ option: cm.allow })}
          onDeny={() => onPick({ option: cm.deny })}
        />
        {pick ? (
          <Button variant="ghost" size="sm" onClick={() => onPick(undefined)}>
            Change my answer
          </Button>
        ) : null}
        {q.recommended === cm.deny && !pick ? <p className="sl-meta">Recommended: Deny.</p> : null}
      </div>
    );
  return (
    <div className="sl-panel tm-qcard">
      <div className="tm-qhead">
        <h3>{q.ask}</h3>
        {props.total > 1 ? (
          <span className="sl-count">
            {props.index + 1} of {props.total}
          </span>
        ) : null}
      </div>
      {props.asker ? <p className="sl-meta">asked by {props.asker}</p> : null}
      {q.why ? <p className="tm-why">{q.why}</p> : null}
      <RadioCards
        layout="list"
        aria-label={q.ask}
        options={q.options.map((o) => ({
          value: o.id,
          label:
            o.id === q.recommended ? (
              <>
                {o.label}
                <span className="tm-rec">recommended</span>
              </>
            ) : (
              o.label
            ),
          description: o.detail,
        }))}
        value={pick?.option ?? null}
        onValueChange={(v) => onPick({ option: v })}
      />
      {q.allowOther ? (
        <Textarea
          label="Or in your own words"
          rows={2}
          maxLength={2000}
          value={pick?.text ?? ''}
          onChange={(e) => onPick(e.target.value ? { text: e.target.value } : undefined)}
          placeholder="Type your answer"
        />
      ) : null}
    </div>
  );
}

/**
 * Everything a team run needs from the person: the pending banner, the question cards, the finished plan and the
 * live/autonomous switch. `send` posts to the run (answers, plan, mode, swap) and shows any error on the run page.
 */
export function TeamPanel(props: { run: RunView; send: (path: 'answers' | 'plan' | 'mode' | 'swap', body: unknown) => Promise<boolean> }) {
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busy, setBusy] = useState(false);
  // the reject question is open: Approve hides until it is answered (as in the Solid panel)
  const [rejecting, setRejecting] = useState(false);
  const r = props.run;
  const pending = r.status === 'running' || r.status === 'paused' ? r.pending : [];
  const askerOf = (q: Question) => {
    const id = q.from;
    const n = id ? r.pipeline.nodes.find((x) => x.id === id) : undefined;
    return id ? (n?.title ?? n?.role ?? id) : undefined;
  };
  // picks belong to one run: another run may reuse the same question ids
  useEffect(() => {
    setPicks({});
    setRejecting(false);
  }, [r.id]);
  const ready = pending.length > 0 && pending.every((q) => !!(picks[q.id]?.option || picks[q.id]?.text?.trim()));
  const planReady = r.status === 'running' && !r.planning && !!r.plan && r.pipeline.nodes.length === 0 && pending.length === 0;
  const active = r.status === 'running' || r.status === 'paused';

  const setPick = (id: string, p: Pick | undefined) =>
    setPicks((cur) => {
      const next = { ...cur };
      if (p) next[id] = p;
      else delete next[id];
      return next;
    });

  async function submit(list: Reply[]) {
    if (busy || !list.length) return;
    setBusy(true);
    try {
      // planning cards go in one batch; a worker's question is answered on its own
      const asks = new Set((r.userAsks ?? []).map((a) => a.question.id));
      const plan = list.filter((a) => !asks.has(a.question));
      const sent: string[] = [];
      let ok = true;
      if (plan.length) {
        ok = await props.send('answers', { answers: plan });
        if (ok) sent.push(...plan.map((a) => a.question));
      }
      // stop at the first failure: what was sent is cleared, what was not stays for another try
      for (const a of list.filter((x) => asks.has(x.question))) {
        if (!ok) break;
        ok = await props.send('answers', { answers: [a] });
        if (ok) sent.push(a.question);
      }
      setPicks((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => !sent.includes(id))));
    } finally {
      setBusy(false);
    }
  }
  const mine = (): Reply[] => pending.map((q) => ({ question: q.id, ...picks[q.id]! }));
  const recommendations = (): Reply[] => pending.map((q) => ({ question: q.id, option: q.recommended }));

  async function decide(approved: boolean) {
    setBusy(true);
    try {
      await props.send('plan', { approved });
    } finally {
      setBusy(false);
    }
  }

  const plan = r.plan;
  const showDialogue = (r.cards?.length ?? 0) > 0 && r.answers.length > 0;
  const participants = [
    { id: 'tether', name: 'Tether' },
    { id: 'user', name: 'You' },
    { id: 'default', name: 'Recommended (auto)' },
  ];
  const messages = showDialogue
    ? r.answers.flatMap((a, i) => {
        const card = r.cards?.find((c) => c.id === a.question);
        const said = a.text ?? card?.options.find((o) => o.id === a.option)?.label ?? a.option ?? '';
        const at = r.startedAt + i * 2;
        return [
          { id: `q-${i}`, authorId: 'tether', text: card?.ask ?? a.question, createdAt: at },
          { id: `a-${i}`, authorId: a.by === 'user' ? 'user' : a.by === 'tether' || a.by === 'maestro' ? 'tether' : 'default', text: said, createdAt: at + 1 },
        ];
      })
    : [];
  const n = r.answers.length;

  return (
    <div className="tm-panel">
      {active ? (
        <div className="tm-bar">
          <StatusChip tone={r.status === 'running' ? 'live' : 'needs'} label={r.status === 'running' ? 'Team run' : 'Team run · paused'} pulse={r.status === 'running' && r.live} />
          <ModeToggle mode={r.mode} disabled={busy} onPick={(m) => void props.send('mode', { mode: m })} />
          <span className="sl-meta">{MODES.find((m) => m.id === r.mode)!.hint}</span>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <>
          <p className="sl-note" role="status">
            <b>{pending.length === 1 ? 'The team has a question for you.' : `The team has ${pending.length} questions for you.`}</b>{' '}
            {r.planning ? 'Planning continues once you answer.' : 'The asking step is paused until you answer.'}
          </p>
          <section className="tm-questions" aria-label="Questions from the team">
            {pending.map((q, i) => (
              <QuestionCard key={q.id} q={q} index={i} total={pending.length} asker={askerOf(q)} pick={picks[q.id]} onPick={(p) => setPick(q.id, p)} />
            ))}
            <div className="tm-actions">
              <Button variant="secondary" disabled={busy} onClick={() => void submit(recommendations())} title="Answer every question with the option marked recommended">
                Use recommendations
              </Button>
              <Button variant="primary" loading={busy} disabled={busy || !ready} onClick={() => void submit(mine())}>
                Send answers
              </Button>
            </div>
          </section>
        </>
      ) : null}

      {planReady && plan ? (
        <section className="sl-panel tm-plan" aria-label="The team's plan">
          <SectionHeading title="Plan ready for your approval" action={<StatusChip tone="needs" label="waits for you" />} />
          <p className="tm-goal">{plan.goal}</p>
          {plan.success.length ? (
            <div className="tm-block">
              <h3>Done when</h3>
              <ul className="tm-done">
                {plan.success.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="tm-block">
            <h3>Who does what</h3>
            <ul className="sl-list tm-assign">
              {plan.assignments.map((a, i) => (
                <ListRow
                  key={`${a.bot}-${i}`}
                  lead={<Face id={a.bot} size={32} animate="hover" />}
                  title={a.bot}
                  meta={a.expected ? `expects: ${a.expected}` : undefined}
                  extra={
                    <>
                      <span className="tm-assign-goal">{a.goal}</span>
                      {a.why ? <span className="sl-meta">Why: {a.why}</span> : null}
                    </>
                  }
                  actions={
                    <>
                      <StatusChip tone="neutral" label={a.mode === 'write' ? 'can edit files' : 'read only'} />
                      {a.swapped ? <StatusChip tone="neutral" label="swapped by you" /> : null}
                      {plan.roster?.length ? (
                        // the current bot is always first so the shown value exists among the options
                        <Select
                          label="Bot"
                          options={[...new Set([a.bot, ...plan.roster])].map((b) => ({ value: b, label: b }))}
                          value={a.bot}
                          onValueChange={(b) => b !== a.bot && void props.send('swap', { assignment: i, bot: b })}
                          disabled={busy}
                        />
                      ) : null}
                    </>
                  }
                />
              ))}
            </ul>
          </div>
          <p className="sl-meta">
            Writes {plan.limits.allowWrites ? 'allowed' : 'off'}
            {plan.limits.maxCostUsd ? ` · budget ${fmtUsd(plan.limits.maxCostUsd)} in all` : ''}
            {plan.limits.maxCostUsd && r.costUsd > 0 ? ` (planning spent ${fmtUsd(r.costUsd)}, ${fmtUsd(Math.max(0, plan.limits.maxCostUsd - r.costUsd))} left)` : ''}
            {plan.limits.wallClockMs ? ` · ${Math.round(plan.limits.wallClockMs / 60_000)} min limit` : ''}
          </p>
          <div className="tm-actions">
            {/* keyed by run so a half-asked reject does not carry over to another run */}
            <ConfirmButton key={r.id} label="Reject" prompt="Cancel this run?" confirmLabel="Yes, reject" cancelLabel="Keep plan" disabled={busy} onAskingChange={setRejecting} onConfirm={() => decide(false)} />
            {rejecting ? null : (
              <Button variant="primary" disabled={busy} onClick={() => void decide(true)}>
                Approve and start
              </Button>
            )}
          </div>
        </section>
      ) : null}

      {showDialogue ? (
        <div className="tm-dialogue">
          <Accordion
            defaultOpen={-1}
            items={[
              {
                title: `Dialogue so far (${n} answer${n === 1 ? '' : 's'})`,
                content: (
                  <ol className="tm-thread" aria-label="Planning dialogue">
                    {messages.map((m) => (
                      <li key={m.id} className="tm-thread-row" data-author={m.authorId}>
                        <span className="tm-thread-who">{participants.find((x) => x.id === m.authorId)?.name ?? m.authorId}</span>
                        <span className="tm-thread-text">{m.text}</span>
                      </li>
                    ))}
                  </ol>
                ),
              },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}
