/** The saved requests an agent may run, as a fenced data block for its prompt: names and notes only, never values. */
import { fence } from '../fence.js';
import { listRequests } from './store.js';

export const MAX_ENDPOINTS = 40;
export const MAX_ENDPOINT_BYTES = 4096;

export function endpointsBlock(dir: string): string | undefined {
  const reqs = listRequests(dir).filter((r) => !r.invalid);
  if (!reqs.length) return undefined;
  const w = Math.min(32, Math.max(...reqs.map((r) => r.id.length)));
  const lines: string[] = [];
  let bytes = 0;
  for (const r of reqs) {
    if (lines.length >= MAX_ENDPOINTS) break;
    const line = `${r.id.padEnd(w)}  ${r.method.padEnd(6)} ${r.url}  ${(r.note ?? r.name).slice(0, 80)}`;
    if (bytes + line.length + 1 > MAX_ENDPOINT_BYTES) continue; // one long entry does not hide the ones after it
    lines.push(line);
    bytes += line.length + 1;
  }
  const shown = lines.length;
  if (shown < reqs.length) lines.push(`… ${reqs.length - shown} more not shown (aorch http ls lists them all)`);
  return `# Saved API requests (data)\n${fence('api-endpoints', lines.join('\n'))}\nRun one with: aorch http run <id> [--env <name>]`;
}
