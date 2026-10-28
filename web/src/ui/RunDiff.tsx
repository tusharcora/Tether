import { useMemo } from 'react';
import { FileDiff, type FileDiffLine } from '../components/beui/agents/file-diff';
import type { AgentCodeLanguage } from '../components/beui/agents/agent-code';

const MAX_LINES = 3000;

export interface DiffFile {
  file: string;
  lines: FileDiffLine[];
}

const LANG: Record<string, AgentCodeLanguage> = { ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', jsx: 'tsx', js: 'typescript', mjs: 'typescript', cjs: 'typescript', json: 'json', sh: 'bash', bash: 'bash', zsh: 'bash' };
const langOf = (file: string): AgentCodeLanguage => LANG[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'text';

/**
 * A unified diff as one entry per file, each line typed (added, removed, context) with its old and new line numbers.
 * Text with no `diff --git` header (a bare patch) becomes one file called "changes". Stops after `limit` lines in all.
 */
export function parseDiff(text: string, limit = MAX_LINES): { files: DiffFile[]; truncated: boolean } {
  const files: DiffFile[] = [];
  let cur: DiffFile | undefined;
  let oldNo = 0;
  let newNo = 0;
  let count = 0;
  let truncated = false;
  const raw = text.split('\n');
  if (raw[raw.length - 1] === '') raw.pop();
  for (const l of raw) {
    const head = /^diff --git a\/.+? b\/(.+)$/.exec(l);
    if (head) {
      cur = { file: head[1]!, lines: [] };
      files.push(cur);
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (!cur && !hunk && (l.startsWith('--- ') || l.startsWith('+++ ') || l.startsWith('index '))) continue;
    if (cur && /^(index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|rename (from|to)|Binary files)/.test(l) && cur.lines.length === 0) continue;
    if (!cur) {
      cur = { file: 'changes', lines: [] };
      files.push(cur);
    }
    if (count >= limit) {
      truncated = true;
      break;
    }
    count++;
    const id = `${files.length}-${cur.lines.length}`;
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      cur.lines.push({ id, type: 'context', content: l });
    } else if (l.startsWith('+')) cur.lines.push({ id, type: 'added', newLine: newNo++, content: l.slice(1) });
    else if (l.startsWith('-')) cur.lines.push({ id, type: 'removed', oldLine: oldNo++, content: l.slice(1) });
    else if (l.startsWith('\\')) cur.lines.push({ id, type: 'context', content: l });
    else cur.lines.push({ id, type: 'context', oldLine: oldNo++, newLine: newNo++, content: l.startsWith(' ') ? l.slice(1) : l });
  }
  return { files: files.filter((f) => f.lines.length > 0), truncated };
}

/** A unified diff drawn with beui's file-diff: one disclosure per file with live +/− counts, line numbers and highlighting. */
export function RunDiff({ text, onCopyFile }: { text: string; onCopyFile?: () => void }) {
  const { files, truncated } = useMemo(() => parseDiff(text), [text]);
  if (!files.length) return null;
  return (
    <div className="grid min-w-0 gap-2" aria-label="Changes">
      {files.map((f, i) => (
        <FileDiff key={`${f.file}-${i}`} file={f.file} lines={f.lines} status="complete" defaultOpen={i < 3} maxHeight={360} language={langOf(f.file)} copyText={f.lines.filter((l) => l.type !== 'removed').map((l) => l.content).join('\n')} onCopy={onCopyFile} />
      ))}
      {truncated ? <p className="m-0 text-xs text-muted-foreground">… diff truncated in the viewer; use git to see all of it …</p> : null}
    </div>
  );
}
