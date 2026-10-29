import { X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { fmtUsd } from '../api';
import { Button } from '../components/beui/kit/Button';
import { Input } from '../components/beui/kit/fields';
import { Textarea } from '../components/kept/textarea/textarea';
import { Loading } from '../components/Loading';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { InlineError } from '../ui/studio/InlineError';
import { shortRunId } from '../ui/studio/RunGlyph';
import { SectionHeading } from '../ui/studio/SectionHeading';
import { MARK, STATE_LABEL, teamsApi, type AgentView } from './teamsApi';
import './teams.css';

const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

/**
 * A Crew bot as a teammate (board 3), on its card under Runs on: specialty and personality, its memory (lessons it carries
 * into every team, never transcripts: forget one or all), the teams it is in and what it is doing there, and its recent team work.
 */
export function AgentProfile({ bot, name, title }: { bot: string; name: string; title: string }) {
  const notify = useNotify();
  const [v, setV] = useState<AgentView>();
  const [error, setError] = useState<string>();
  const [specialty, setSpecialty] = useState('');
  const [personality, setPersonality] = useState('');
  const [busy, setBusy] = useState(false);
  const ids = { me: useId(), memory: useId(), teams: useId() };
  const show = (a: AgentView) => (setV(a), setSpecialty(a.profile.specialty ?? ''), setPersonality(a.profile.personality ?? ''));
  const load = () => teamsApi.agent(bot).then(show, (e: unknown) => setError((e as Error).message));
  useEffect(() => void load(), [bot]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!v) return error ? <InlineError compact message={error} onRetry={() => (setError(undefined), void load())} /> : <Loading loading lines={3} label={`Loading ${name} as a teammate`} />;
  const dirty = specialty !== (v.profile.specialty ?? '') || personality !== (v.profile.personality ?? '');
  const save = () => {
    setBusy(true);
    teamsApi
      .saveAgent(bot, { specialty: specialty.trim(), personality: personality.trim() })
      .then((a) => (show(a), notify.ok(`${name} saved`)), notify.fail)
      .finally(() => setBusy(false));
  };
  const forget = (lesson?: string) => teamsApi.forget(bot, lesson).then(setV, notify.fail);

  return (
    <section className="ap" aria-labelledby={ids.me}>
      <SectionHeading id={ids.me} title="As a teammate" />
      <p className="sl-meta">Answers when @mentioned, or handed a task or loop. Never acts unprompted.</p>
      <Input label="Specialty" value={specialty} maxLength={24} placeholder={title} onChange={(e) => setSpecialty(e.target.value)} />
      <Textarea label="Personality" rows={3} maxLength={500} value={personality} placeholder="How it talks in a team, in a few lines." onChange={(e) => setPersonality(e.target.value)} />
      <div className="cw-actions">
        <Button variant="secondary" size="sm" disabled={!dirty} loading={busy} onClick={save}>
          Save teammate
        </Button>
      </div>

      <SectionHeading id={ids.memory} title={`Memory · lessons ${name} carries into every team`} count={v.lessons.length} action={v.lessons.length ? <ConfirmButton label="Forget all" prompt={`Forget all ${v.lessons.length} lessons?`} confirmLabel="Forget all" variant="danger" onConfirm={() => forget()} /> : undefined} />
      {v.lessons.length ? (
        <ul className="ap-lessons" aria-labelledby={ids.memory}>
          {v.lessons.map((l) => (
            <li key={l.id}>
              <span>{l.text}</span>
              <span className="ap-when">{`${l.teamName ?? (l.team ? 'a deleted team' : 'from runs')} · ${day(l.at)}`}</span>
              <button type="button" className="ap-forget" aria-label={`Forget: ${l.text}`} title="Forget this" onClick={() => void forget(l.id)}>
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sl-meta">No lessons yet. After a task or loop, it keeps a few: facts about the code and what worked, never quotes.</p>
      )}

      <SectionHeading id={ids.teams} title="Teams" />
      {v.teams.length ? (
        <ul className="ap-list" aria-labelledby={ids.teams}>
          {v.teams.map((t) => (
            <li key={t.id}>
              <span className="tm-mono" aria-hidden="true">
                {MARK[t.place]}
              </span>
              <span className="tm-grow">{t.name}</span>
              <span className={`tm-state ${t.state}`}>{STATE_LABEL[t.state]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sl-meta">Not in a team yet: add it from a team's settings.</p>
      )}
      {v.recent.length ? (
        <>
          <SectionHeading title="Recent work" />
          <ul className="ap-list">
            {v.recent.map((r) => (
              <li key={r.runId}>
                <span className="tm-grow">{`${shortRunId(r.runId)} · ${r.title}`}</span>
                <span className="tm-mono">{r.status === 'running' || r.status === 'paused' ? r.status : fmtUsd(r.costUsd)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
