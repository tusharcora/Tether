import { Button } from '../components/beui/kit/Button';
import { Checkbox } from '../components/beui/kit/fields';
import { Drawer, DrawerContent, useDrawerItem } from '../components/beui/kit/overlays';
import { Input } from '../components/beui/kit/fields';
import { Select } from '../components/beui/kit/fields';
import { NONE, fromNone } from '../ui/cn';
import { EVENTS, type Form, type Workspace } from './types';
import './triggers.css';

/** The trigger form, in a right drawer. Every field of today's form; the id is locked while editing. */
export function TriggerForm(p: {
  form: Form | null;
  editing: boolean;
  workspaces: Workspace[];
  agents: Record<string, { ok: boolean; models: string[] }>;
  workflows: string[];
  onChange: (f: Partial<Form>) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const f = useDrawerItem(p.form);
  const models = p.agents[f?.agent ?? '']?.models ?? [];
  return (
    <Drawer open={!!p.form} onOpenChange={(o) => !o && p.onClose()}>
      <DrawerContent side="right" title={p.editing ? `Edit ${f?.id ?? ''}` : 'New trigger'}>
        {f ? (
          <form
            className="tg-form"
            aria-label={p.editing ? 'Edit trigger' : 'New trigger'}
            onSubmit={(e) => {
              e.preventDefault();
              p.onSave();
            }}
          >
            <Input label="Repo" required value={f.repo} placeholder="owner/repo, or * for any mapped repo" spellCheck={false} onChange={(e) => p.onChange({ repo: e.target.value })} />
            <Input label="Workflow" required list="trig-workflows" value={f.workflow} spellCheck={false} onChange={(e) => p.onChange({ workflow: e.target.value })} />
            <datalist id="trig-workflows">
              {p.workflows.map((w) => (
                <option key={w} value={w} />
              ))}
            </datalist>
            {p.workspaces.length ? (
              <Select
                label="Workspace"
                value={f.workspace || NONE}
                onValueChange={(v) => p.onChange({ workspace: fromNone(v) })}
                options={[
                  { value: NONE, label: 'none' },
                  ...(f.workspace && !p.workspaces.some((w) => w.id === f.workspace) ? [{ value: f.workspace, label: `${f.workspace} (not found)` }] : []),
                  ...p.workspaces.map((w) => ({ value: w.id, label: `${w.name || w.id}${w.isDefault ? ' (default)' : ''}${w.exists ? '' : ' (folder missing)'}` })),
                ]}
              />
            ) : (
              <Input label="Workspace" value={f.workspace} placeholder="workspace id (optional)" onChange={(e) => p.onChange({ workspace: e.target.value })} />
            )}
            <div className="tg-pair">
              <Select
                label="Agent"
                value={f.agent || NONE}
                onValueChange={(v) => p.onChange({ agent: fromNone(v), model: '' })}
                options={[
                  { value: NONE, label: 'crew defaults' },
                  ...(f.agent && !(f.agent in p.agents) ? [{ value: f.agent, label: `${f.agent} (unknown)` }] : []),
                  ...Object.keys(p.agents).map((a) => ({ value: a, label: `${a}${p.agents[a]!.ok ? '' : ' (not available)'}` })),
                ]}
              />
              <Input label="Model" list="trig-models" value={f.model} placeholder="adapter default" spellCheck={false} onChange={(e) => p.onChange({ model: e.target.value })} />
            </div>
            <datalist id="trig-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <Input label="Events" list="trig-events" value={f.events} placeholder="default: opened, synchronize, reopened, ready_for_review" spellCheck={false} onChange={(e) => p.onChange({ events: e.target.value })} />
            <datalist id="trig-events">
              {EVENTS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <Input label="Only with labels" value={f.labels} placeholder="comma separated; empty = any PR" spellCheck={false} onChange={(e) => p.onChange({ labels: e.target.value })} />
            <Input label="Id" value={f.id} disabled={p.editing} placeholder="auto: repo-workflow" spellCheck={false} onChange={(e) => p.onChange({ id: e.target.value })} />
            <div className="tg-checks">
              <Checkbox label="post the result as a PR comment" checked={f.comment} onCheckedChange={(c) => p.onChange({ comment: c === true })} />
              <Checkbox label="include drafts" checked={f.drafts} onCheckedChange={(c) => p.onChange({ drafts: c === true })} />
              <Checkbox label="include forks" checked={f.forks} onCheckedChange={(c) => p.onChange({ forks: c === true })} />
            </div>
            <div className="tg-actions">
              <Button variant="primary" type="submit" disabled={!f.repo.trim() || !f.workflow.trim()}>
                Save
              </Button>
              <Button variant="secondary" type="button" onClick={p.onClose}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
