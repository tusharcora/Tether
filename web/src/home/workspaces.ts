export interface WorkspaceRow { id: string; name: string; path: string; isDefault: boolean; exists: boolean; repos: string[] }

/** Home polls the workspace list once and hands it to every section that needs it. */
export const WORKSPACES_PATH = '/api/workspaces';
export const WORKSPACES_MS = 30_000;

/** The API tab's workspace choice (shared with Home). */
export const WS_KEY = 'aorch.api.ws';

export function storedWorkspace(): string | undefined {
  try {
    return localStorage.getItem(WS_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The picked workspace, else the API tab's choice, else the default, else the first. An id that is no longer listed falls through. */
export function pickWorkspace(list: WorkspaceRow[], picked?: string): WorkspaceRow | undefined {
  const byId = (id?: string) => (id ? list.find((w) => w.id === id) : undefined);
  return byId(picked) ?? byId(storedWorkspace()) ?? list.find((w) => w.isDefault) ?? list[0];
}
