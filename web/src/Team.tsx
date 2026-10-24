import { useEffect, useState } from 'react';
import { fmtUsd, type Question, type RunView, type TeamMode } from './api';
import { Accordion } from './components/arc/accordion/accordion';
import { Badge } from './components/arc/badge/badge';
import { Button } from './components/arc/button/button';
import { ChatThread } from './components/arc/chat-thread/chat-thread';
import { RadioCards } from './components/arc/radio-cards/radio-cards';
import SegmentedControl from './components/arc/segmented-control/segmented-control';
import { Textarea } from './components/arc/textarea/textarea';
import { ConfirmButton } from './ui/ConfirmButton';

/** One pick per card: an option id, or the person's own words. */
type Pick = { option?: string; text?: string };
type Reply = { question: string; option?: string; text?: string };

const MODES: { id: TeamMode; label: string; hint: string }[] = [
  { id: 'live', label: 'Live', hint: 'Maestro reports as the team works and asks you questions' },
  { id: 'autonomous', label: 'Autonomous', hint: 'Maestro answers for you and reports at the end' },
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

function QuestionCard(props: { q: Question; index: number; total: number; pick: Pick | undefined; onPick: (p: Pick | undefined) => void; asker?: string }) {
  const { q, pick, onPick } = props;
  return (
    <div className="qcard">
      <div className="qhead">
        <b>{q.ask}</b>
        {props.total > 1 ? (
          <span className="muted small">
            {' '}
            {props.index + 1} of {props.total}
          </span>
        ) : null}
      </div>
      {props.asker ? <p className="muted small">asked by {props.asker}</p> : null}
      {q.why ? <p className="muted small">{q.why}</p> : null}
      <RadioCards
        layout="list"
        aria-label={q.ask}
        options={q.options.map((o) => ({
          value: o.id,
          label:
            o.id === q.recommended ? (
              <>
                {o.label}{' '}
                <Badge tone="info" size="sm">
                  recommended
                </Badge>
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
 * live/autonomous switch. `send` posts to the run (answers, plan, mode) and shows any error on the run page.
 */
export function TeamPanel(props: { run: RunView; send: (path: 'answers' | 'plan' | 'mode', body: unknown) => Promise<boolean> }) {
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
    { id: 'maestro', name: 'Maestro' },
    { id: 'user', name: 'You' },
    { id: 'default', name: 'Recommended (auto)' },
  ];
  const messages = showDialogue
    ? r.answers.flatMap((a, i) => {
        const card = r.cards?.find((c) => c.id === a.question);
        const said = a.text ?? card?.options.find((o) => o.id === a.option)?.label ?? a.option ?? '';
        const at = r.startedAt + i * 2;
        return [
          { id: `q-${i}`, authorId: 'maestro', text: card?.ask ?? a.question, createdAt: at },
          { id: `a-${i}`, authorId: a.by === 'user' ? 'user' : a.by === 'maestro' ? 'maestro' : 'default', text: said, createdAt: at + 1 },
        ];
      })
    : [];
  const n = r.answers.length;

  return (
    <>
      {active ? (
        <div className="team-bar">
          <span className="badge s-team">Team</span>
          <ModeToggle mode={r.mode} disabled={busy} onPick={(m) => void props.send('mode', { mode: m })} />
          <span className="muted small">{MODES.find((m) => m.id === r.mode)!.hint}</span>
        </div>
      ) : null}

      {pending.length > 0 ? (
        <>
          <div className="alert wait" role="status">
            <div>
              <b>{pending.length === 1 ? 'The team has a question for you.' : `The team has ${pending.length} questions for you.`}</b>
              <span className="muted small"> {r.planning ? 'Planning continues once you answer.' : 'The asking step is paused until you answer.'}</span>
            </div>
          </div>
          <section className="qpanel" aria-label="Questions from the team">
            {pending.map((q, i) => (
              <QuestionCard key={q.id} q={q} index={i} total={pending.length} asker={askerOf(q)} pick={picks[q.id]} onPick={(p) => setPick(q.id, p)} />
            ))}
            <div className="row end">
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
        <section className="qpanel plan" aria-label="The team's plan">
          <h4>Plan ready for your approval</h4>
          <p>{plan.goal}</p>
          {plan.success.length ? (
            <>
              <h5>Done when</h5>
              <ul>
                {plan.success.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          ) : null}
          <h5>Who does what</h5>
          <ul className="assign">
            {plan.assignments.map((a, i) => (
              <li key={`${a.bot}-${i}`}>
                <b>{a.bot}</b>{' '}
                <Badge size="sm" tone={a.mode === 'write' ? 'warning' : 'neutral'}>
                  {a.mode === 'write' ? 'can edit files' : 'read only'}
                </Badge>{' '}
                {a.goal}
                {a.expected ? <small className="muted"> — expects: {a.expected}</small> : null}
              </li>
            ))}
          </ul>
          <p className="muted small">
            Writes {plan.limits.allowWrites ? 'allowed' : 'off'}
            {plan.limits.maxCostUsd ? ` · budget ${fmtUsd(plan.limits.maxCostUsd)} in all` : ''}
            {plan.limits.maxCostUsd && r.costUsd > 0 ? ` (planning spent ${fmtUsd(r.costUsd)}, ${fmtUsd(Math.max(0, plan.limits.maxCostUsd - r.costUsd))} left)` : ''}
            {plan.limits.wallClockMs ? ` · ${Math.round(plan.limits.wallClockMs / 60_000)} min limit` : ''}
          </p>
          <div className="row end">
            {/* keyed by run so a half-asked reject does not carry over to another run */}
            <ConfirmButton
              key={r.id}
              label="Reject"
              prompt="Cancel this run?"
              confirmLabel="Yes, reject"
              cancelLabel="Keep plan"
              disabled={busy}
              onAskingChange={setRejecting}
              onConfirm={() => decide(false)}
            />
            {rejecting ? null : (
              <Button variant="primary" disabled={busy} onClick={() => void decide(true)}>
                Approve and start
              </Button>
            )}
          </div>
        </section>
      ) : null}

      {showDialogue ? (
        <div className="dialogue">
          <Accordion
            defaultOpen={-1}
            items={[
              {
                title: `Dialogue so far (${n} answer${n === 1 ? '' : 's'})`,
                content: <ChatThread participants={participants} currentUserId="user" messages={messages} composer={false} label="Planning dialogue" />,
              },
            ]}
          />
        </div>
      ) : null}
    </>
  );
}
