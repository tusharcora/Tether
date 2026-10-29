import { useState } from 'react';
import { CREDITS_URL } from '../../../src/openrouter';
import { clock, type RunView } from '../api';
import { Button } from '../components/beui/kit/Button';
import { ModelPicker } from '../crew/ModelPicker';
import type { AgentInfo } from '../crew/types';
import { crewFor, useCrew } from '../crewStore';
import { usePoll } from '../hooks';
import type { RunAct } from '../Runs';

/** The steps of a paused run that wait for the free requests to come back. */
export const limitedSteps = (r: RunView) => (r.status === 'paused' ? r.pipeline.nodes.filter((n) => r.nodes[n.id]?.status === 'awaiting' && r.nodes[n.id]?.limit) : []);

/**
 * Out of free requests (free models spec §7.7, board 4), in the approval bar's place: the run resumes by itself after the
 * reset (the server's timer), or now on another model (this run only), or after adding credits and pressing Resume.
 */
export function LimitBar({ run: r, onAct }: { run: RunView; onAct: RunAct }) {
  const { crew } = useCrew();
  const [switching, setSwitching] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [credits, setCredits] = useState(false);
  const bots = usePoll<{ agents: Record<string, AgentInfo> }>(switching ? '/api/bots' : null, 60_000);
  const steps = limitedSteps(r);
  if (!steps.length) return null;
  const at = clock(Math.max(...steps.map((n) => r.nodes[n.id]!.limit!.resetsAt)));
  const who = crew[crewFor(steps[0]!, crew)]?.name ?? steps[0]!.id;
  return (
    <div className="run-approve run-limit">
      <div className="run-approve-q">
        <b>Out of free requests for today</b>
        <span>{credits ? 'Added credits? Resume carries on with the new limit.' : waiting ? `${who} picks up where it stopped at ${at}.` : `${who} picks up where it stopped at ${at}, or keep going now on another model.`}</span>
      </div>
      <Button variant="secondary" size="sm" onClick={() => (window.open(CREDITS_URL, '_blank', 'noopener'), setCredits(true))}>
        Add credits ↗
      </Button>
      <Button variant="secondary" size="sm" aria-expanded={switching} onClick={() => setSwitching((s) => !s)}>
        Switch model…
      </Button>
      {credits ? (
        <Button variant="primary" size="sm" onClick={() => void onAct('resume')}>
          Resume
        </Button>
      ) : (
        // the server already resumes the run after the reset: waiting only says so
        <Button variant="primary" size="sm" disabled={waiting} onClick={() => setWaiting(true)}>
          Wait until {at}
        </Button>
      )}
      {switching ? (
        <div className="run-limit-pick">
          <ModelPicker value={steps[0]!.model ?? ''} agents={bots.data?.agents ?? {}} writes={steps.some((n) => !n.readOnly)} defaultOpen onPick={(b) => void onAct('resume', b.model ? b : { agent: b.agent })} />
        </div>
      ) : null}
    </div>
  );
}
