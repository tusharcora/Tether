import { useState } from 'react';
import { api } from '../api';
import { Button } from '../components/arc/button/button';
import { Input } from '../components/arc/input/input';
import { Select } from '../components/arc/select/select';
import { ConfirmButton } from '../ui/ConfirmButton';
import { Panel } from '../ui/studio/Panel';
import { StatusChip } from '../ui/studio/StatusChip';
import type { TestResult, Trigger } from './types';

/** Ask GitHub about a PR and say what the trigger would do (dry run), or start the run for real after confirming. */
export function TriggerTest(p: { triggers: Trigger[]; testId: string; onTestId: (id: string) => void; onFired: () => Promise<void> }) {
  const [pr, setPr] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [err, setErr] = useState('');
  async function run(fire: boolean) {
    setTesting(true);
    setErr('');
    setResult(null);
    try {
      setResult(await api<TestResult>('POST', `/api/triggers/${encodeURIComponent(p.testId)}/test`, { pr: pr.trim(), fire }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      if (fire) await p.onFired();
      setTesting(false);
    }
  }
  const blocked = testing || !pr.trim() || !p.testId;
  return (
    <Panel title="Test a trigger" className="tg-test">
      <p className="sl-summary">Paste a PR link (or a number for a single-repo trigger). A dry run only reports what would happen. Event filters are not checked, since GitHub supplies the action on real events.</p>
      {p.triggers.length ? (
        <>
          <div className="tg-test-fields">
            <Select label="Trigger to test" value={p.testId} onValueChange={p.onTestId} options={p.triggers.map((t) => ({ value: t.id, label: t.id }))} />
            <Input id="tg-pr" label="Pull request" placeholder="https://github.com/owner/repo/pull/12" value={pr} spellCheck={false} onChange={(e) => setPr(e.target.value)} />
          </div>
          <div className="tg-actions">
            <Button variant="primary" disabled={blocked} onClick={() => void run(false)}>
              Dry run
            </Button>
            {/* keyed on the PR so editing it cancels a pending "fire" question */}
            <ConfirmButton key={pr} variant="secondary" label="Fire for real…" prompt="Start a real run on this PR?" confirmLabel="Yes, fire" disabled={blocked} onConfirm={() => run(true)} />
            {testing ? <span className="sl-meta">asking GitHub…</span> : null}
          </div>
          {err ? (
            <p className="sl-alert" role="alert">
              {err}
            </p>
          ) : null}
          {result ? (
            <div className="tg-result" role="status">
              <StatusChip tone={result.matches ? 'done' : 'needs'} label={result.fired ? 'run started' : result.matches ? 'would run' : 'would be ignored'} />
              <p>
                <b>
                  {result.pr.repo}#{result.pr.number}
                </b>{' '}
                <span className="sl-meta">"{result.pr.title.slice(0, 70)}"</span>
              </p>
              <p>
                {result.fired ? `Started run ${result.runId}. ` : result.matches ? 'Would start a run. Nothing was started (dry run). ' : 'Would be ignored: '}
                {result.matches ? '' : result.why}
                {result.runId ? <a href={`#/runs/${result.runId}`}>Open the run</a> : null}
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <p className="sl-meta">Add a trigger first.</p>
      )}
    </Panel>
  );
}
