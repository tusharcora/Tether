import { useId, useState, type FormEvent } from 'react';
import { Button } from '../components/beui/kit/Button';
import { SegmentedControl } from '../components/beui/kit/controls';
import { Input, Select, Switch } from '../components/beui/kit/fields';
import { RadioCards } from '../components/beui/kit/RadioCards';
import { Face } from '../Face';
import type { WorkspaceRow } from '../home/workspaces';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { LEVELS, PLACE, teamsApi, type Level, type Place, type Team, type TeamsReply } from './teamsApi';
import './teams.css';

const LATER = 'Connect in a later phase.';
const PLACES: { value: Place; label: string; description: string; disabled?: boolean }[] = [
  { value: 'tether', label: 'Tether', description: 'A channel inside Tether. You and your agents.' },
  { value: 'slack', label: 'Slack', description: `A Slack channel. Teammates join in; agents post as themselves. ${LATER}`, disabled: true },
  { value: 'telegram', label: 'Telegram', description: `A Telegram group. Add the Tether bot, send the pairing code. ${LATER}`, disabled: true },
];

/**
 * A team's settings (board 2): name, where it lives, its agents (they keep one memory across all their teams), who can
 * approve, how much needs sign-off, its daily limits and its project. New team and a team's settings share it; a team's
 * place is fixed once made.
 */
export function TeamForm(p: { team?: Team; agents: TeamsReply['agents']; projects: WorkspaceRow[]; project?: WorkspaceRow; onSaved: (t: Team) => void; onCancel: () => void; onNewAgent: () => void; onDeleted?: () => void }) {
  const notify = useNotify();
  const t = p.team;
  const [name, setName] = useState(t?.name ?? '');
  const [place, setPlace] = useState<Place>(t?.place ?? 'tether');
  const [agents, setAgents] = useState<string[]>(t?.agents ?? []);
  const [chosen, setChosen] = useState(t ? t.approvers !== 'any' : false);
  const [level, setLevel] = useState<Level>(t?.level ?? 'balanced');
  const [usd, setUsd] = useState(String(t?.limits.usdPerDay ?? 10));
  const [runs, setRuns] = useState(String(t?.limits.runsPerDay ?? 20));
  const [project, setProject] = useState(t?.project ?? p.project?.id ?? p.projects[0]?.id ?? '');
  const [learn, setLearn] = useState(t?.learn ?? true);
  const [busy, setBusy] = useState(false);
  const ids = { agents: useId(), approve: useId() };
  const toggle = (id: string) => setAgents((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const ok = !!name.trim() && agents.length > 0 && !!project && Number(usd) > 0 && Number(runs) >= 1;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    // a Tether team's only person is you: "chosen people" means you
    const body = { name: name.trim(), place, project, agents, approvers: chosen ? ['owner'] : 'any', level, limits: { usdPerDay: Number(usd), runsPerDay: Number(runs) }, learn };
    try {
      p.onSaved(t ? await teamsApi.patch(t.id, body) : await teamsApi.create(body));
    } catch (err) {
      notify.fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="tm-form" aria-label={t ? `${t.name} settings` : 'New team'} onSubmit={(e) => void submit(e)}>
      <div className="tm-form-top">
        <h1>{t ? 'Team settings' : 'New team'}</h1>
        <Button type="button" variant="secondary" size="sm" onClick={p.onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!ok} loading={busy}>
          {t ? 'Save' : 'Create team'}
        </Button>
      </div>
      <Input label="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      {t ? (
        <p className="tm-form-note">Lives in {PLACE[t.place]}.</p>
      ) : (
        <fieldset className="tm-fieldset">
          <legend>Where it lives</legend>
          <RadioCards aria-label="Where it lives" options={PLACES} value={place} onValueChange={(v) => setPlace(v as Place)} layout="grid" />
        </fieldset>
      )}
      <fieldset className="tm-fieldset" aria-describedby={ids.agents}>
        <legend>Agents · they keep one memory across all their teams</legend>
        <div className="tm-agents">
          {p.agents.map((a) => (
            <label key={a.id} className="tm-agent">
              <input type="checkbox" checked={agents.includes(a.id)} onChange={() => toggle(a.id)} />
              <Face id={a.id} size={28} />
              <span>
                <b>{a.name}</b>
                <span>{a.specialty}</span>
              </span>
            </label>
          ))}
        </div>
        <button type="button" className="tm-link" id={ids.agents} onClick={p.onNewAgent}>
          + New agent…
        </button>
      </fieldset>
      <div className="tm-form-pair">
        <fieldset className="tm-fieldset">
          <legend>Who can approve</legend>
          <label className="tm-radio">
            <input type="radio" name={ids.approve} checked={!chosen} onChange={() => setChosen(false)} /> Any teammate in the channel
          </label>
          <label className="tm-radio">
            <input type="radio" name={ids.approve} checked={chosen} onChange={() => setChosen(true)} /> Chosen people: you
          </label>
          <span className="tm-form-note">Tether checks who pressed the button.</span>
        </fieldset>
        <fieldset className="tm-fieldset">
          <legend>How much needs sign-off</legend>
          <SegmentedControl label="Approval level" options={LEVELS.map((l) => ({ value: l.id, label: l.label }))} value={level} onValueChange={(v) => setLevel(v as Level)} />
          <span className="tm-form-note">{LEVELS.find((l) => l.id === level)!.hint}</span>
        </fieldset>
      </div>
      <fieldset className="tm-fieldset tm-limits">
        <legend>Limits for this team</legend>
        <Input label="Per day ($)" type="number" min={0.01} step="any" value={usd} onChange={(e) => setUsd(e.target.value)} />
        <Input label="Runs per day" type="number" min={1} step={1} value={runs} onChange={(e) => setRuns(e.target.value)} />
        <Select label="Project" options={p.projects.map((w) => ({ value: w.id, label: w.name }))} value={project} onValueChange={setProject} disabled={!!t} />
      </fieldset>
      <Switch label="Agents learn lessons from this team" checked={learn} onCheckedChange={setLearn} />
      {t && p.onDeleted ? (
        <div className="tm-form-danger">
          <ConfirmButton label="Delete team" prompt={`Delete ${t.name} and its messages? Its open loops stop; runs already going finish.`} confirmLabel="Delete" variant="danger" onConfirm={() => teamsApi.remove(t.id).then(p.onDeleted, notify.fail)} />
        </div>
      ) : null}
    </form>
  );
}

/** New team (board 2), as its own screen. */
export function NewTeam(p: { agents: TeamsReply['agents']; projects: WorkspaceRow[]; project?: WorkspaceRow; onCreated: (id: string) => void; onCancel: () => void; onNewAgent: () => void }) {
  return (
    <div className="tm-new">
      <TeamForm agents={p.agents} projects={p.projects} project={p.project} onSaved={(t) => p.onCreated(t.id)} onCancel={p.onCancel} onNewAgent={p.onNewAgent} />
    </div>
  );
}
