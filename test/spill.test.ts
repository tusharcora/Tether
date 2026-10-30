// Cases ported from deepseek-harness spill/spill-policy tests/retention.spec.ts and tests/spill-policy.spec.ts (text results), and the age rule of spill/spill-local (MIT, © 2026 DeepSeek).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CodeSession } from '../src/codemode/session.js';
import { LIMITS } from '../src/codemode/sandbox.js';
import { SPILL_DIR, retain, spillText, sweepSpills } from '../src/codemode/spill.js';
import { startServer } from '../src/server.js';
import { Vault } from '../src/vault.js';
import { initWorkspace } from '../src/workspace.js';
import { makeRepo, setup, tmp } from './helpers.js';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('retain (text)', () => {
  it('keeps half the budget at each end and counts the omitted bytes', () => {
    expect(retain('AAAAABBBBBCCCCC', 6)).toEqual({ head: 'AAA', tail: 'CCC', omittedBytes: 9 });
  });

  it('never duplicates overlapping head and tail content', () => {
    expect(retain('ABCD', 100)).toEqual({ head: 'ABCD', tail: '', omittedBytes: 0 });
  });

  it('omits everything when the notices consume the budget', () => {
    expect(retain('雪', 0)).toEqual({ head: '', tail: '', omittedBytes: 3 });
  });

  it('drops an incomplete surrogate pair at the retained prefix', () => {
    const r = retain('A😀middleZ', 4);
    expect(r.head).toBe('A');
    expect(r.tail).toBe('eZ');
    expect(r.omittedBytes).toBe(bytes('😀middl'));
  });

  it('does not split a surrogate pair at either retained end', () => {
    const r = retain('A😀middle😀Z', 5);
    expect(r.head).toBe('A😀');
    expect(r.tail).toBe('Z');
    expect(r.omittedBytes).toBe(bytes('middle😀'));
  });
});

describe('spillText', () => {
  it('saves the full text owner-only and returns head, tail and a notice within the cap', async () => {
    const dir = tmp('spill-');
    const body = 'HEAD'.repeat(200) + 'TAIL'.repeat(200);
    const out = (await spillText(dir, body, 400))!;
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.startsWith('HEAD')).toBe(true);
    expect(out).toContain('TAIL\n\n(Omitted ');
    const rel = /Full formatted result stored at: (\S+)\./.exec(out)![1]!;
    expect(rel.startsWith(`${SPILL_DIR}/`)).toBe(true);
    expect(out).toContain(`repo.read("${rel}", { from: 1, to: 200 })`);
    expect(readFileSync(join(dir, rel), 'utf8')).toBe(body);
    expect(statSync(join(dir, rel)).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, SPILL_DIR)).mode & 0o777).toBe(0o700);
    const omitted = Number(/Omitted (\d+) bytes/.exec(out)![1]);
    expect(omitted).toBe(bytes(body) - bytes(out.slice(0, out.indexOf('\n\n[...]'))) - bytes(out.slice(out.indexOf('[...]\n\n') + 7, out.lastIndexOf('\n\n('))));
  });

  it('keeps nothing inline when the notice alone exceeds the cap', async () => {
    expect(await spillText(tmp('spill-'), 'x'.repeat(50), 20)).toBeUndefined();
  });

  it('is invisible to git: no status entry, nothing staged', async () => {
    const repo = makeRepo();
    await spillText(repo, 'z'.repeat(5000), 400);
    expect(readdirSync(join(repo, SPILL_DIR))).toHaveLength(1);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })).toBe('');
  });
});

describe('sweepSpills', () => {
  it('deletes regular spill files older than 24 hours and leaves the rest', async () => {
    const dir = tmp('sweep-');
    const sd = join(dir, SPILL_DIR);
    mkdirSync(sd, { recursive: true });
    const now = Date.now();
    const at = (name: string, ageMs: number) => {
      writeFileSync(join(sd, name), name);
      utimesSync(join(sd, name), (now - ageMs) / 1000, (now - ageMs) / 1000);
    };
    at('old.txt', 25 * 3600_000);
    at('edge.txt', 24 * 3600_000 - 60_000);
    at('new.txt', 3600_000);
    const outside = join(tmp('target-'), 'keep.txt');
    writeFileSync(outside, 'keep');
    utimesSync(outside, (now - 48 * 3600_000) / 1000, (now - 48 * 3600_000) / 1000);
    symlinkSync(outside, join(sd, 'link.txt'));
    await sweepSpills(dir, now);
    expect(readdirSync(sd).sort()).toEqual(['edge.txt', 'link.txt', 'new.txt']);
    expect(existsSync(outside)).toBe(true);
  });

  it('never throws for a folder without spills', async () => {
    await expect(sweepSpills(join(tmp('none-'), 'missing'))).resolves.toBeUndefined();
  });
});

describe('run_code output over the limit', () => {
  const session = (workdir: string) =>
    new CodeSession({ home: tmp('home-'), runId: 'r', nodeId: 'n', bot: 'Bot', workdir, writable: false, kind: 'workflow', approved: false, grants: [], handoff: false }, { limits: { ...LIMITS, maxResultBytes: 2000 } });

  it('spills the full output and the model can read it back with repo.read', async () => {
    const dir = tmp('cm-');
    const s = session(dir);
    const r = await s.runCode('return Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\\n")');
    expect(r.isError).toBe(false);
    expect(r.text.length).toBeLessThanOrEqual(2000);
    expect(r.text.startsWith('line 0\nline 1')).toBe(true);
    expect(r.text).toContain('line 399\n\n(Omitted ');
    const rel = /stored at: (\S+)\./.exec(r.text)![1]!;
    const back = await s.runCode(`return await repo.read(${JSON.stringify(rel)}, { from: 200, to: 201 })`);
    expect(back.text).toBe('line 199\nline 200');
    await s.close();
  });

  it('keeps a small result unchanged and writes nothing', async () => {
    const dir = tmp('cm-');
    const r = await session(dir).runCode('return "tiny"');
    expect(r.text).toBe('tiny');
    expect(existsSync(join(dir, SPILL_DIR))).toBe(false);
  });

  it('falls back to the plain cut when the spill cannot be written', async () => {
    const dir = tmp('cm-');
    writeFileSync(join(dir, '.tether'), 'a file where the folder would go');
    const r = await session(dir).runCode('return "y".repeat(5000)');
    expect(r.text).toMatch(/\[\.\.\. cut: 3000 more characters/);
  });
});

describe('server start', () => {
  it('sweeps old spills in run worktrees and workspace folders', async () => {
    const vault = new Vault(tmp('vault-'));
    const s0 = setup(vault);
    const ws = tmp('ws-');
    initWorkspace(s0.home, ws, { id: 'proj' });
    const old = (dir: string) => {
      mkdirSync(join(dir, SPILL_DIR), { recursive: true });
      const f = join(dir, SPILL_DIR, 'old.txt');
      writeFileSync(f, 'x');
      const t = (Date.now() - 25 * 3600_000) / 1000;
      utimesSync(f, t, t);
      return f;
    };
    const a = old(join(s0.home, 'worktrees', 'r1'));
    const b = old(ws);
    const s = await startServer({ engine: s0.engine, store: s0.store, vault, registry: s0.registry, cfg: { home: s0.home, vault: vault.root, adapters: {}, endpoints: {} }, port: 0, webDir: tmp('web-') });
    await expect.poll(() => existsSync(a) || existsSync(b)).toBe(false);
    await s.close();
  });
});
