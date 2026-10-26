/**
 * The one place that says how an agent CLI starts Tether's Code Mode MCP server: the running executable on Tether's own
 * CLI entry, `<exec> <cli.js> codemode-mcp --session <file>`. Inside Tether.app `tether` is not on PATH and
 * process.execPath is the app's Electron binary, so it runs as Node (ELECTRON_RUN_AS_NODE=1) on the bundled cli.js;
 * under `tether serve` it is Node on dist/cli.js; from source under tsx, the loader flags ride along. Claude Code's
 * per-run config and Codex's overrides both take this command (through the step's McpLaunch).
 */
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface McpCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** What the command depends on, from this process by default (tests pass their own). */
export interface LaunchContext {
  execPath: string;
  /** Running inside Electron (Tether.app). */
  electron: boolean;
  /** This process's Node flags (tsx's loader in development). */
  execArgv: string[];
  /** Tether's CLI entry: dist/cli.js, or src/cli.ts from source. */
  cliPath: string;
}

const self = fileURLToPath(import.meta.url);

export const launchContext = (): LaunchContext => ({
  execPath: process.execPath,
  electron: !!process.versions.electron,
  execArgv: process.execArgv,
  cliPath: join(dirname(self), '..', `cli${extname(self)}`),
});

/** Only module-loader flags pass on (`--import tsx`, `--require …`, `--loader …`), and only for a TypeScript entry. */
function loaderFlags(execArgv: string[], cliPath: string): string[] {
  if (extname(cliPath) !== '.ts') return [];
  const out: string[] = [];
  for (let i = 0; i < execArgv.length; i++) {
    const a = execArgv[i]!;
    if (/^--(import|require|loader)=/.test(a)) out.push(a);
    else if (/^--(import|require|loader)$/.test(a) && execArgv[i + 1] !== undefined) out.push(a, execArgv[++i]!);
  }
  return out;
}

export function codeModeMcpCommand(sessionFile: string, ctx: LaunchContext = launchContext()): McpCommand {
  return {
    command: ctx.execPath,
    args: [...loaderFlags(ctx.execArgv, ctx.cliPath), ctx.cliPath, 'codemode-mcp', '--session', sessionFile],
    ...(ctx.electron ? { env: { ELECTRON_RUN_AS_NODE: '1' } } : {}),
  };
}
