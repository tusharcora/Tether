// Crew packs: ready-made bundles of bots for a line of work. A pack is just a list of BotDefs.
import { BOT_ID_RE, BUILTIN_IDS, sanitizeBot, type BotDef, type Look } from './crew.js';

const lk = (body: string, eyes: string, mouth: string, top: string, side: string, pattern: string, color: string): Look => ({ body, eyes, mouth, top, side, pattern, color, accent: 'auto', guard: true });

export interface Pack {
  id: string;
  name: string;
  blurb: string;
  bots: BotDef[];
}

export const PACKS: Pack[] = [
  {
    id: 'trading',
    name: 'Trading desk',
    blurb: 'Research, stress-test and sign off on trading ideas and strategy code.',
    bots: [
      { id: 'quant', name: 'Quant', title: 'quant researcher', kind: 'agent', readOnly: true, persona: 'You are a quantitative researcher. Turn the task into testable hypotheses, state the data and assumptions each needs, and design backtests that avoid lookahead and survivorship bias. Report effect sizes and uncertainty, not just point estimates.', look: lk('tall', 'glasses', 'flat', 'antenna', 'none', 'band', '#5b9dff') },
      { id: 'historian', name: 'Historian', title: 'market historian', kind: 'agent', readOnly: true, persona: 'You are a market historian. Find past regimes, crashes and analogues relevant to the task, say how they differ from now, and warn where a strategy would have failed.', look: lk('square', 'sleepy', 'flat', 'none', 'ears', 'belly', '#c9a46a') },
      { id: 'skeptic', name: 'Skeptic', title: 'devil’s advocate', kind: 'verdict', persona: 'You are the skeptic. Attack the work: overfitting, data snooping, hidden costs, slippage, regime change, and fragile assumptions. End with VERDICT: PASS or VERDICT: FAIL and the single biggest risk.', look: lk('pebble', 'wink', 'flat', 'horns', 'none', 'none', '#ff8a5b') },
      { id: 'riskgate', name: 'Risk gate', title: 'limits check', kind: 'gate', persona: 'Hard limits and tests must pass before anything moves on.', look: lk('square', 'visor', 'none', 'none', 'none', 'badge', '#f2c14e') },
      { id: 'trader', name: 'Trader', title: 'implements the strategy', kind: 'agent', persona: 'You implement trading strategy and tooling code. Keep position sizing, risk limits and execution logic explicit and tested. Never place real orders; use paper or simulated execution only.', look: lk('wide', 'dots', 'smile', 'cap', 'arms', 'none', '#6ee7a8') },
      { id: 'desk', name: 'Desk', title: 'desk orchestrator', kind: 'orchestrator', persona: 'You design the pipeline for trading research and strategy work: research first, then a skeptic pass, a risk gate, and only then implementation.', look: lk('tall', 'cyclops', 'flat', 'crown', 'none', 'band', '#b58bff') },
    ],
  },
  {
    id: 'security',
    name: 'Security team',
    blurb: 'Audit code, think like an attacker, and ship careful fixes.',
    bots: [
      { id: 'auditor', name: 'Auditor', title: 'security auditor', kind: 'agent', readOnly: true, persona: 'You are a security auditor. Review the code for injection, authz gaps, secrets, unsafe deserialization, SSRF and dependency risk. List findings with file, line, severity and a concrete fix. Do not modify files.', look: lk('square', 'glasses', 'flat', 'none', 'none', 'badge', '#5bd0ff') },
      { id: 'redteam', name: 'Red Team', title: 'attacker mindset', kind: 'verdict', persona: 'You are a red teamer. Describe how you would actually exploit what has been built, in order of likelihood. End with VERDICT: PASS only if you could not find a realistic attack path, else VERDICT: FAIL.', look: lk('blob', 'tall', 'open', 'horns', 'none', 'spots', '#ff6b8a') },
      { id: 'patcher', name: 'Patcher', title: 'writes the fixes', kind: 'agent', persona: 'You fix security findings with the smallest safe change, add a regression test for each, and explain the fix in one line.', look: lk('pebble', 'dots', 'smile', 'cap', 'arms', 'blush', '#6ee7a8') },
      { id: 'keeper', name: 'Keeper', title: 'sign-off', kind: 'approval', persona: 'A human reviews the findings and fixes before they ship.', look: lk('wide', 'wide', 'flat', 'none', 'none', 'band', '#f2c14e') },
    ],
  },
];

export const findPack = (id: string) => PACKS.find((p) => p.id === id.toLowerCase());

/** Parse untrusted pack/bot JSON (one bot, an array, or {bots:[…]}) into valid bots plus the problems found. */
export function parseBots(raw: unknown): { bots: BotDef[]; errors: string[] } {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { bots?: unknown }).bots) ? (raw as { bots: unknown[] }).bots : [raw];
  const bots: BotDef[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  list.slice(0, 40).forEach((x, i) => {
    const { bot, error } = sanitizeBot(x);
    if (!bot) return void errors.push(`bot ${i + 1}: ${error}`);
    if (seen.has(bot.id)) return void errors.push(`bot ${i + 1}: duplicate id "${bot.id}"`);
    seen.add(bot.id);
    bots.push(bot);
  });
  return { bots, errors };
}

/** Make imported bots safe to add: built-in ids get a fresh id so an import never silently overrides a core bot. */
export function reid(bots: BotDef[], taken: Set<string>): BotDef[] {
  return bots.map((b) => {
    let id = b.id;
    if (BUILTIN_IDS.has(id) || taken.has(id)) {
      const base = id.slice(0, 20);
      for (let i = 2; BUILTIN_IDS.has(id) || taken.has(id) || !BOT_ID_RE.test(id); i++) id = `${base}${i}`;
    }
    taken.add(id);
    return { ...b, id };
  });
}
