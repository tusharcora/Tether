/**
 * Code Mode's shape, after Cloudflare's `@cloudflare/codemode` (see the plan's spike: its entry imports `cloudflare:workers`,
 * so Tether builds the same shape here): connectors are namespaces of async methods the sandboxed script calls; methods
 * carry JSON Schema for their parameters, which becomes TypeScript for `codemode.describe()`.
 */
export type JsonSchema = Record<string, unknown>;

export interface Param {
  name: string;
  schema: JsonSchema;
  optional?: boolean;
}

export interface Method {
  /** The name under its connector: `read`, `vault.search`, an MCP tool's sanitised name. */
  name: string;
  /** One line, shown by codemode.search(). */
  summary: string;
  /** More, shown by codemode.describe(). */
  doc?: string;
  /** Positional parameters (an MCP tool takes one object, `input`). */
  params?: Param[];
  /** The resolved value's TypeScript type. Default `unknown`. */
  returns?: string;
  /** Changes the repository: refused on a read-only step. */
  write?: boolean;
  /**
   * Changes something outside the repository (a GitHub comment, an unsafe HTTP request, a destructive MCP tool): returns a
   * one-line description of this call, which needs approval; undefined when this call is safe (a GET).
   */
  outside?: (args: unknown[]) => string | undefined;
  run(args: unknown[]): Promise<unknown>;
}

export interface Connector {
  /** `repo`, `tether`, `github`, `http`, or `mcp.<server>`. */
  name: string;
  summary: string;
  methods(): Promise<Method[]>;
  close?(): Promise<void>;
}

/** What one run_code returns to the agent. */
export interface RunCodeOutput {
  text: string;
  isError: boolean;
}
