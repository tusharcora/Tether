import type { CodeFile, CodeLang, GitBadge, RunLock, RunTouch, TextHit, TreeEntry } from '../../../src/types.js';
import { api } from '../api';

export type { CodeFile, CodeLang, GitBadge, RunLock, RunTouch, TextHit, TreeEntry };

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

/** /api/code/*: every call names the project by its workspace id; paths are relative to its folder. */
export const codeApi = {
  tree: (ws: string, dir: string) => api<{ entries: TreeEntry[]; git: boolean; files?: number }>('GET', `/api/code/tree?${qs({ ws, dir })}`),
  file: (ws: string, path: string) => api<CodeFile>('GET', `/api/code/file?${qs({ ws, path })}`),
  /** Without `baseMtimeMs` the save overwrites whatever is on disk. */
  save: (ws: string, path: string, text: string, baseMtimeMs?: number) => api<{ path: string; mtimeMs: number; size: number }>('PUT', '/api/code/file', { ws, path, text, ...(baseMtimeMs !== undefined ? { baseMtimeMs } : {}) }),
  searchText: (ws: string, q: string) => api<{ hits: TextHit[]; truncated: boolean }>('GET', `/api/code/search?${qs({ ws, q, mode: 'text' })}`),
  searchNames: (ws: string, q: string) => api<{ hits: { path: string }[] }>('GET', `/api/code/search?${qs({ ws, q, mode: 'name' })}`),
  runsFor: (ws: string, path: string) => api<RunTouch[]>('GET', `/api/code/runs-for-file?${qs({ ws, path })}`),
  changed: (ws: string) => api<{ paths: string[] }>('GET', `/api/code/changed?${qs({ ws })}`),
};
