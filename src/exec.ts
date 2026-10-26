/** Running `gh`/`git` for PR triggers, accounts and Code Mode's github connector; tests replace it. */
import { runProcess } from './proc.js';

/** `env` is added to this process's environment (the connected GitHub account's GH_TOKEN). */
export type Exec = (cmd: string, args: string[], cwd?: string, stdin?: string, env?: Record<string, string>) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export const defaultExec: Exec = async (cmd, args, cwd = process.cwd(), stdin, env) => {
  const r = await runProcess({ cmd, args, cwd, stdin, maxBuffer: 8_000_000, ...(env ? { env: { ...process.env, ...env } } : {}) });
  return { code: r.code, stdout: r.stdout, stderr: r.spawnError ?? r.stderr };
};
