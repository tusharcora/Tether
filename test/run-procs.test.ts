import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkCommand, cleanEnv, detectUrl, devCommand, RunProcs, STREAM_CAP, type ProcMessage } from '../src/runProcs.js';
import { Store } from '../src/store.js';
import { pipe, tmp } from './helpers.js';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (f: () => boolean, ms = 5000) => {
  for (let t = 0; t < ms && !f(); t += 20) await new Promise((r) => setTimeout(r, 20));
  expect(f()).toBe(true);
};

const open: RunProcs[] = [];
afterEach(async () => {
  for (const p of open.splice(0)) await p.stopAll();
});

/** A store with one run whose worktree is a temp folder, and a RunProcs on it collecting the run's messages. */
function rig() {
  const home = tmp('home-');
  const dir = tmp('wt-');
  const store = Store.open(':memory:');
  store.append('r1', { type: 'run.started', pipeline: pipe([], []), task: 't', repo: dir, workdir: dir, baseSha: 'x', branch: 'aorch/r1' });
  const procs = new RunProcs({ home, store });
  open.push(procs);
  const msgs: ProcMessage[] = [];
  procs.on('r1', (m) => msgs.push(m));
  const ended = (id: number) => msgs.find((m): m is Extract<ProcMessage, { type: 'exec.end' }> => m.type === 'exec.end' && m.id === id);
  const text = (id: number) => msgs.flatMap((m) => (m.type === 'exec.output' && m.id === id ? [m.text] : [])).join('');
  return { home, dir, store, procs, msgs, ended, text };
}

describe('Terminal', () => {
  it('runs a command in the run’s worktree and streams its output, then its exit', async () => {
    const r = rig();
    const e = r.procs.exec('r1', 'pwd; echo hi; echo oops >&2; exit 3');
    expect(r.msgs[0]).toMatchObject({ type: 'exec.start', id: e.id, command: 'pwd; echo hi; echo oops >&2; exit 3' });
    await until(() => !!r.ended(e.id));
    expect(r.text(e.id)).toContain(realpathSync(r.dir));
    expect(r.text(e.id)).toContain('hi\n');
    expect(r.text(e.id)).toContain('oops\n');
    expect(r.ended(e.id)).toMatchObject({ code: 3 });
    expect(r.procs.history('r1')).toMatchObject([{ id: e.id, running: false, code: 3 }]);
  });

  it('runs one command at a time, and Stop kills its whole process group', async () => {
    const r = rig();
    const e = r.procs.exec('r1', 'sleep 30 & echo "child $!"; wait');
    expect(() => r.procs.exec('r1', 'true')).toThrow(/still running/);
    await until(() => /child \d+/.test(r.text(e.id)));
    const child = Number(/child (\d+)/.exec(r.text(e.id))![1]);
    expect(alive(child)).toBe(true);
    expect(r.procs.stopExec('r1')).toBe(true);
    await until(() => !!r.ended(e.id));
    await until(() => !alive(child));
    expect(r.procs.stopExec('r1')).toBe(false);
  });

  it('gives commands the PATH but none of Tether’s keys or tokens', async () => {
    const r = rig();
    process.env.GH_TOKEN = 'ghp_secret';
    process.env.OPENROUTER_API_KEY = 'sk-or-secret';
    process.env.TETHER_PORT = '4999';
    try {
      const e = r.procs.exec('r1', 'env');
      await until(() => !!r.ended(e.id));
      const out = r.text(e.id);
      expect(out).toMatch(/^PATH=/m);
      expect(out).not.toContain('secret');
      expect(out).not.toContain('TETHER_PORT');
    } finally {
      delete process.env.GH_TOKEN;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.TETHER_PORT;
    }
    expect(cleanEnv({ PATH: '/bin', LC_ALL: 'C', AWS_SECRET_ACCESS_KEY: 'x', AORCH_HOME: '/h' }, { PORT: '1' })).toEqual({ PATH: '/bin', LC_ALL: 'C', FORCE_COLOR: '0', PORT: '1' });
  });

  it('keeps the last 50 commands', async () => {
    const r = rig();
    let last = 0;
    for (let i = 0; i < 52; i++) {
      last = r.procs.exec('r1', `echo ${i}`).id;
      await until(() => !!r.ended(last));
    }
    const h = r.procs.history('r1');
    expect(h).toHaveLength(50);
    expect(h[0]!.command).toBe('echo 2');
    expect(h.at(-1)!.output).toBe('51\n');
  });

  it('shows the first 100k characters and saves all of a longer output in the worktree', async () => {
    const r = rig();
    const e = r.procs.exec('r1', "head -c 150000 /dev/zero | tr '\\0' a");
    await until(() => !!r.ended(e.id));
    const end = r.ended(e.id)!;
    expect(end.spill).toMatch(/^\.tether\/spill\/[0-9a-f]+\.txt$/);
    expect(readFileSync(join(r.dir, end.spill!), 'utf8')).toHaveLength(150_000);
    expect(r.procs.history('r1')[0]!.output.length).toBeLessThan(STREAM_CAP + 200);
    expect(r.text(e.id)).toContain('saved when the command ends');
  });

  it('refuses an unknown run and a run whose worktree is gone', () => {
    const r = rig();
    expect(() => r.procs.exec('rnope', 'true')).toThrow(/unknown run/);
    r.store.append('r2', { type: 'run.started', pipeline: pipe([], []), task: 't', repo: r.dir, workdir: join(r.dir, 'gone'), baseSha: 'x', branch: 'b' });
    expect(() => r.procs.exec('r2', 'true')).toThrow(/worktree is gone/);
  });

  it('checks a command: text, at most 2000 characters, no NUL', () => {
    expect(checkCommand('  npm test ')).toBe('npm test');
    for (const bad of ['', '   ', 3, 'x'.repeat(2001), 'a\0b']) expect(() => checkCommand(bad)).toThrow();
  });
});

describe('Preview', () => {
  it('reads loopback URLs through colour codes and ignores other hosts', () => {
    expect(detectUrl('  ➜  Local:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\n')).toBe('http://localhost:5173/');
    expect(detectUrl('ready on http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(detectUrl('see http://[::1]:8080/app?x=1 now')).toBe('http://[::1]:8080/app?x=1');
    expect(detectUrl('Network: http://192.168.1.4:5173/ and https://example.com')).toBeUndefined();
    expect(detectUrl('http://localhost.evil.com:80/')).toBeUndefined();
  });

  it('picks the dev script, else start, else none', () => {
    const d = tmp('pkg-');
    expect(devCommand(d)).toBeUndefined();
    writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { start: 'node s.js' } }));
    expect(devCommand(d)).toBe('npm run start');
    writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { start: 'x', dev: 'vite' } }));
    expect(devCommand(d)).toBe('npm run dev');
  });

  it('starts the command with PORT set, reads its URL, and stops it', async () => {
    const r = rig();
    await expect(r.procs.startPreview('r1')).rejects.toMatchObject({ status: 400 });
    const v = await r.procs.startPreview('r1', 'echo "Local: http://localhost:$PORT/"; sleep 30');
    expect(v).toMatchObject({ status: 'starting', command: 'echo "Local: http://localhost:$PORT/"; sleep 30' });
    expect(v.port).toBeGreaterThan(0);
    await until(() => r.procs.preview('r1')?.status === 'running');
    expect(r.procs.preview('r1')!.url).toBe(`http://localhost:${v.port}/`);
    // asking again returns the one going
    expect((await r.procs.startPreview('r1', 'other')).command).toBe(v.command);
    expect(existsSync(join(r.home, 'procs.json'))).toBe(true);
    expect(r.procs.stopPreview('r1')).toBe(true);
    await until(() => !existsSync(join(r.home, 'procs.json')));
    expect(r.procs.preview('r1')!.status).toBe('stopped');
  });

  it('a run’s delete ends its command and its preview', async () => {
    const r = rig();
    const e = r.procs.exec('r1', 'sleep 30');
    await r.procs.startPreview('r1', 'sleep 30');
    await r.procs.stopRun('r1');
    expect(r.procs.history('r1')).toEqual([]);
    expect(r.procs.preview('r1')).toBeUndefined();
    expect(r.ended(e.id)).toBeDefined();
    expect(existsSync(join(r.home, 'procs.json'))).toBe(false);
  });

  it('on start, ends the process groups a crashed Tether left (and only those)', async () => {
    const home = tmp('home-');
    const left = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    const other = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    left.unref();
    other.unref();
    await new Promise((r) => setTimeout(r, 100));
    try {
      writeFileSync(join(home, 'procs.json'), JSON.stringify({ [left.pid!]: { run: 'r1', at: Date.now() }, [other.pid!]: { run: 'r1', at: Date.now() - 3_600_000 } }));
      new RunProcs({ home, store: Store.open(':memory:') });
      await until(() => !alive(left.pid!));
      expect(alive(other.pid!)).toBe(true);
      expect(existsSync(join(home, 'procs.json'))).toBe(false);
    } finally {
      for (const c of [left, other]) if (alive(c.pid!)) process.kill(-c.pid!, 'SIGKILL');
    }
  });
});
