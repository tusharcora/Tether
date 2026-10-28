/**
 * From beui.dev (github.com/starc007/ui-components) `lib/favicon.ts`. MIT License, Copyright (c) 2026 Saurabh Chauhan; the
 * full notice is components/beui/LICENSE. Adapted for Tether: relative imports, Studio tokens through tw.css, lezer instead
 * of Shiki, no metallic or magnetic variants.
 */
/** Resolve a website URL to its conventional root favicon location. */
export function getFaviconUrl(value: string) {
  try {
    return new URL("/favicon.ico", value).toString();
  } catch {
    return null;
  }
}
