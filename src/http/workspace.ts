/** Which project (folder, secrets scope) an API client call is about: from ?ws= on the server, from the current directory in the CLI. */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { listWorkspaces, resolveWorkspace, WS_DIR } from '../workspace.js';
import { HttpClientError } from './errors.js';

export interface HttpProject {
  /** Secrets scope and history key: the workspace id, or "default". */
  scope: string;
  workspaceId?: string;
  /** Folder whose .aorch/http holds the requests. */
  dir: string;
  /** Folder whose environments apply (the workspace's own folder, even when `dir` is a run's worktree). */
  envDir: string;
}

/** ?ws=<id>, else the default workspace, else the first one, else undefined (the route answers 409 "no workspace"). */
export function projectFor(home: string, id?: string | null): HttpProject | undefined {
  const all = listWorkspaces(home);
  const w = id ? all.find((x) => x.id === id) : (all.find((x) => x.isDefault) ?? all[0]);
  if (id && !w) throw new HttpClientError('not_found', `unknown workspace "${id}"`);
  return w ? { scope: w.id, workspaceId: w.id, dir: w.path, envDir: w.path } : undefined;
}

/** The main checkout a git worktree belongs to (runs execute in worktrees under <home>/worktrees). */
function mainCheckout(dir: string): string | undefined {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
    return common.endsWith('/.git') ? dirname(common) : undefined;
  } catch {
    return undefined;
  }
}

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/**
 * For the CLI and agents: the nearest folder at or above `cwd` that has .aorch/, and the registered workspace it belongs
 * to (directly, or through the main checkout of the git worktree it is in), the same lookup runs use. Unregistered: scope "default".
 * The aorch home (~/.aorch) is never a project: the folder holding it is skipped and the search stops there, and running
 * from that folder itself is refused, so nothing reads or writes requests in <home>/http.
 */
export function projectFromCwd(home: string, cwd: string, explicit?: string): HttpProject {
  if (explicit) return projectFor(home, explicit)!;
  const start = resolve(cwd);
  const homeReal = real(home);
  const isHome = (d: string) => real(join(d, WS_DIR)) === homeReal;
  let dir = start;
  for (let d = start; ; d = dirname(d)) {
    if (existsSync(join(d, WS_DIR))) {
      if (!isHome(d)) dir = d;
      break;
    }
    if (dirname(d) === d) break;
  }
  if (isHome(dir)) throw new HttpClientError('invalid', `${dir} holds ${home}, which is the aorch home, not a project; run this inside a project folder`);
  const registered = (repo: string) => {
    try {
      const w = resolveWorkspace(home, { repo });
      return w && w.id !== 'local' ? w : undefined;
    } catch {
      return undefined;
    }
  };
  const main = mainCheckout(dir);
  const w = registered(dir) ?? (main ? registered(main) : undefined);
  return w ? { scope: w.id, workspaceId: w.id, dir, envDir: w.path } : { scope: 'default', dir, envDir: dir };
}
