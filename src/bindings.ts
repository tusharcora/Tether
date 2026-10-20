/**
 * Bot ↔ model bindings. Each crew member (Maestro, Scout, Brick, Bolt, Probe, Lens, Gate) can be linked to
 * any agent adapter and model: Claude Code, Codex, OpenCode, a local model (Ollama, LM Studio, llama.cpp,
 * any OpenAI-compatible server), or a custom CLI. A step that names no agent of its own follows its bot.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crewFor } from './bots.js';
import type { Pipeline } from './types.js';

export interface Binding {
  agent: string;
  model?: string;
}
export type Bindings = Record<string, Binding>;

const file = (home: string) => join(home, 'bots.json');
const BOT_RE = /^[a-z][a-z0-9_-]{0,31}$/;

export function loadBindings(home: string): Bindings {
  try {
    const raw = JSON.parse(readFileSync(file(home), 'utf8'));
    const out: Bindings = {};
    for (const [bot, b] of Object.entries(raw ?? {})) {
      const v = b as Partial<Binding>;
      if (BOT_RE.test(bot) && v && typeof v.agent === 'string' && v.agent) out[bot] = { agent: v.agent, ...(typeof v.model === 'string' && v.model ? { model: v.model } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveBindings(home: string, b: Bindings): void {
  mkdirSync(home, { recursive: true });
  const tmp = `${file(home)}.tmp`;
  writeFileSync(tmp, JSON.stringify(b, null, 2) + '\n');
  renameSync(tmp, file(home));
}

export function link(home: string, bot: string, binding: Binding): Bindings {
  if (!BOT_RE.test(bot)) throw new Error(`invalid bot name "${bot}"`);
  const b = loadBindings(home);
  b[bot] = binding.model ? { agent: binding.agent, model: binding.model } : { agent: binding.agent };
  saveBindings(home, b);
  return b;
}

export function unlink(home: string, bot: string): Bindings {
  const b = loadBindings(home);
  delete b[bot];
  saveBindings(home, b);
  return b;
}

/**
 * Fill in agent/model on steps that don't name their own, from the bot that would run them.
 * Returns a copy; what the run records is exactly what ran. Explicit step settings always win.
 * A bot's model only applies when the step ends up on that bot's agent.
 */
export function applyBindings(p: Pipeline, b: Bindings): Pipeline {
  if (!Object.keys(b).length) return p;
  return {
    ...p,
    nodes: p.nodes.map((n) => {
      if (n.kind !== 'agent') return n;
      const bound = b[crewFor(n)];
      if (!bound) return n;
      const agent = n.agent ?? bound.agent;
      const model = n.model ?? (agent === bound.agent ? bound.model : undefined);
      return { ...n, agent, ...(model ? { model } : {}) };
    }),
  };
}

export const hasBindingsFile = (home: string) => existsSync(file(home));
