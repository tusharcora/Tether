/**
 * The Tether assistant's chat, shared by the server (src/assistant) and the dashboard (web/src/assistant), the way web/src
 * imports src/types.ts. A chat is per project; each Tether message may carry citations, proposed runs (which start only on
 * the person's click), questions, blocked outside-world calls waiting for a decision, Code Mode runs and a comparison.
 */
import type { TeamMode } from '../types.js';

/** A source behind a claim: `file:line` opens Code, a run opens its page, a note opens the Graph. */
export type Cite = { n: number; label: string } & ({ kind: 'file'; path: string; line?: number } | { kind: 'run'; id: string } | { kind: 'note'; path: string });

/** A run Tether proposes. Nothing starts until the person clicks Start (POST /api/assistant/proposals/:id). */
export interface Proposal {
  id: string;
  kind: 'workflow' | 'team';
  /** A saved workflow (kind workflow). */
  workflow?: string;
  task: string;
  mode?: TeamMode;
  /** Why this run, in a line. */
  why?: string;
  status: 'proposed' | 'started' | 'dismissed' | 'failed';
  runId?: string;
  /** What went wrong when it could not start. */
  note?: string;
}

/** Questions before Tether goes on: one card, several steps; a single choice moves on by itself. */
export interface AskCard {
  id: string;
  questions: { id: string; title: string; desc?: string; multi?: boolean; options: { id: string; label: string; desc?: string }[] }[];
  status: 'pending' | 'answered';
  /** The one-line summary the card collapses to. */
  result?: string;
}

/** An outside-world call Code Mode refused for lack of approval (a GitHub comment, an unsafe HTTP request, ...). */
export interface ToolAsk {
  id: string;
  /** What the call does, in a line (Code Mode's own description of it). */
  what: string;
  status: 'pending' | 'once' | 'always' | 'denied';
}

/** One run_code script Tether ran while answering, and what came back (secrets redacted). */
export interface ToolRun {
  id: string;
  code: string;
  output?: string;
  isError?: boolean;
  ms?: number;
}

/** A comparison of runs, models or bots (cost, time, tests, files). */
export interface Compare {
  title?: string;
  columns: string[];
  rows: { label: string; cells: string[] }[];
}

export interface ChatMessage {
  id: string;
  role: 'you' | 'tether';
  text: string;
  at: number;
  cites?: Cite[];
  proposals?: Proposal[];
  ask?: AskCard;
  toolAsks?: ToolAsk[];
  tools?: ToolRun[];
  compare?: Compare;
  attachments?: { name: string; size: number }[];
  feedback?: 'up' | 'down';
  /** What the turn cost, where the agent reports it. */
  costUsd?: number;
  /** The turn failed: what to tell the person. */
  error?: string;
}

/** What the person is looking at, sent with every message so Tether can use it. */
export interface AssistantContext {
  /** The screen: home, inbox, runs, code, builder, crew, api, graph, triggers. */
  page: string;
  selection?: { kind: 'run' | 'file' | 'note' | 'request' | 'workflow' | 'bot'; id: string; line?: number };
}

/** GET /api/assistant: the project's chat and who answers. */
export interface ChatView {
  messages: ChatMessage[];
  /** The agent behind Tether (its crew binding) and its model. */
  agent: string;
  model?: string;
  /** Models that agent offers, for the prompt's model picker. */
  models: string[];
}

/** The server-sent events of one turn (POST /api/assistant). */
export type StreamEvent =
  | { type: 'start'; you: ChatMessage; id: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; tool: ToolRun }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; error: string };

export const ATTACH_MAX_FILES = 5;
/** Per attached file, as text. */
export const ATTACH_MAX_BYTES = 200_000;
export const MESSAGE_MAX = 8000;
