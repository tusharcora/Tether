import { ago, type VaultActivityItem, type VaultNote } from '../api';
import { Button } from '../components/arc/button/button';
import { Loading } from '../components/Loading';
import { cn } from '../ui/cn';
import { InlineError } from '../ui/studio/InlineError';
import { SectionHeading } from '../ui/studio/SectionHeading';
import { GLYPH, typeOf, type GraphType } from './graphModel';

export interface ReaderLink {
  id: string;
  title: string;
  type: GraphType;
  /** → the note links to it; ← it links to the note. */
  dir: '→' | '←';
}

/** The selected note: path, title, tags (a click searches them), body, who wrote it last, and what it connects to. */
export function NoteReader(p: {
  path?: string;
  note?: VaultNote;
  state: 'idle' | 'loading' | 'missing' | 'failed';
  missing: boolean;
  degree?: number;
  touch?: VaultActivityItem;
  fresh: boolean;
  links: ReaderLink[];
  onTag: (tag: string) => void;
  onGo: (id: string) => void;
  onHover: (id?: string) => void;
  onRetry: () => void;
  /** A file's note (`Files/<path>.md`) can open the file in Code. */
  onOpenFile?: (path: string) => void;
}) {
  if (!p.path) return <p className="gv-reader-empty">Select a note to read it and see what links to it.</p>;
  if (p.missing || p.state === 'missing')
    return (
      <p className="gv-reader-empty" role="status">
        That note is not in the vault.
      </p>
    );
  if (p.state === 'failed')
    return (
      <div className="gv-reader-empty">
        <InlineError message="The note could not be loaded." onRetry={p.onRetry} />
      </div>
    );
  const n = p.note;
  const t = typeOf(n?.type);
  return (
    <section className="gv-reader" aria-label="Reader" key={p.path}>
      <Loading loading={p.state === 'loading' || !n} lines={5} label="Loading the note">
        {n ? (
          <>
            <p className="gv-path">
              <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true">
                <path d={GLYPH[t]} className={cn('gv-glyph', { hollow: t === 'note' })} />
              </svg>
              <span>{n.path}</span>
            </p>
            <h2>{n.title}</h2>
            {p.onOpenFile && n.type === 'file' && n.path.startsWith('Files/') ? (
              <Button size="sm" variant="secondary" onClick={() => p.onOpenFile!(n.path.slice('Files/'.length).replace(/\.md$/, ''))}>
                Open in Code
              </Button>
            ) : null}
            {n.tags.length ? (
              <div className="gv-tags">
                {n.tags.map((tag) => (
                  <button key={tag} type="button" onClick={() => p.onTag(tag)}>
                    #{tag}
                  </button>
                ))}
              </div>
            ) : null}
            <pre className="gv-text">{n.body.slice(0, 6000)}</pre>
            <p className="sl-meta">
              {p.degree ?? 0} link{p.degree === 1 ? '' : 's'}
              {p.touch ? ` · ${p.fresh ? `written by ${p.touch.run} just now` : `last written by ${p.touch.run} · ${ago(p.touch.ts)}`}` : ''}
            </p>
          </>
        ) : null}
      </Loading>
      {p.links.length ? (
        <div className="gv-connected">
          <SectionHeading title="Connected" count={p.links.length} />
          <ul className="sl-list">
            {p.links.map((l) => (
              <li key={`${l.dir}${l.id}`}>
                <button
                  type="button"
                  className="gv-link"
                  aria-label={`${l.dir === '→' ? 'links to' : 'linked from'} ${l.title}, ${l.type}`}
                  onClick={() => p.onGo(l.id)}
                  onPointerEnter={() => p.onHover(l.id)}
                  onPointerLeave={() => p.onHover(undefined)}
                  onFocus={() => p.onHover(l.id)}
                  onBlur={() => p.onHover(undefined)}
                >
                  <span className="gv-dir" aria-hidden="true">
                    {l.dir}
                  </span>
                  <span className="gv-link-title" aria-hidden="true">{l.title}</span>
                  <span className="gv-link-kind" aria-hidden="true">{l.type}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
