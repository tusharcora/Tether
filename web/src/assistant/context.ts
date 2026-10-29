import { TAB_LABEL, type Route, type Screen } from '../hooks';
import { shortRunId } from '../ui/studio/RunGlyph';
import type { AssistantContext } from './api';

/** What the person is looking at, from the route: the page and the run, file, note, request, workflow or bot on it. */
export function contextOf(route: Route & { tab: Screen }): AssistantContext {
  const id = route.id;
  const kind = { runs: 'run', code: 'file', graph: 'note', api: 'request', builder: 'workflow', crew: 'bot' } as const;
  const k = kind[route.tab as keyof typeof kind];
  return { page: route.tab, ...(k && id ? { selection: { kind: k, id, ...(route.tab === 'code' && route.line ? { line: route.line } : {}) } } : {}) };
}

/** The mini chat's context line: "Sees: Runs · R-4F21", "Sees: Code · limit.ts". */
export function contextLine(route: Route & { tab: Screen }): string {
  const sel = contextOf(route).selection;
  return `Sees: ${TAB_LABEL[route.tab]}${sel ? ` · ${sel.kind === 'run' ? shortRunId(sel.id) : sel.id.split('/').pop()}` : ''}`;
}
