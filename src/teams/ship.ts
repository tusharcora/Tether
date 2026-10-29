/**
 * Shipping a team run (spec §6.3): push the run's branch to `origin` and open a GitHub PR with `gh` (the connected account
 * rides along through `ghExec`); later, merge it once its checks pass. Every failure comes back as text to post, never thrown
 * past the caller: a ship that cannot happen leaves the branch where it is.
 */
import type { Exec } from '../exec.js';
import { git } from '../git.js';

const first = (s: string) => s.trim().split('\n')[0]!.slice(0, 200);
const ghWhy = (r: { code: number | null; stdout: string; stderr: string }) =>
  /ENOENT|not found/i.test(r.stderr) && !r.stdout ? 'the GitHub CLI (gh) is not installed. Install it from https://cli.github.com and run: gh auth login' : first(r.stderr) || `gh exited ${r.code}`;

export async function shipBranch(o: { repo: string; branch: string; base: string; title: string; body: string; exec: Exec }): Promise<{ url: string; number: number } | { error: string }> {
  const ahead = await git(o.repo, ['rev-list', '--count', `${o.base}..${o.branch}`]);
  if (ahead.code !== 0) return { error: `Could not read ${o.branch}: ${first(ahead.stderr)}` };
  if (Number(ahead.stdout.trim()) === 0) return { error: 'Nothing to ship: the run changed no files.' };
  const push = await git(o.repo, ['push', '--quiet', 'origin', `${o.branch}:${o.branch}`]);
  if (push.code !== 0) return { error: `Could not push ${o.branch}: ${first(push.stderr)}` };
  const pr = await o.exec('gh', ['pr', 'create', '--head', o.branch, '--title', o.title, '--body', o.body], o.repo);
  if (pr.code !== 0) return { error: `Pushed ${o.branch}, but could not open a PR: ${ghWhy(pr)}` };
  const m = /https:\/\/\S+\/pull\/(\d+)/.exec(pr.stdout);
  return m ? { url: m[0], number: Number(m[1]) } : { error: `Pushed ${o.branch}, but gh named no pull request` };
}

const FAILED = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']);

/** The PR's checks: all passed (or none), some still running, one failed, or the PR is already merged. Throws when gh cannot tell. */
export async function prChecks(url: string, exec: Exec): Promise<'pass' | 'pending' | 'fail' | 'merged'> {
  const r = await exec('gh', ['pr', 'view', url, '--json', 'state,statusCheckRollup']);
  if (r.code !== 0) throw new Error(ghWhy(r));
  const j = JSON.parse(r.stdout) as { state?: string; statusCheckRollup?: { __typename?: string; status?: string; conclusion?: string; state?: string }[] };
  if (j.state === 'MERGED') return 'merged';
  const checks = j.statusCheckRollup ?? [];
  if (checks.some((c) => FAILED.has(String(c.conclusion ?? c.state ?? '')))) return 'fail';
  const pending = checks.some((c) => (c.__typename === 'StatusContext' ? c.state !== 'SUCCESS' : c.status !== 'COMPLETED'));
  return pending ? 'pending' : 'pass';
}

/** Merge with a merge commit; the reason it could not, or undefined. */
export async function mergePr(url: string, exec: Exec): Promise<string | undefined> {
  const r = await exec('gh', ['pr', 'merge', url, '--merge']);
  return r.code === 0 ? undefined : ghWhy(r);
}
