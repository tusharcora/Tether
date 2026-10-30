import type { Route } from '../hooks';
import { Button } from '../components/beui/kit/Button';
import { Face, moodFor } from '../Face';
import { AgentProfile } from './AgentProfile';
import { STATE_LABEL, type TeamsReply } from './teamsApi';

/** An agent's own page (`#/agents/<id>`), opened from the sidebar: who it is and what it is doing now, then its profile (memory, squads, recent work). Look and persona stay in Crew. */
export function AgentPage({ id, agents, onGo }: { id: string; agents: TeamsReply['agents']; onGo: (r: Route) => void }) {
  const a = agents.find((x) => x.id === id);
  const name = a?.name ?? id;
  const busy = !!a?.state && a.state !== 'idle';
  const doing = busy ? `${STATE_LABEL[a!.state!] ?? a!.state}${a!.line ? ` · ${a!.line}` : ''}` : 'free';
  return (
    <div className="agent-page">
      <header className="agent-page-head">
        <Face id={id} size={64} label="" mood={busy ? moodFor('running') : undefined} animate={busy ? 'always' : undefined} />
        <div className="agent-page-who">
          <h1>{name}</h1>
          <p>
            {a?.specialty ? `${a.specialty} · ` : ''}
            <span className={busy ? 'agent-page-busy' : undefined}>{doing}</span>
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onGo({ tab: 'crew', id })}>
          Edit look and persona in Crew
        </Button>
      </header>
      <AgentProfile key={id} bot={id} name={name} title={a?.specialty ?? ''} />
    </div>
  );
}
