import { useState } from 'react';
import { PromptLibrary } from '../components/assistant-ui/elements/prompt-library';
import { Button } from '../components/beui/kit/Button';
import { Dialog, DialogContent } from '../components/beui/kit/overlays';
import { usePoll } from '../hooks';
import { ConfirmButton } from '../ui/ConfirmButton';
import { useNotify } from '../ui/notify';
import { assistantApi, promptsPath, type SavedPrompt } from './api';

/** A message as a prompt: its first line (cut to 60) names it. */
export const promptFrom = (text: string) => ({ name: (text.trim().split('\n')[0] ?? '').replace(/\s+/g, ' ').slice(0, 60) || 'Prompt', body: text.trim() });

const field = 'w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground';

/**
 * The prompt library (the composer's Prompts button, or /prompts): the project's saved prompts, searchable; arrows and
 * Enter or a double click insert one into the message, `{{name}}` parts left to fill in. + New saves one; Delete asks first.
 */
export function PromptsDialog({ ws, open, onOpenChange, onInsert }: { ws?: string; open: boolean; onOpenChange: (open: boolean) => void; onInsert: (body: string) => void }) {
  const notify = useNotify();
  const poll = usePoll<{ prompts: SavedPrompt[] }>(open ? promptsPath(ws) : null, 60_000);
  const prompts = poll.data?.prompts ?? [];
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState('');
  const [draft, setDraft] = useState<{ name: string; body: string }>();
  const selected = prompts.find((x) => x.id === sel);
  const insert = (id: string) => {
    const x = prompts.find((y) => y.id === id);
    if (!x) return;
    onInsert(x.body);
    onOpenChange(false);
  };
  const save = () =>
    draft &&
    void assistantApi.savePrompt(ws, draft).then(({ prompt }) => {
      setDraft(undefined);
      setSel(prompt.id);
      void poll.refresh();
    }, notify.fail);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent title="Saved prompts" description="Insert one into your message. {{name}} marks a part to fill in.">
          {draft ? (
            <form className="flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), save())}>
              <input className={field} aria-label="Prompt name" placeholder="Name" maxLength={80} value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <textarea className={field} aria-label="Prompt" placeholder="Review {{file}} for…" rows={5} maxLength={20_000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDraft(undefined)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit" disabled={!draft.name.trim() || !draft.body.trim()}>
                  Save prompt
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-3">
              {prompts.length ? (
                <PromptLibrary className="max-w-none" prompts={prompts} query={query} selectedId={sel} onQueryChange={setQuery} onSelect={setSel} onInsert={insert} />
              ) : (
                <p className="m-0 text-muted-foreground">{poll.data ? 'No saved prompts yet. Save one here, or with Save as prompt under a message you sent.' : 'Loading…'}</p>
              )}
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setDraft({ name: '', body: '' })}>
                  + New
                </Button>
                <span className="flex-1" />
                {selected ? (
                  <>
                    <ConfirmButton label="Delete" prompt={`Delete ${selected.name}?`} confirmLabel="Delete" variant="secondary" onConfirm={() => assistantApi.removePrompt(ws, selected.id).then(() => (setSel(''), void poll.refresh()), notify.fail)} />
                    <Button size="sm" onClick={() => insert(selected.id)}>
                      Insert
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
