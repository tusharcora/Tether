import type { BotDef } from '../crewStore';

/**
 * Whether a library bot may play a built-in role (§15.1): only a bot of the same kind (agent → agent roles, verdict →
 * Lens, …), never Gate (a person), and never another built-in (they are the lineup).
 */
export const canPlay = (bench: BotDef, slot: BotDef): boolean => !!slot.builtin && !bench.builtin && slot.kind !== 'approval' && bench.kind === slot.kind;

/**
 * The `PUT /api/crew/<built-in id>` body that makes a role look and speak like the library bot: its name, persona and look,
 * through the existing identity override. The role keeps its id, title, kind and read-only (the server enforces the kind).
 */
export const playAs = (slot: BotDef, bench: BotDef): BotDef => ({
  id: slot.id,
  name: bench.name,
  title: slot.title,
  kind: slot.kind,
  persona: bench.persona,
  look: bench.look,
  ...(slot.readOnly ? { readOnly: true } : {}),
});
