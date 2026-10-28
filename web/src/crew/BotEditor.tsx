import { Button } from '../components/beui/kit/Button';
import { Input } from '../components/beui/kit/fields';
import { Select } from '../components/beui/kit/fields';
import { Slider } from '../components/beui/kit/fields';
import { Switch } from '../components/beui/kit/fields';
import { Textarea } from '../components/kept/textarea/textarea';
import type { BotDef, FaceLook } from '../crewStore';
import { Face } from '../Face';
import { DEFAULT_HUE, isEcc } from './types';

/** A bot's look and words. Controlled: the Crew screen owns the draft and the persona loading. */
export function BotEditor(p: {
  bot: BotDef;
  isNew: boolean;
  kinds: { kind: string; blurb: string }[];
  personaLoad: 'ok' | 'loading' | 'failed';
  onPatch: (b: Partial<BotDef>) => void;
  onFace: (f: Partial<FaceLook>) => void;
  onResetFace: () => void;
  onPersona: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const b = p.bot;
  const name = b.name || 'New bot';
  const source = p.isNew ? 'new' : isEcc(b) ? (b.source ?? 'ECC') : b.builtin ? 'built-in' : 'yours';
  return (
    <section className="cw-editor" aria-label={p.isNew ? 'New bot' : `Edit ${b.name}`}>
      <div className="cw-editor-head">
        <Face id={b.id || 'new-bot'} face={b.look.face ?? {}} size={72} animate="hover" label={`${name} preview`} />
        <div>
          <h2>{name}</h2>
          <p className="sl-meta">
            {source} · {b.kind}
          </p>
        </div>
      </div>
      <Slider label="Hue" min={0} max={359} step={1} value={b.look.face?.hue ?? DEFAULT_HUE} onValueChange={(v) => p.onFace({ hue: v })} />
      <Slider label="Tone" min={0} max={1} step={0.05} value={b.look.face?.tone ?? 0.5} format={(v) => v.toFixed(2)} onValueChange={(v) => p.onFace({ tone: v })} />
      <div>
        <Button variant="ghost" size="sm" disabled={!b.look.face} onClick={p.onResetFace}>
          Reset to generated
        </Button>
      </div>
      <div className="cw-pair">
        <Input label="Name" value={b.name} maxLength={24} onChange={(e) => p.onPatch({ name: e.target.value })} />
        <Select
          label="Kind"
          options={p.kinds.map((k) => ({ value: k.kind, label: `${k.kind}: ${k.blurb}` }))}
          value={b.kind}
          disabled={!p.isNew && !!b.builtin}
          onValueChange={(v) => p.onPatch({ kind: v })}
        />
      </div>
      <Input label="Title" value={b.title} maxLength={28} placeholder="what it is" onChange={(e) => p.onPatch({ title: e.target.value })} />
      <Textarea
        label="Persona (becomes this bot's instructions)"
        rows={5}
        maxLength={isEcc(b) ? 24000 : 600}
        value={b.persona}
        readOnly={p.personaLoad !== 'ok'}
        aria-busy={p.personaLoad === 'loading' || undefined}
        description={
          p.personaLoad === 'loading'
            ? 'Loading the full persona…'
            : p.personaLoad === 'failed'
              ? 'Showing the first 2000 characters; edits are disabled until the full text loads'
              : isEcc(b)
                ? 'From ECC; an update replaces your edits'
                : undefined
        }
        onChange={(e) => p.personaLoad === 'ok' && p.onPersona(e.target.value)}
      />
      {b.kind === 'agent' && !b.builtin ? <Switch label="read-only (may not edit files)" checked={!!b.readOnly} onCheckedChange={(c) => p.onPatch({ readOnly: c })} /> : null}
      <div className="cw-actions">
        <Button variant="primary" disabled={!b.name.trim()} onClick={p.onSave}>
          Save
        </Button>
        <Button variant="secondary" onClick={p.onCancel}>
          Cancel
        </Button>
        {!p.isNew && (!b.builtin || b.edited) ? (
          <Button variant="secondary" onClick={p.onRemove}>
            {b.builtin ? 'Reset to original' : 'Remove'}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
