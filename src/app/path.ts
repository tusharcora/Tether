/**
 * Apps opened from the Finder or the Dock don't inherit the shell's PATH, so agent CLIs (claude, codex, …) and rg would
 * not be found. Tether asks the login shell for its PATH once at launch and merges it in.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';

const MARK = '__TETHER_PATH__';
const SHELL_MS = 3000;

/** The command a login shell runs: PATH between two markers, so greetings and prompts printed around it are ignored. */
export const PRINT_PATH = `printf '${MARK}%s${MARK}' "$PATH"`;

/** The PATH a login shell printed with PRINT_PATH, or undefined when the markers are missing. */
export function loginPath(out: string): string | undefined {
  const m = new RegExp(`${MARK}(.*?)${MARK}`, 's').exec(out);
  return m?.[1]?.trim() || undefined;
}

/** Folders where agent CLIs usually live, used when the login shell gives nothing. */
export const fallbackDirs = (home: string): string[] => ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local/bin'), join(home, '.npm-global/bin')];

/** The login shell's PATH first (or the fallback folders), then whatever the app already had; each folder once, empties dropped. */
export function mergePaths(login: string | undefined, current: string, home: string): string {
  const first = login ? login.split(':') : fallbackDirs(home);
  return [...new Set([...first, ...current.split(':')].filter(Boolean))].join(':');
}

/** Run the user's login shell once (3 s at most) and resolve the merged PATH; never rejects. */
export function shellPath(env: NodeJS.ProcessEnv = process.env, home = env.HOME ?? ''): Promise<string> {
  return new Promise((resolve) => {
    execFile(env.SHELL || '/bin/zsh', ['-ilc', PRINT_PATH], { timeout: SHELL_MS, env }, (err, stdout) => {
      resolve(mergePaths(err ? undefined : loginPath(String(stdout)), env.PATH ?? '', home));
    });
  });
}
