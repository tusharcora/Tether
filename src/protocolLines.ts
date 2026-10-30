/**
 * Which lines of an agent's answer may carry a protocol line (`@HAND`, `@ASK`) and which only quote one. Follows CommonMark:
 * a fence opens with three or more backticks or tildes (at most three spaces in) and closes only with the same character,
 * at least as many of them and nothing else on the line; indented code (four spaces or a tab) and `>` quotes are never live.
 * So a quoted README that documents `@HAND` inside ```` and ``` fences never turns its examples into real requests.
 * CRLF tolerated: `line` is the line without its `\r`, `raw` as written.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const NOT_LIVE = /^(?: {0,3}\t| {4}| {0,3}>)/;

export function liveLines(output: string): { raw: string; line: string; live: boolean }[] {
  let open: string | undefined;
  return output.split('\n').map((raw) => {
    const line = raw.replace(/\r$/, '');
    const m = FENCE.exec(line);
    if (open) {
      if (m && m[1]![0] === open[0] && m[1]!.length >= open.length && !m[2]!.trim()) open = undefined;
      return { raw, line, live: false };
    }
    // a backtick fence's info string may not contain a backtick (CommonMark)
    if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) {
      open = m[1];
      return { raw, line, live: false };
    }
    return { raw, line, live: !NOT_LIVE.test(line) };
  });
}
