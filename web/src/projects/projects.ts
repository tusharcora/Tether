import { useCallback, useState } from 'react';
import { api, type Pin, type RunRow } from '../api';
import { pickWorkspace, storedWorkspace, storeWorkspace, WORKSPACES_MS, WORKSPACES_PATH, type WorkspaceRow } from '../home/workspaces';
import { usePoll, type Poll } from '../hooks';

export interface Projects {
  list: Poll<WorkspaceRow[]>;
  /** The project Code, the API tab, Home and the Runs filter work on. */
  current?: WorkspaceRow;
  select: (id: string) => void;
  /** Register a folder (Open folder…); registering one twice gives the same project. */
  register: (path: string) => Promise<WorkspaceRow>;
  /** Register a folder and make it current. */
  add: (path: string) => Promise<WorkspaceRow>;
  /** Forget a project (its folder stays). */
  remove: (id: string) => Promise<void>;
}

/** The registered projects and the current one (remembered on this device, falling back like the API tab: default, then first). */
export function useProjects(): Projects {
  const list = usePoll<WorkspaceRow[]>(WORKSPACES_PATH, WORKSPACES_MS);
  const [picked, setPicked] = useState(storedWorkspace);
  const select = useCallback((id: string) => {
    setPicked(id);
    storeWorkspace(id);
  }, []);
  const { refresh } = list;
  const register = useCallback(
    async (path: string) => {
      const w = await api<WorkspaceRow>('POST', WORKSPACES_PATH, { path });
      await refresh();
      return w;
    },
    [refresh],
  );
  const add = useCallback(
    async (path: string) => {
      const w = await register(path);
      select(w.id);
      return w;
    },
    [register, select],
  );
  const remove = useCallback(
    async (id: string) => {
      await api('DELETE', `${WORKSPACES_PATH}/${encodeURIComponent(id)}`);
      await refresh();
    },
    [refresh],
  );
  return { list, current: pickWorkspace(list.data ?? [], picked), select, register, add, remove };
}

const inside = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith('/') ? parent : `${parent}/`);

/** The registered project that holds a folder (the deepest wins, as the server's run lookup does). */
export const projectOf = (list: WorkspaceRow[], dir: string): WorkspaceRow | undefined => list.filter((w) => inside(dir, w.path)).sort((a, b) => b.path.length - a.path.length)[0];

/** Ids of the projects with a live run (the sidebar's blue dots). */
export const liveProjects = (list: WorkspaceRow[], runs: RunRow[]): Set<string> => new Set(runs.filter((r) => r.live).flatMap((r) => projectOf(list, r.repo)?.id ?? []));

/** Runs started in a project's folder (the Runs screen's "only this project" filter). */
export const runsIn = (rows: RunRow[], w: WorkspaceRow): RunRow[] => rows.filter((r) => projectOf([w], r.repo));

export const samePin = (a: Pin, b: Pin) => a.kind === b.kind && a.id === b.id && (a.ws ?? '') === (b.ws ?? '');

/** The pinned runs and requests, and a save that replaces the list. */
export function usePins(): { pins: Pin[]; save: (next: Pin[]) => Promise<void> } {
  const poll = usePoll<{ pins: Pin[] }>('/api/pins', 60_000);
  const { refresh } = poll;
  const save = useCallback(
    async (next: Pin[]) => {
      await api('PUT', '/api/pins', { pins: next });
      await refresh();
    },
    [refresh],
  );
  return { pins: poll.data?.pins ?? [], save };
}
