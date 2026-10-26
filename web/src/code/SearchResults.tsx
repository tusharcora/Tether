import { Loading } from '../components/Loading';
import { InlineError } from '../ui/studio/InlineError';
import type { TextHit } from './codeApi';

/** Text search results in the tree's place, grouped by file; a hit opens its file at the line. */
export function SearchResults(p: { q: string; result?: { hits: TextHit[]; truncated: boolean }; error?: string; onRetry: () => void; onOpen: (path: string, line: number) => void }) {
  if (p.error) return <InlineError message={p.error} onRetry={p.onRetry} />;
  const groups = new Map<string, TextHit[]>();
  for (const h of p.result?.hits ?? []) groups.set(h.path, [...(groups.get(h.path) ?? []), h]);
  const n = p.result?.hits.length ?? 0;
  return (
    <Loading loading={!p.result} lines={5} label="Searching">
      {p.result ? (
        <div className="code-hits">
          <p className="code-hits-count" role="status">
            {n ? `${n}${p.result.truncated ? '+' : ''} match${n === 1 ? '' : 'es'}` : `No matches for “${p.q}”`} · secrets files skipped
          </p>
          {[...groups].map(([path, hits]) => (
            <section key={path} className="code-hit-group" aria-label={path}>
              <h3>{path}</h3>
              {hits.map((h) => (
                <button key={`${h.line}:${h.col}`} type="button" className="code-hit" onClick={() => p.onOpen(h.path, h.line)}>
                  <span className="code-hit-at">
                    {path}:{h.line}
                  </span>
                  <span className="code-hit-text">
                    {h.text.slice(0, h.col).trimStart()}
                    <mark>{h.text.slice(h.col, h.col + p.q.length)}</mark>
                    {h.text.slice(h.col + p.q.length)}
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </Loading>
  );
}
