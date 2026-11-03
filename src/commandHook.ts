/**
 * Claude Code's PreToolUse hook on Bash: the one command rule, for a CLI whose shell Tether does not run. Exit 2 blocks the
 * call and shows stderr to the model. Anything that goes wrong here refuses too. Started by `commandHookLine` (launch.ts).
 */
import { readFileSync } from 'node:fs';
import { commandRule, refusal } from './permissions.js';

try {
  const { tool_input: input, cwd } = JSON.parse(readFileSync(0, 'utf8')) as { tool_input?: { command?: unknown }; cwd?: unknown };
  if (typeof input?.command !== 'string') throw new Error('no command');
  const rule = commandRule(input.command, typeof cwd === 'string' ? cwd : undefined);
  if (!rule.ok) {
    process.stderr.write(refusal(rule.why));
    process.exitCode = 2;
  }
} catch (e) {
  process.stderr.write(`Not run: the command check failed (${(e as Error).message}).`);
  process.exitCode = 2;
}
