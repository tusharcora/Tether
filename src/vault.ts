import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { NodeState, RunState } from './types.js';

export interface VaultNote {
  /** Vault-relative path with forward slashes, including .md */
  path: string;
  title: string;
  type?: string;
  tags: string[];
  /** Raw wikilink targets as written. */
  links: string[];
  body: string;
  mtime: number;
}

export interface GraphNode {
  id: string;
  title: string;
  type?: string;
  tags: string[];
  degree: number;
}
export interface Graph {
  nodes: GraphNode[];
  edges: { from: string; to: string }[];
  unresolved: number;
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash']);
const MAX_NOTES = 20_000;
const MAX_NOTE_BYTES = 1_000_000;
const STOP = new Set(
  'the and for with that this from into have has are was were will would should could can not but you your our use using add fix make new via out all any more less when then than also just only about over under each per'.split(' '),
);

const sanitizeSegment = (s: string) => s.replace(/[<>:"|?*\\\x00-\x1f]/g, '_').replace(/^\.+$/, '_').trim() || '_';
const noExt = (p: string) => p.replace(/\.md$/i, '');

/** Agent output must not be able to mint links in the graph. */
export const neutralizeLinks = (s: string) => s.replaceAll('[[', '[ [').replaceAll(']]', '] ]');

export function extractLinks(body: string): string[] {
  const clean = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const out: string[] = [];
  const re = /\[\[([^\]|#\n]+?)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out.push(m[1]!.trim());
  return out;
}

export function parseNote(path: string, raw: string, mtime = 0): VaultNote {
  let body = raw;
  let fm: Record<string, unknown> = {};
  if (raw.startsWith('---\n') || raw.startsWith('---\r\n')) {
    const end = raw.indexOf('\n---', 3);
    if (end > 0) {
      try {
        const parsed = parseYaml(raw.slice(3, end));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) fm = parsed as Record<string, unknown>;
      } catch {
        /* malformed frontmatter is treated as body text */
      }
      body = raw.slice(end + 4).replace(/^\r?\n/, '');
    }
  }
  const t = fm.tags;
  const tags = Array.isArray(t) ? t.map(String) : typeof t === 'string' ? t.split(/[,\s]+/).filter(Boolean) : [];
  return {
    path,
    title: basename(path).replace(/\.md$/i, ''),
    type: typeof fm.type === 'string' ? fm.type : undefined,
    tags,
    links: extractLinks(body),
    body,
    mtime,
  };
}

const STUB_TEXT = {
  pipeline: 'Runs of this pipeline link here — see backlinks.',
  role: 'Add standing guidance for this role here; it is retrieved as context for future runs.',
  file: 'Notes about this file. Runs that touched it appear under backlinks.',
} as const;

/** An untouched auto-created stub carries no information, so it is never worth prompt space. */
export function isStub(n: VaultNote): boolean {
  const text = STUB_TEXT[n.type as keyof typeof STUB_TEXT];
  return !!text && n.body.trim() === `# ${n.title}\n\n${text}`;
}

export class Vault {
  readonly root: string;
  private cache?: { at: number; notes: VaultNote[] };

  constructor(root: string) {
    this.root = resolve(root);
  }

  async ensure(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  invalidate() {
    this.cache = undefined;
  }

  async scan(maxAgeMs = 5000): Promise<VaultNote[]> {
    if (this.cache && Date.now() - this.cache.at < maxAgeMs) return this.cache.notes;
    const notes: VaultNote[] = [];
    const walk = async (dir: string, rel: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (notes.length >= MAX_NOTES) return;
        if (e.isDirectory()) {
          if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
          await walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
        } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          const abs = join(dir, e.name);
          try {
            const st = await stat(abs);
            if (st.size > MAX_NOTE_BYTES) continue;
            notes.push(parseNote(rel ? `${rel}/${e.name}` : e.name, await readFile(abs, 'utf8'), st.mtimeMs));
          } catch {
            /* unreadable note: skip */
          }
        }
      }
    };
    await walk(this.root, '');
    this.cache = { at: Date.now(), notes };
    return notes;
  }

  /** Obsidian-style resolution: full path wins, else unique basename, else shortest path. */
  private resolver(notes: VaultNote[]) {
    const byFull = new Map<string, string>();
    const byBase = new Map<string, string[]>();
    for (const n of notes) {
      const k = noExt(n.path).toLowerCase();
      byFull.set(k, n.path);
      const b = k.split('/').pop()!;
      byBase.set(b, [...(byBase.get(b) ?? []), n.path]);
    }
    return (target: string): string | undefined => {
      const clean = target.trim().replace(/^\.?\//, '').toLowerCase();
      // `[[Files/a.md]]` can name the note "Files/a.md.md" — try the literal target before stripping an extension.
      if (byFull.has(clean)) return byFull.get(clean);
      const t = noExt(clean);
      if (byFull.has(t)) return byFull.get(t);
      if (t.includes('/')) {
        for (const [k, p] of byFull) if (k.endsWith('/' + t)) return p;
        return undefined;
      }
      const c = byBase.get(t);
      return c?.sort((a, b) => a.length - b.length)[0];
    };
  }

  async graph(): Promise<Graph> {
    const notes = await this.scan();
    const resolveLink = this.resolver(notes);
    const edges: Graph['edges'] = [];
    const seen = new Set<string>();
    let unresolved = 0;
    const degree = new Map<string, number>();
    for (const n of notes) {
      for (const l of new Set(n.links)) {
        const to = resolveLink(l);
        if (!to) {
          unresolved++;
          continue;
        }
        if (to === n.path) continue;
        const k = `${n.path}\0${to}`;
        if (seen.has(k)) continue;
        seen.add(k);
        edges.push({ from: n.path, to });
        degree.set(n.path, (degree.get(n.path) ?? 0) + 1);
        degree.set(to, (degree.get(to) ?? 0) + 1);
      }
    }
    return {
      nodes: notes.map((n) => ({ id: n.path, title: n.title, type: n.type, tags: n.tags, degree: degree.get(n.path) ?? 0 })),
      edges,
      unresolved,
    };
  }

  async backlinks(path: string): Promise<string[]> {
    const g = await this.graph();
    return g.edges.filter((e) => e.to === path).map((e) => e.from);
  }

  async read(path: string): Promise<VaultNote | undefined> {
    const abs = this.safePath(path);
    try {
      const st = await stat(abs);
      return parseNote(path, await readFile(abs, 'utf8'), st.mtimeMs);
    } catch {
      return undefined;
    }
  }

  /** Keyword retrieval with a one-hop graph boost: notes linked to strong hits rise. */
  async search(query: string, limit = 6, exclude: Set<string> = new Set()): Promise<{ note: VaultNote; score: number }[]> {
    const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])].filter((t) => !STOP.has(t));
    if (!terms.length) return [];
    const notes = await this.scan();
    const resolveLink = this.resolver(notes);
    const base = new Map<string, number>();
    for (const n of notes) {
      if (exclude.has(n.path) || isStub(n)) continue;
      const title = n.title.toLowerCase();
      const body = n.body.toLowerCase();
      let s = 0;
      for (const t of terms) {
        if (title.includes(t)) s += 5;
        if (n.tags.some((x) => x.toLowerCase().includes(t))) s += 3;
        let c = 0;
        for (let i = body.indexOf(t); i >= 0 && c < 5; i = body.indexOf(t, i + t.length)) c++;
        s += c;
      }
      if (s > 0) base.set(n.path, s);
    }
    const boosted = new Map(base);
    const byPath = new Map(notes.map((n) => [n.path, n]));
    const useless = (p: string) => exclude.has(p) || isStub(byPath.get(p)!);
    for (const n of notes) {
      if (useless(n.path)) continue;
      for (const l of new Set(n.links)) {
        const to = resolveLink(l);
        if (!to || to === n.path) continue;
        const sTo = base.get(to) ?? 0;
        const sFrom = base.get(n.path) ?? 0;
        if (sTo > 0) boosted.set(n.path, (boosted.get(n.path) ?? 0) + 0.3 * sTo);
        if (sFrom > 0 && !useless(to)) boosted.set(to, (boosted.get(to) ?? 0) + 0.3 * sFrom);
      }
    }
    return [...boosted.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([p, score]) => ({ note: byPath.get(p)!, score }));
  }

  /** Prompt-ready context block. Empty string if nothing relevant. */
  async contextFor(query: string, opts: { maxChars?: number; limit?: number; exclude?: Set<string> } = {}): Promise<string> {
    const hits = await this.search(query, opts.limit ?? 5, opts.exclude);
    const max = opts.maxChars ?? 6000;
    let out = '';
    for (const { note } of hits) {
      const snippet = note.body.replace(/^#+\s.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 700);
      const block = `### [[${noExt(note.path)}]]${note.type ? ` (${note.type})` : ''}\n${snippet}${
        note.links.length ? `\nLinks: ${[...new Set(note.links)].slice(0, 8).map((l) => `[[${l}]]`).join(', ')}` : ''
      }\n\n`;
      if (out.length + block.length > max) break;
      out += block;
    }
    return out.trim();
  }

  private safePath(rel: string): string {
    const parts = rel.split(/[\\/]+/).filter(Boolean).map(sanitizeSegment);
    const abs = resolve(this.root, ...parts);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) throw new Error('path escapes the vault');
    return abs;
  }

  async writeNote(rel: string, content: string, opts: { overwrite?: boolean } = { overwrite: true }): Promise<boolean> {
    const withExt = rel.toLowerCase().endsWith('.md') ? rel : `${rel}.md`;
    const abs = this.safePath(withExt);
    if (!opts.overwrite) {
      try {
        await stat(abs);
        return false;
      } catch {
        /* does not exist: write */
      }
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
    this.invalidate();
    return true;
  }

  // ---------- run recording ----------

  static runNotePath(s: RunState): string {
    const d = new Date(s.startedAt).toISOString().slice(0, 10);
    return `Runs/${d} ${s.pipeline.name} ${s.id.slice(-6)}.md`;
  }

  /** Write the run, plus stub notes for the pipeline, roles and touched files, all cross-linked. */
  async recordRun(state: RunState, nodeFiles: Record<string, string[]> = {}): Promise<string[]> {
    await this.ensure();
    const written: string[] = [];
    const p = state.pipeline;
    const runPath = Vault.runNotePath(state);
    const fileLink = (f: string) => `[[Files/${f.split('/').map(sanitizeSegment).join('/')}]]`;
    const allFiles = [...new Set(Object.values(nodeFiles).flat())].slice(0, 40);

    const steps = p.nodes
      .map((n) => {
        const ns: NodeState | undefined = state.nodes[n.id];
        const role = n.role ?? n.kind;
        const lines = [`### ${role} (${n.id}) — ${ns?.status ?? 'queued'}`];
        if (n.role) lines.push(`Role: [[Roles/${sanitizeSegment(n.role)}]]`);
        if (n.kind === 'gate') lines.push(`Gate \`${(n.command ?? '').replaceAll('`', "'")}\` → ${ns?.gate ? (ns.gate.ok ? 'passed' : `failed (exit ${ns.gate.exitCode})`) : 'not run'}`);
        if (ns?.loops) lines.push(`Fix loops: ${ns.loops}`);
        if (ns?.verdict) lines.push(`Verdict: ${ns.verdict}`);
        if (ns?.error) lines.push(`Error: ${neutralizeLinks(ns.error).slice(0, 300)}`);
        const files = (nodeFiles[n.id] ?? []).slice(0, 20);
        if (files.length) lines.push(`Files: ${files.map(fileLink).join(', ')}`);
        if (n.kind === 'agent' && ns?.output) lines.push('', neutralizeLinks(ns.output).slice(0, 1500).replace(/^/gm, '> '));
        return lines.join('\n');
      })
      .join('\n\n');

    const note = [
      '---',
      'type: run',
      `runId: ${state.id}`,
      `pipeline: ${p.name}`,
      `status: ${state.status}`,
      `cost_usd: ${state.costUsd.toFixed(4)}`,
      `branch: ${state.branch}`,
      `repo: ${JSON.stringify(state.repo)}`,
      'tags: [aorch/run]',
      '---',
      `# Run: ${neutralizeLinks(state.task.split('\n')[0]!.slice(0, 80))}`,
      '',
      `Pipeline: [[Pipelines/${sanitizeSegment(p.name)}]] · Status: **${state.status}** · Cost: $${state.costUsd.toFixed(4)}`,
      '',
      '## Task',
      neutralizeLinks(state.task),
      '',
      '## Steps',
      steps,
      '',
      ...(allFiles.length ? ['## Files touched', allFiles.map(fileLink).join(' · '), ''] : []),
    ].join('\n');
    await this.writeNote(runPath, note);
    written.push(runPath);

    const stub = async (path: string, type: string, text: string) => {
      if (await this.writeNote(path, `---\ntype: ${type}\ntags: [aorch/${type}]\n---\n# ${basename(path, '.md')}\n\n${text}\n`, { overwrite: false })) written.push(path);
    };
    await stub(`Pipelines/${sanitizeSegment(p.name)}.md`, 'pipeline', 'Runs of this pipeline link here — see backlinks.');
    for (const r of new Set(p.nodes.map((n) => n.role).filter((r): r is string => !!r)))
      await stub(`Roles/${sanitizeSegment(r)}.md`, 'role', 'Add standing guidance for this role here; it is retrieved as context for future runs.');
    for (const f of allFiles)
      await stub(`Files/${f.split('/').map(sanitizeSegment).join('/')}.md`, 'file', 'Notes about this file. Runs that touched it appear under backlinks.');
    return written;
  }
}
