import { ChevronLeft, ChevronRight, Download, FolderOpen, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { assistantApi, type ArtifactKind, type ArtifactRef, type ArtifactView } from '../assistant/api';
import { Markdown } from '../assistant/Markdown';
import { bridge } from '../bridge';
import { ErrorState } from '../components/assistant-ui/elements/error-state';
import { CodeBlock } from '../components/beui/agents/code-block';
import { CopyButton } from '../components/beui/kit/CopyButton';
import { SegmentedControl } from '../components/beui/kit/controls';

export const KIND_LABEL: Record<ArtifactKind, string> = { html: 'HTML', markdown: 'Markdown' };

/** The card's line: "HTML · v2 · API". */
export const artifactMeta = (a: Pick<ArtifactRef, 'kind' | 'version'>, project?: string) => `${KIND_LABEL[a.kind]} · v${a.version}${project ? ` · ${project}` : ''}`;

/** A version's own kind (a rewrite may change it): its file's extension. */
const kindOf = (v: ArtifactView): ArtifactKind => (v.meta.versions.find((x) => x.n === v.version)?.file.endsWith('.html') ? 'html' : 'markdown');

const icon = 'grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40';

/**
 * One artifact, like Claude's side panel: its title and project, the version switcher (‹ v2 of 3 ›), Preview or Code,
 * Copy, Download, Show in Finder (Tether.app only) and Close. An HTML page previews in an iframe sandboxed to scripts
 * alone: no same origin, so it cannot reach the parent page or Tether's API (the server refuses its `null` origin too).
 */
export function ArtifactViewer(p: { ws?: string; id: string; version?: number; project?: string; onClose: () => void }) {
  const [n, setN] = useState(p.version);
  useEffect(() => setN(p.version), [p.id, p.version]);
  const [view, setView] = useState<ArtifactView>();
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  useEffect(() => {
    let live = true;
    setError(undefined);
    assistantApi.artifact(p.ws, p.id, n).then(
      (v) => live && setView(v),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [p.ws, p.id, n, nonce]);
  const v = view?.meta.id === p.id ? view : undefined;
  const at = v ? v.meta.versions.findIndex((x) => x.n === v.version) : -1;
  const step = (d: number) => {
    const next = v?.meta.versions[at + d];
    if (next) setN(next.n);
  };
  const kind = v ? kindOf(v) : undefined;
  const download = () => {
    if (!v) return;
    const url = URL.createObjectURL(new Blob([v.content], { type: kind === 'html' ? 'text/html' : 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${v.meta.id}-v${v.version}.${kind === 'html' ? 'html' : 'md'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const b = bridge();
  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-background" aria-label={`Artifact: ${v?.meta.title ?? p.id}`} data-artifact={p.id}>
      <header className="flex flex-none flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[13.5px] font-medium">{v?.meta.title ?? 'Loading…'}</p>
          {v ? <p className="m-0 truncate text-xs text-muted-foreground">{[KIND_LABEL[kind!], p.project].filter(Boolean).join(' · ')}</p> : null}
        </div>
        {v ? (
          <>
            <span className="flex items-center gap-0.5 text-xs tabular-nums text-muted-foreground">
              <button type="button" className={icon} aria-label="Previous version" disabled={at <= 0} onClick={() => step(-1)}>
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
              <span aria-live="polite">{`v${v.version} of ${v.meta.versions.length}`}</span>
              <button type="button" className={icon} aria-label="Next version" disabled={at >= v.meta.versions.length - 1} onClick={() => step(1)}>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </span>
            <SegmentedControl
              label="Show"
              value={tab}
              onValueChange={(t) => setTab(t as typeof tab)}
              options={[
                { value: 'preview', label: 'Preview' },
                { value: 'code', label: 'Code' },
              ]}
            />
            <CopyButton value={v.content} iconOnly variant="plain" label="Copy" />
            <button type="button" className={icon} aria-label="Download" title="Download" onClick={download}>
              <Download size={15} aria-hidden="true" />
            </button>
            {b ? (
              <button type="button" className={icon} aria-label="Show in Finder" title="Show in Finder" onClick={() => b.revealInFinder(v.path)}>
                <FolderOpen size={15} aria-hidden="true" />
              </button>
            ) : null}
          </>
        ) : null}
        <button type="button" className={icon} aria-label="Close artifact" title="Close" onClick={p.onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <ErrorState className="m-4" title="Could not open the artifact" detail={error} retrying={false} onRetry={() => setNonce((x) => x + 1)} />
        ) : !v ? null : tab === 'code' ? (
          <div className="p-3">
            <CodeBlock code={v.content} language="text" filename={v.meta.versions[at]?.file} wrap maxHeight={100_000} />
          </div>
        ) : kind === 'html' ? (
          // scripts only: no allow-same-origin, no popups, no top navigation
          <iframe title={`Preview of ${v.meta.title}`} sandbox="allow-scripts" srcDoc={v.content} className="block h-full w-full border-0 bg-white" />
        ) : (
          <div className="mx-auto max-w-[720px] px-6 py-5 text-sm leading-relaxed">
            <Markdown text={v.content} />
          </div>
        )}
      </div>
    </section>
  );
}
