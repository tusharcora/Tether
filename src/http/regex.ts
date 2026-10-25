// src/http/regex.ts
/** A check's `matches` pattern: a JS regex source of at most 200 characters, so a saved file cannot hang a run. */
export function compileRegex(src: unknown): RegExp {
  if (typeof src !== 'string' || src.length > 200) throw new Error('a "matches" pattern must be a string of at most 200 characters');
  try {
    return new RegExp(src);
  } catch (e) {
    throw new Error(`invalid pattern: ${(e as Error).message}`);
  }
}
