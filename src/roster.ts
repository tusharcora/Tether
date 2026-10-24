/** Who Maestro may pick from: built-ins and your bots, plus imported specialists that fit the repo and the task. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_IDS, type BotDef, type BotKind } from './crew.js';
import { parseRouting, type Routing } from './ecc.js';
import { vendorDir } from './eccImport.js';

export interface RosterEntry {
  id: string;
  kind: BotKind;
  readOnly: boolean;
  when: string;
  builtin: boolean;
  source?: string;
}

export const ROSTER_CAP = 40;
const SKIP_KINDS = new Set<BotKind>(['orchestrator', 'approval', 'gate']);
const SKIP_IDS = new Set(['manager', 'tester']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.venv']);
const LANGS = new Set(['go', 'typescript', 'javascript', 'python', 'rust', 'java', 'kotlin', 'cpp', 'csharp', 'fsharp', 'php', 'ruby', 'swift', 'flutter', 'dart', 'react', 'vue', 'django', 'fastapi', 'pytorch']);
const net = /network|vlan|router|firewall|dns/i;
const oss = /open.?source|release|publish/i;
const DOMAIN: Record<string, RegExp> = {
  'healthcare-reviewer': /health|clinical|patient|medical/i,
  'mle-reviewer': /\bml\b|machine learning|model training/i,
  'rag-pipeline-reviewer': /\brag\b|retriev|embedding|vector/i,
  'network-architect': net,
  'network-config-reviewer': net,
  'network-troubleshooter': net,
  'homelab-architect': /homelab|home lab|self.?host/i,
  'harmonyos-app-resolver': /harmony/i,
  'bengali-reviewer': /bengali|bangla/i,
  'marketing-agent': /marketing|campaign|landing page/i,
  'seo-specialist': /\bseo\b/i,
  'opensource-forker': oss,
  'opensource-sanitizer': oss,
  'opensource-packager': oss,
  'a11y-architect': /accessib|a11y/i,
};

function readText(f: string): string {
  try {
    return readFileSync(f, 'utf8').slice(0, 200_000);
  } catch {
    return '';
  }
}

function langsIn(dir: string, out: Set<string>): void {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const has = (f: string) => names.includes(f);
  const any = (re: RegExp) => names.some((n) => re.test(n));
  if (has('go.mod')) out.add('go');
  if (has('Cargo.toml')) out.add('rust');
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) {
    out.add('python');
    const txt = readText(join(dir, 'pyproject.toml')) + readText(join(dir, 'requirements.txt'));
    if (/django/i.test(txt)) out.add('django');
    if (/fastapi/i.test(txt)) out.add('fastapi');
    if (/\btorch\b/i.test(txt)) out.add('pytorch');
  }
  if (has('package.json')) {
    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(readText(join(dir, 'package.json')) || '{}') ?? {};
    } catch {
      /* broken package.json: still a JS project */
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    out.add(has('tsconfig.json') || 'typescript' in deps ? 'typescript' : 'javascript');
    if ('react' in deps) out.add('react');
    if ('vue' in deps) out.add('vue');
  }
  if (has('pom.xml')) out.add('java');
  if (has('build.gradle') || has('build.gradle.kts')) {
    out.add('java');
    if (has('build.gradle.kts') || /kotlin/i.test(readText(join(dir, 'build.gradle')))) out.add('kotlin');
  }
  if (has('Package.swift')) out.add('swift');
  if (any(/\.csproj$/)) out.add('csharp');
  if (any(/\.fsproj$/)) out.add('fsharp');
  if (has('composer.json')) out.add('php');
  if (has('Gemfile')) out.add('ruby');
  if (has('pubspec.yaml')) (out.add('flutter'), out.add('dart'));
  if (has('CMakeLists.txt')) out.add('cpp');
}

/** Languages and frameworks in a repo, from files at its root and one folder down. */
export function detectLanguages(dir: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!dir || !existsSync(dir)) return out;
  langsIn(dir, out);
  try {
    for (const d of readdirSync(dir)) {
      if (SKIP_DIRS.has(d) || d.startsWith('.')) continue;
      try {
        if (statSync(join(dir, d)).isDirectory()) langsIn(join(dir, d), out);
      } catch {
        /* unreadable entry */
      }
    }
  } catch {
    /* unreadable repo */
  }
  return out;
}

export function botLanguage(id: string): string | undefined {
  const m = /^([a-z]+)-(?:reviewer|build-resolver|build-resolve)$/.exec(id.replace(/^ecc-/, ''));
  return m && LANGS.has(m[1]!) ? m[1] : undefined;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
// built-ins are recognised by id too: CREW defs registered without load-time flags (tests, packs) still count as built-in
export const entryFor = (b: BotDef): RosterEntry => ({ id: b.id, kind: b.kind, readOnly: !!b.readOnly, when: oneLine(b.whenToUse ?? b.persona ?? b.title), builtin: !!b.builtin || BUILTIN_IDS.has(b.id), ...(b.source ? { source: b.source } : {}) });
const baseName = (id: string) => id.replace(/^ecc-/, '');

export function buildRoster(o: { dir?: string; task: string; crew: BotDef[]; routing?: Routing }): RosterEntry[] {
  const langs = detectLanguages(o.dir);
  const usable = o.crew.filter((b) => !SKIP_KINDS.has(b.kind) && !SKIP_IDS.has(b.id));
  const fixed = usable.filter((b) => b.builtin || !b.source);
  const imported = usable.filter((b) => b.source);
  const lang = imported.filter((b) => {
    const l = botLanguage(b.id);
    return !!l && langs.has(l);
  });
  const domain = imported.filter((b) => DOMAIN[baseName(b.id)]?.test(o.task));
  const order = o.routing?.table ?? [];
  const rank = (b: BotDef) => {
    const i = order.indexOf(baseName(b.id));
    return i < 0 ? order.length : i;
  };
  const general = imported
    .filter((b) => !botLanguage(b.id) && !DOMAIN[baseName(b.id)])
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const out: RosterEntry[] = [];
  for (const b of [...fixed, ...lang, ...domain, ...general]) {
    if (seen.has(b.id) || out.length >= ROSTER_CAP) continue;
    seen.add(b.id);
    out.push(entryFor(b));
  }
  return out;
}

export function rosterLine(e: RosterEntry): string {
  const line = `- ${e.id} (${e.kind}${e.readOnly ? ', read-only' : ''}) — ${e.when}`;
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}
export const rosterText = (es: RosterEntry[]) => es.map(rosterLine).join('\n');

export function routingHints(routing: Routing | undefined, es: RosterEntry[]): string[] {
  if (!routing) return [];
  const ids = new Set(es.map((e) => e.id));
  // ECC's rules name ECC agents: prefer the imported one (ecc-planner) over a built-in with the same name (planner)
  const pick = (name: string) => (ids.has(`ecc-${name}`) ? `ecc-${name}` : ids.has(name) ? name : undefined);
  return routing.rules
    .flatMap((r) => {
      const got = r.agents.map(pick).filter((x): x is string => !!x);
      // a rule's text comes from a vendored file: one line, capped, so it cannot crowd out the prompt
      return got.length ? [`- ${oneLine(r.when).slice(0, 160)} → ${got.join(', ')}`] : [];
    })
    .slice(0, 12);
}

let cache: { file: string; mtime: number; routing: Routing } | undefined;
export function loadRouting(home: string): Routing | undefined {
  const file = join(vendorDir(home), 'AGENTS.md');
  try {
    const mtime = statSync(file).mtimeMs;
    if (cache?.file === file && cache.mtime === mtime) return cache.routing;
    cache = { file, mtime, routing: parseRouting(readFileSync(file, 'utf8')) };
    return cache.routing;
  } catch {
    return undefined;
  }
}
