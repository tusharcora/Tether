/**
 * The Tether assistant's chats, shared by the server (src/assistant) and the dashboard (web/src/assistant), the way web/src
 * imports src/types.ts. Chats are per project; each Tether message may carry citations, proposed runs (which start only on
 * the person's click), questions, blocked outside-world calls waiting for a decision, Code Mode runs and a comparison.
 */
import type { TeamMode } from '../types.js';
import type { ArtifactKind } from './artifactBlocks.js';

export type { ArtifactKind };

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

/**
 * What one turn sent the model, part by part in characters (with what makes each part up), and how big the answering
 * model's context is. Saved on the reply (and on a summary message, re-measured) so the composer's ring reads the chat.
 */
export interface ContextUse {
  parts: Record<'prompt' | 'tools' | 'memory' | 'messages', [label: string, chars: number][]>;
  /** The input tokens of the turn's first model request, when the agent reports them. */
  tokens?: number;
  /** `tokens` is Tether's estimate (after a compaction), not the agent's report. */
  about?: true;
  agent: string;
  model?: string;
  /** The model's context window in tokens; unknown: no ring. */
  size?: number;
  /** A free-tier limit that applies to this model. */
  limit?: 'openrouter' | 'nvidia';
}

/** A comparison of runs, models or bots (cost, time, tests, files). */
export interface Compare {
  title?: string;
  columns: string[];
  rows: { label: string; cells: string[] }[];
}

/** A vault note the turn's prompt carried (keyword retrieval, raw score): what the reply could lean on. */
export interface Retrieved {
  path: string;
  title: string;
  score: number;
  snippet: string;
}

/** A write-up in sections; `sources` counts the reply's real sources a section cites. */
export interface Report {
  title: string;
  sections: { heading: string; summary?: string; sources: number }[];
}

/** Facts as label and value rows (versions, limits, settings). */
export interface Spec {
  title: string;
  subtitle?: string;
  rows: { label: string; value: string; emphasis?: true }[];
}

/** Options on the same traits (false: the option lacks it) and the one Tether would pick (empty: none). */
export interface Choice {
  traits: string[];
  options: { name: string; headline: string; traits: (string | false)[] }[];
  pick: string;
  reason: string;
}

/** Boxes and arrows: edges only between listed nodes. */
export interface Diagram {
  title: string;
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string; label?: string }[];
}

export interface TimelineEvent {
  time: string;
  title: string;
  detail?: string;
  when: 'past' | 'now' | 'future';
}

/** An artifact a reply made or rewrote: the message keeps this, the content lives in the artifacts folder (artifacts.ts). */
export interface ArtifactRef {
  id: string;
  version: number;
  title: string;
  kind: ArtifactKind;
}

/** One saved version: `file` is `v<n>.html` or `v<n>.md`; `words` for Markdown, `bytes` for HTML. */
export interface ArtifactVersion {
  n: number;
  at: number;
  file: string;
  words?: number;
  bytes?: number;
}

/** `<artifacts folder>/<id>/meta.json`. */
export interface ArtifactMeta {
  id: string;
  title: string;
  kind: ArtifactKind;
  /** The chat that made it (none: a chat with no id yet, or made elsewhere). */
  chatId?: string;
  createdAt: number;
  updatedAt: number;
  versions: ArtifactVersion[];
}

/** GET /api/assistant/artifacts/:id: the artifact and one version's content (the latest unless `v` names one). */
export interface ArtifactView {
  meta: ArtifactMeta;
  version: number;
  content: string;
  /** The version's file on disk (Show in Finder in Tether.app). */
  path: string;
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
  /** What was wrong, with a thumbs down. */
  feedbackNote?: { reasons: string[]; note?: string };
  /** The vault notes the prompt carried. */
  retrieved?: Retrieved[];
  report?: Report;
  spec?: Spec;
  choice?: Choice;
  diagram?: Diagram;
  timeline?: TimelineEvent[];
  /** Artifacts the reply made or rewrote (a page, a doc), in the order it wrote them. */
  artifacts?: ArtifactRef[];
  /** An @mentioned crew agent answered (as itself, on its own binding), not Tether. */
  by?: { bot: string; name: string };
  /** What the turn cost, where the agent reports it. */
  costUsd?: number;
  /** The turn failed: what to tell the person. */
  error?: string;
  /** What the turn sent the model (the composer's context ring). */
  context?: ContextUse;
  /** A summary of `count` earlier messages (Compact now, or auto-compact when the context ran full). */
  compact?: { count: number; auto?: true };
  /** Folded into that summary message: kept in the chat, left out of the prompt, shown collapsed. */
  compactedBy?: string;
}

/** A prompt the person saved (GET /api/assistant/prompts): `variables` are its body's `{{name}}` tokens. */
export interface SavedPrompt {
  id: string;
  name: string;
  body: string;
  variables: string[];
}

/** What the person is looking at, sent with every message so Tether can use it. */
export interface AssistantContext {
  /** The screen: home, inbox, runs, code, builder, crew, api, graph, triggers. */
  page: string;
  selection?: { kind: 'run' | 'file' | 'note' | 'request' | 'workflow' | 'bot'; id: string; line?: number };
}

/** GET /api/assistant: one chat of the project (none named: a new chat, no messages) and who answers. */
export interface ChatView {
  id?: string;
  title?: string;
  messages: ChatMessage[];
  /** The agent behind Tether (its crew binding) and its model. */
  agent: string;
  model?: string;
  /** Models that agent offers, for the prompt's model picker. */
  models: string[];
  /** OpenRouter is connected but Tether runs on another agent: the picker also offers OpenRouter's free models. */
  openrouter?: boolean;
  /** NVIDIA is set up but Tether runs on another agent: the picker also offers NVIDIA's free models. */
  nvidia?: boolean;
}

/** One step of what a chat led to: the question, a proposal, the run it started. Tones match the action nodes'. */
export interface OutcomeNode {
  kind: 'Asked' | 'Proposal' | 'Run';
  label: string;
  /** "answered", "waiting on you", "running", "done · $0.12", "failed"… */
  state: string;
  tone: 'live' | 'needs' | 'done' | 'failed' | 'idle';
  runId?: string;
}

/** GET /api/assistant/chats: one chat as All chats, the sidebar and the switcher list it, with its runs' live state. */
export interface ChatSummary {
  id: string;
  title: string;
  updated: number;
  count: number;
  /** The first line of Tether's last reply. */
  last: string;
  kind: 'live' | 'needs' | 'done' | 'failed' | 'answer';
  outcome: OutcomeNode[];
  /** Crew bots that worked on its runs. */
  faces: string[];
  cites: Cite[];
}

/** The server-sent events of one turn (POST /api/assistant). */
export type StreamEvent =
  /** `chat`: the chat the turn is in (made by this message when none was named). */
  | { type: 'start'; you: ChatMessage; id: string; chat: string; title: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; tool: ToolRun }
  /** Older messages were summarized before this turn (auto-compact): the chat's messages as they are now. */
  | { type: 'compacted'; messages: ChatMessage[] }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; error: string };

export const ATTACH_MAX_FILES = 5;
/** Per attached file, as text. */
export const ATTACH_MAX_BYTES = 200_000;
export const MESSAGE_MAX = 8000;
/** A renamed chat title's limit (a title from the first message is shorter). */
export const TITLE_MAX = 120;
