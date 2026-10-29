/**
 * Artifacts in a reply's text: `<artifact title="…" kind="html|markdown" id="…">` then the raw content, then `</artifact>`.
 * Nothing is escaped, so a whole HTML page or a Markdown doc with its own ``` fences fits (a fenced block could not hold
 * those). Pure, no Node: the server cuts and saves them (reply.ts, turn.ts) and the dashboard reads a streaming reply
 * with the same parser, so the raw content never shows in the thread.
 */
export type ArtifactKind = 'html' | 'markdown';

export interface ArtifactBlock {
  /** An artifact the reply rewrites (a new version); absent: a new artifact. */
  id?: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  /** No closing tag (yet): still streaming, or the reply was cut off. */
  open?: true;
}

const OPEN = /<artifact\b([^>]*)>/g;
const CLOSE = '</artifact>';
const ATTR = /([\w-]+)\s*=\s*"([^"]*)"/g;
const ENT: Record<string, string> = { '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };
const unescape = (s: string) => s.replace(/&(quot|#39|lt|gt|amp);/g, (e) => ENT[e]!);
/** Models like to wrap the page in a ```html fence inside the tag too: one wrapping fence (html, markdown or bare) goes. */
const WRAP = /^```(?:html|markdown|md)?[ \t]*\n([\s\S]*)\n```$/;

export const wordCount = (s: string): number => s.split(/\s+/).filter(Boolean).length;

function block(attrs: string, raw: string, open: boolean): ArtifactBlock {
  const a = Object.fromEntries([...attrs.matchAll(ATTR)].map((m) => [m[1]!.toLowerCase(), unescape(m[2]!)]));
  let content = raw.replace(/^[ \t]*\r?\n/, '').trimEnd();
  if (!open) content = WRAP.exec(content.trim())?.[1] ?? content;
  const k = (a.kind ?? a.type ?? '').toLowerCase();
  const kind: ArtifactKind = k === 'html' ? 'html' : k === 'markdown' || k === 'md' ? 'markdown' : /^\s*</.test(content) ? 'html' : 'markdown';
  const title = (a.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
  const id = (a.id ?? a.identifier)?.trim();
  return { ...(id ? { id } : {}), title, kind, content, ...(open ? { open: true as const } : {}) };
}

/**
 * The text with every artifact cut out, and the artifacts in order. An unclosed one runs to the end (or to a trailing
 * ```tether block), and an opening tag still being written ("<artif…") is held back, as the ```tether fence is.
 */
export function splitArtifacts(text: string): { text: string; artifacts: ArtifactBlock[] } {
  const artifacts: ArtifactBlock[] = [];
  let out = '';
  let at = 0;
  for (;;) {
    OPEN.lastIndex = at;
    const m = OPEN.exec(text);
    if (!m) break;
    out += text.slice(at, m.index);
    const start = m.index + m[0].length;
    const end = text.indexOf(CLOSE, start);
    if (end >= 0) {
      artifacts.push(block(m[1]!, text.slice(start, end), false));
      at = end + CLOSE.length;
      continue;
    }
    const fence = text.indexOf('```tether', start);
    artifacts.push(block(m[1]!, text.slice(start, fence >= 0 ? fence : text.length), true));
    at = fence >= 0 ? fence : text.length;
    break;
  }
  out += text.slice(at);
  const lt = out.lastIndexOf('<');
  if (lt >= 0 && !out.includes('>', lt) && '<artifact'.startsWith(out.slice(lt, lt + 9))) out = out.slice(0, lt);
  return { text: out, artifacts };
}
