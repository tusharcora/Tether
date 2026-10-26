/** Programs Tether looks for on this machine besides the agent CLIs (which their adapters detect): ripgrep, for code search. */
import { execFileSync } from 'node:child_process';

let rg: { version?: string } | undefined;

/** ripgrep's version when `rg` is on PATH, else undefined. Looked up once per process. */
export function rgVersion(): string | undefined {
  if (!rg) {
    try {
      const out = execFileSync('rg', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString();
      rg = { version: /ripgrep (\S+)/.exec(out)?.[1] ?? 'unknown' };
    } catch {
      rg = {};
    }
  }
  return rg.version;
}
