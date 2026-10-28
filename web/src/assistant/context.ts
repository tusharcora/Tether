import { TAB_LABEL, type Route, type Screen } from '../hooks';
import type { AssistantContext } from './api';

/** What the person is looking at, from the route: the page and the run, file, note, request, workflow or bot on it. */
export function contextOf(route: Route & { tab: Screen }): AssistantContext {
  const id = route.id;
  const kind = { runs: 'run', code: 'file', graph: 'note', api: 'request', builder: 'workflow', crew: 'bot' } as const;
  const k = kind[route.tab as keyof typeof kind];
  return { page: route.tab, ...(k && id ? { selection: { kind: k, id, ...(route.tab === 'code' && route.line ? { line: route.line } : {}) } } : {}) };
}

/** The panel header's context line: "knows orders-api · sees the Runs page". */
export const contextLine = (project: string | undefined, page: Screen) => `${project ? `knows ${project}` : 'no project open'} · sees the ${TAB_LABEL[page]} page`;
