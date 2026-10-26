/** The Code Mode note every agent's system prompt gains (spec §4.2 Prompting). */
export const CODE_MODE_NOTE =
  'Code Mode: Tether gives you one tool, run_code, that runs a short JavaScript program in a local sandbox with typed connectors (repo, tether, github, http, mcp.*). ' +
  'Use it to compose several reads, searches and connector calls in ONE script (loops, filters, Promise.all) and return only what you need, instead of many separate tool calls. ' +
  'If you are unsure what exists, start with codemode.search("…") or codemode.describe("repo").';

export const RUN_CODE_SCHEMA = {
  type: 'object',
  properties: { code: { type: 'string', description: 'The body of an async JavaScript function (TypeScript types are stripped). `return` what you need.' } },
  required: ['code'],
} as const;
