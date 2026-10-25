import { createContext, Script, type Context } from 'node:vm';

/**
 * A check's `matches` pattern: a JS regex source of at most 200 characters. The length cap alone does not stop a
 * pattern that backtracks forever (`(a+)+$`): regexTest runs it with a time limit.
 */
export function compileRegex(src: unknown): RegExp {
  if (typeof src !== 'string' || src.length > 200) throw new Error('a "matches" pattern must be a string of at most 200 characters');
  try {
    return new RegExp(src);
  } catch (e) {
    throw new Error(`invalid pattern: ${(e as Error).message}`);
  }
}

export const REGEX_TIMEOUT_MS = 100;
export const REGEX_INPUT_MAX = 64 * 1024;
const script = new Script('new RegExp(src, flags).test(input)');
let ctx: Context | undefined;

/**
 * Test `re` against the first 64 KB of `input` in a vm context with a 100 ms limit, so one saved pattern cannot freeze
 * the server or a run. 'timeout' when the limit cut it short.
 */
export function regexTest(re: RegExp, input: string): boolean | 'timeout' {
  ctx ??= createContext({});
  ctx.src = re.source;
  ctx.flags = re.flags;
  ctx.input = input.length > REGEX_INPUT_MAX ? input.slice(0, REGEX_INPUT_MAX) : input;
  try {
    return script.runInContext(ctx, { timeout: REGEX_TIMEOUT_MS }) === true;
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return 'timeout';
    throw e;
  } finally {
    ctx.input = '';
  }
}
