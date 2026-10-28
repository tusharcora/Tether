/**
 * How each agent CLI gets Tether's Code Mode MCP server for one run, without touching its global config: a per-run file
 * or flags pointing at the step's `mcpMain`. Claude Code: `--mcp-config <file> --strict-mcp-config`, run_code allowed,
 * the note appended to its system prompt. Codex: `-c mcp_servers.tether.*` overrides (its documented TOML flag).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CodeModeRequest } from '../types.js';

/** The MCP server's name in every per-run config; Claude Code calls its tool `mcp__tether__run_code`. */
export const SERVER = 'tether';
export const CLAUDE_TOOL = `mcp__${SERVER}__run_code`;

/** Claude Code's flags for a Code Mode run; writes the per-run MCP config (0600) into the step's own temp folder. */
export function claudeCodeModeArgs(cm: CodeModeRequest): string[] {
  if (!cm.mcp) return [];
  const { command, args, env, dir } = cm.mcp;
  const file = join(dir, 'mcp.json');
  writeFileSync(file, JSON.stringify({ mcpServers: { [SERVER]: { type: 'stdio', command, args, ...(env ? { env } : {}) } } }, null, 2), { mode: 0o600 });
  return [
    '--mcp-config',
    file,
    // the owner's own MCP servers reach the agent only as mcp.* connectors inside Code Mode, not as direct tools
    '--strict-mcp-config',
    '--allowedTools',
    CLAUDE_TOOL,
    '--append-system-prompt',
    cm.note,
    // Code Mode only for reading: repository exploration goes through repo.search / repo.read in one script
    ...(cm.readsOnly ? ['--disallowedTools', 'Grep', 'Glob'] : []),
  ];
}

const toml = (v: unknown) => JSON.stringify(v);

/**
 * Codex's per-run overrides (`-c key=value`, the value parsed as TOML; JSON strings and string arrays are valid TOML).
 * Not verified against an installed Codex, like the rest of codexSpec.
 */
export function codexCodeModeArgs(cm: CodeModeRequest | undefined): string[] {
  if (!cm?.mcp) return [];
  const { command, args, env } = cm.mcp;
  const kv = (k: string, v: string) => ['-c', `mcp_servers.${SERVER}.${k}=${v}`];
  return [...kv('command', toml(command)), ...kv('args', toml(args)), ...(env ? kv('env', `{ ${Object.entries(env).map(([k, v]) => `${k} = ${toml(v)}`).join(', ')} }`) : [])];
}
