/** Shapes of the API client: saved request files, environments, send results, history rows. No runtime imports: the web reads this file too. */
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type Method = (typeof METHODS)[number];
/** A {{name}} variable. */
export const VAR_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
export const SECRET_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** A plain JSON object (not null, not an array). The one shared guard for untrusted input across src/http. */
export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface KV {
  key: string;
  value: string;
  on: boolean;
}

export type Body =
  | { kind: 'none' }
  | { kind: 'json'; value: unknown }
  | { kind: 'text'; value: string; contentType?: string }
  | { kind: 'form'; fields: KV[] };

export type Check =
  | { kind: 'status'; op: 'eq' | 'ne' | 'lt' | 'gte'; value: number }
  | { kind: 'status'; op: 'in'; value: number[] }
  | { kind: 'header'; name: string; op: 'exists' }
  | { kind: 'header'; name: string; op: 'eq' | 'contains' | 'matches'; value: string }
  | { kind: 'json'; path: string; op: 'exists' }
  | { kind: 'json'; path: string; op: 'eq' | 'ne' | 'contains' | 'matches' | 'lt' | 'gt'; value: unknown }
  | { kind: 'time'; op: 'lt'; value: number }
  | { kind: 'body'; op: 'contains' | 'matches'; value: string };

export interface HttpRequestFile {
  v: 1;
  name: string;
  method: Method;
  url: string;
  query: KV[];
  headers: KV[];
  body: Body;
  vars: Record<string, string>;
  checks: Check[];
  /** Shown to agents as the endpoint's description (first line). */
  notes?: string;
}

export interface CollectionFile {
  vars: Record<string, string>;
  headers: KV[];
}

export type EnvValue = string | { secret: string };
export interface Environment {
  v: 1;
  vars: Record<string, EnvValue>;
}

export interface ResolvedRequest {
  method: Method;
  url: string;
  headers: [string, string][];
  body?: string;
}

export type VarSource = { from: 'request' } | { from: 'collection'; path: string } | { from: 'env'; env: string } | { from: 'secret'; key: string };
/** A variable as the UI may show it: secrets carry their key only, never a value. */
export interface VarInfo {
  source: VarSource;
  value?: string;
}

export type NetErrorKind = 'timeout' | 'dns' | 'refused' | 'tls' | 'reset' | 'other';
export interface Timing {
  ttfb: number;
  download: number;
}
export interface SendResult {
  status: number;
  statusText: string;
  /** Final URL after redirects. */
  url: string;
  headers: [string, string][];
  body: string;
  /** Bytes received (up to the cap). */
  size: number;
  /** The 5 MB response cap cut the body. */
  truncated: boolean;
  ms: number;
  timing: Timing;
  redirects: string[];
  error?: { kind: NetErrorKind; message: string };
  /** On stored copies: the body was cut at 64 KB for history. */
  bodyTruncated?: boolean;
}
export interface CheckResult {
  check: Check;
  ok: boolean;
  actual: unknown;
}

export type Source = 'ui' | 'cli' | 'gate' | 'agent';
export interface ExchangeRequest {
  method: Method;
  url: string;
  headers: [string, string][];
  body?: string;
  bodyTruncated?: boolean;
}
/** A redacted exchange: what is stored, shown, printed or put in a prompt. */
export interface HistoryData {
  request: ExchangeRequest;
  response: SendResult;
  checks: CheckResult[];
}
export interface HistoryRow {
  id: number;
  ts: number;
  workspace: string;
  request: string | null;
  source: Source;
  runId: string | null;
  method: Method;
  url: string;
  status: number;
  ms: number;
  size: number;
  ok: boolean | null;
  data: HistoryData;
}

export interface TreeRequest {
  id: string;
  name: string;
  method: Method | '?';
  url: string;
  /** First line of notes, 80 chars. */
  note?: string;
  invalid?: string;
}
export interface TreeCollection {
  path: string;
  name: string;
  collections: TreeCollection[];
  requests: TreeRequest[];
}
export interface HttpTree {
  root: TreeCollection;
  environments: string[];
  activeEnv: string | null;
  /** Secrets scope / workspace id the tree belongs to. */
  workspace: string;
}

export interface ImportPreview {
  create: { id: string; file: HttpRequestFile }[];
  collections: { path: string; file: CollectionFile }[];
  skip: { name: string; reason: string }[];
  /** Things the person must do, e.g. store a credential the import left out as a secret. */
  warnings: string[];
  error?: string;
}

export interface SendOutput {
  result: SendResult;
  checks: CheckResult[];
  request: ExchangeRequest;
  historyId: number;
}

/** A request gate sends at most this many times (`repeat`). */
export const MAX_REPEAT = 500;

/** A gate step's alternative to `command`: run a saved request. */
export interface HttpGate {
  run: string;
  env?: string;
  repeat?: number;
  expect?: 'all' | 'last';
}
