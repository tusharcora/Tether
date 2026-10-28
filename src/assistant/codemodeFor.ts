/** Code Mode for one assistant turn: a read-only, unapproved session (like a step of a workflow run), with its scripts observable. */
import { CodeSession } from '../codemode/session.js';
import { CODE_MODE_NOTE } from '../codemode/prompt.js';
import { loadMcpServers } from '../codemode/mcpServers.js';
import type { Engine } from '../engine.js';
import type { Store } from '../store.js';
import type { AgentAdapter, CodeModeRequest } from '../types.js';
import type { RunCodeOutput } from '../codemode/types.js';
import type { Vault } from '../vault.js';

export interface TurnCodeMode {
  request?: CodeModeRequest;
  /** Outside-world calls the session refused for lack of approval. */
  approvals(): string[];
  close(): Promise<void>;
}

export async function openCodeModeFor(o: {
  engine: Engine;
  adapter: AgentAdapter;
  home: string;
  store: Store;
  vault: Vault;
  workdir: string;
  grants: string[];
  workspace?: string;
  /** A script is about to run; the returned function receives its result. */
  onRun(code: string): (r: RunCodeOutput) => void;
}): Promise<TurnCodeMode> {
  if (!o.adapter.codeMode) return { approvals: () => [], close: async () => {} };
  const session = new CodeSession(
    {
      home: o.home,
      runId: 'tether-assistant',
      nodeId: 'chat',
      bot: 'Tether',
      workdir: o.workdir,
      writable: false,
      // a team-style session: a refused outside-world call is recorded as an approval to ask for, not a hard error
      kind: 'team',
      approved: false,
      grants: o.grants,
      handoff: false,
      workspace: o.workspace,
    },
    { store: o.store, vault: o.vault, db: o.store.raw(), mcpServers: loadMcpServers(o.home) },
  );
  const run = session.runCode.bind(session);
  session.runCode = async (code: string) => {
    const finish = o.onRun(typeof code === 'string' ? code : '');
    const r = await run(code);
    finish(r);
    return r;
  };
  const opened = o.adapter.codeMode === 'mcp' ? await o.engine.codeMode.open(session) : undefined;
  return {
    request: { runner: session, note: CODE_MODE_NOTE, ...(opened ? { mcp: opened.launch } : {}) },
    approvals: () => [...session.approvals],
    close: async () => {
      opened?.close();
      await session.close();
    },
  };
}
