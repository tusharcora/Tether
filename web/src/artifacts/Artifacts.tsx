import { useState } from 'react';
import { clock } from '../api';
import { artifactsPath, assistantApi, type ArtifactMeta } from '../assistant/api';
import { ErrorState } from '../components/assistant-ui/elements/error-state';
import { Loading } from '../components/Loading';
import { usePoll, type Route } from '../hooks';
import { cn } from '../ui/cn';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { EmptyState } from '../ui/studio/EmptyState';
import { ArtifactViewer, KIND_LABEL } from './ArtifactViewer';

/** "14:22" today, "Oct 27" before (as All chats says it). */
const when = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? clock(t) : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Artifacts: the pages and docs this project's chats made (no project: Tether's own folder), last changed first, each with
 * its kind, versions and when it changed. Pressing one opens it beside the list in the viewer the chat uses; Open chat
 * goes to the chat that made it; Delete asks first and removes every version.
 */
export function Artifacts(p: { ws?: string; project?: { id: string; name: string }; onGo: (r: Route) => void }) {
  const notify = useNotify();
  const poll = usePoll<{ artifacts: ArtifactMeta[] }>(artifactsPath(p.ws), 15_000);
  const list = poll.data?.artifacts;
  const [open, setOpen] = useState<string>();
  const remove = (a: ArtifactMeta) =>
    assistantApi.removeArtifact(p.ws, a.id).then(() => {
      if (open === a.id) setOpen(undefined);
      notify.ok(`Deleted ${a.title}`);
      void poll.refresh();
    }, notify.fail);
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <section className="flex min-h-0 w-full flex-none flex-col border-border md:w-[420px] md:border-r" aria-label="Artifacts">
        <header className="flex flex-col gap-1 px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <h1 className="m-0 text-xl font-semibold">Artifacts</h1>
            {p.project ? <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{p.project.name}</span> : null}
          </div>
          <p className="m-0 text-sm text-muted-foreground">{p.project ? 'Pages and docs Tether made in this project’s chats, kept in its .aorch/artifacts folder.' : 'Pages and docs Tether made in chats with no project.'}</p>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
          {poll.error && !list ? (
            <ErrorState title="Could not load the artifacts" detail={poll.error} retrying={false} onRetry={() => void poll.refresh()} />
          ) : (
            <Loading loading={!list} lines={5} label="Loading artifacts">
              {list?.length ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {list.map((a) => (
                    <li key={a.id} className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-foreground/[0.04]', open === a.id && 'bg-foreground/[0.06]')}>
                      <button type="button" className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left text-foreground" aria-current={open === a.id || undefined} onClick={() => setOpen(a.id)}>
                        <span className="block truncate text-[13.5px] font-medium">{a.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{`${KIND_LABEL[a.kind]} · ${plural(a.versions.length, 'version')} · ${when(a.updatedAt)}`}</span>
                      </button>
                      {a.chatId ? (
                        <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-xs text-foreground underline underline-offset-4" onClick={() => p.onGo({ tab: 'chats', id: a.chatId })}>
                          Open chat
                        </button>
                      ) : null}
                      <ConfirmButton label="Delete" prompt={`Delete ${a.title} and its ${plural(a.versions.length, 'version')}?`} confirmLabel="Delete" variant="danger" onConfirm={() => remove(a)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No artifacts yet" description="Ask Tether in a chat for a page, a prototype or a doc: it opens beside the chat and is kept here." />
              )}
            </Loading>
          )}
        </div>
      </section>
      <div className="flex min-h-[60vh] min-w-0 flex-1 md:min-h-0">
        {open ? <ArtifactViewer key={open} ws={p.ws} id={open} project={p.project?.name} onClose={() => setOpen(undefined)} /> : <p className="m-auto text-sm text-muted-foreground">{list?.length ? 'Pick an artifact to open it.' : ''}</p>}
      </div>
    </div>
  );
}
