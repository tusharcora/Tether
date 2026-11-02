// Ported from deepseek-harness experimental/speech-to-text-sensevoice (MIT, © 2026 DeepSeek): the serial worker host.
/**
 * One SenseVoice worker shared by every voice note: started on the first transcription, one recording at a time (a bounded
 * queue), stopped after an idle while. The model downloads only when asked (Settings), with progress; until its files
 * are verified, transcriptions are refused without downloading anything.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { SttConfig } from './config.js';
import { SpeechInputError, type Transcript } from './inference.js';
import { ASSETS, inspectRuntime, prepareRuntime, totalBytes, type Assets, type Progress, type RuntimePaths } from './runtime.js';

export type SttState = { phase: 'checking' } | { phase: 'missing' } | { phase: 'downloading'; done: number; total: number } | { phase: 'ready' } | { phase: 'failed'; error: string };

interface Worker {
  child: ChildProcess;
  waiting: Map<number, { resolve: (t: Transcript) => void; reject: (e: Error) => void }>;
  closed: boolean;
  stderr: string;
}

/** The compiled worker next to this file (dist), or its source under tsx (dev). */
const defaultWorker = () => fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url));

export class SenseVoice {
  private worker?: Worker;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private idle?: NodeJS.Timeout;
  private paths?: RuntimePaths;
  private state: SttState = { phase: 'checking' };
  private preparing?: Promise<void>;
  private seq = 0;
  private disposed = false;
  /** Why the native engine could not start (it will not, in this process). */
  engineError?: string;

  constructor(
    private readonly config: SttConfig,
    private readonly o: { workerPath?: string; fetch?: typeof fetch; assets?: Assets } = {},
  ) {}

  snapshot(): SttState {
    return this.state;
  }

  /** Look for verified files without downloading or starting anything. */
  inspect(): Promise<void> {
    return inspectRuntime(this.config, AbortSignal.timeout(this.config.prepareTimeoutMs), this.o.assets ?? ASSETS)
      .then((paths) => {
        if (this.state.phase === 'downloading') return;
        this.paths = paths;
        this.state = paths ? { phase: 'ready' } : { phase: 'missing' };
      })
      .catch((e: unknown) => void (this.state = { phase: 'failed', error: (e as Error).message }));
  }

  /** Download and verify the model (once; a second call joins the first). */
  prepare(): Promise<void> {
    if (this.state.phase === 'ready' || this.disposed) return Promise.resolve();
    if (this.preparing) return this.preparing;
    const assets = this.o.assets ?? ASSETS;
    const sizes = [assets.model, assets.tokens, assets.vad];
    const total = totalBytes(assets);
    this.state = { phase: 'downloading', done: 0, total };
    const report = (p: Progress) => {
      const before = sizes.slice(0, sizes.findIndex((a) => a.name === p.resource)).reduce((n, a) => n + a.bytes, 0);
      this.state = { phase: 'downloading', done: before + p.completedBytes, total };
    };
    this.preparing = prepareRuntime(this.config, AbortSignal.timeout(this.config.prepareTimeoutMs), report, assets, this.o.fetch)
      .then((paths) => {
        this.paths = paths;
        this.state = { phase: 'ready' };
      })
      .catch((e: unknown) => void (this.state = { phase: 'failed', error: (e as Error).message }))
      .finally(() => (this.preparing = undefined));
    return this.preparing;
  }

  /** One recording (16 kHz mono PCM16), queued behind the others; refused while the model is not ready. */
  async transcribe(pcm: Uint8Array): Promise<Transcript> {
    if (this.disposed) throw new Error('the speech recognizer is stopped');
    if (this.state.phase !== 'ready' || !this.paths) throw new Error('the speech model is not downloaded');
    if (this.pending >= this.config.maxPending) throw new Error('too many voice notes at once: try again in a moment');
    clearTimeout(this.idle);
    this.pending++;
    const job = this.tail.then(() => this.execute(pcm));
    this.tail = job.catch(() => {}).finally(() => {
      this.pending--;
      if (this.pending === 0 && !this.disposed && this.config.idleTimeoutMs > 0) {
        this.idle = setTimeout(() => void (this.tail = this.tail.then(() => this.stop())), this.config.idleTimeoutMs);
        this.idle.unref?.();
      }
    });
    return job;
  }

  private async execute(pcm: Uint8Array): Promise<Transcript> {
    const w = await this.start();
    const id = ++this.seq;
    try {
      return await new Promise<Transcript>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the transcription took too long')), this.config.inferenceTimeoutMs);
        w.waiting.set(id, { resolve: (t) => (clearTimeout(timer), resolve(t)), reject: (e) => (clearTimeout(timer), reject(e)) });
        w.child.send({ id, pcm });
      });
    } catch (e) {
      // a bad recording leaves the worker usable; anything else stops it (the next note starts a fresh one)
      if (!(e instanceof SpeechInputError)) await this.stop();
      throw e;
    } finally {
      w.waiting.delete(id);
    }
  }

  private async start(): Promise<Worker> {
    if (this.worker && !this.worker.closed) return this.worker;
    if (this.engineError) throw new Error(this.engineError);
    await mkdir(this.config.dataRoot, { recursive: true });
    const path = this.o.workerPath ?? defaultWorker();
    const child = spawn(process.execPath, [...(path.endsWith('.ts') ? ['--import', import.meta.resolve('tsx/esm')] : []), path, JSON.stringify({ ...this.config, ...this.paths })], {
      cwd: this.config.dataRoot,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced',
      // the app's own binary runs as Node; the worker needs no secrets from this environment
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ELECTRON_RUN_AS_NODE: '1' },
    });
    const w: Worker = { child, waiting: new Map(), closed: false, stderr: '' };
    child.stderr?.on('data', (d: Buffer) => void (w.stderr = (w.stderr + d.toString('utf8')).slice(-this.config.maxLogBytes)));
    child.on('message', (m: { id?: number; error?: string; input?: boolean } & Partial<Transcript>) => {
      const job = typeof m?.id === 'number' ? w.waiting.get(m.id) : undefined;
      if (!job) return;
      if (typeof m.error === 'string') job.reject(m.input ? new SpeechInputError(m.error) : new Error(m.error));
      else job.resolve({ text: String(m.text ?? ''), audioSeconds: Number(m.audioSeconds ?? 0), inferenceSeconds: Number(m.inferenceSeconds ?? 0) });
    });
    child.on('exit', () => {
      w.closed = true;
      for (const j of w.waiting.values()) j.reject(new Error('the speech worker stopped'));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the speech model took too long to load')), this.config.loadTimeoutMs);
        const ready = (m: { ready?: boolean }) => m?.ready && (clearTimeout(timer), child.off('message', ready), resolve());
        child.on('message', ready);
        child.once('exit', (code) => (clearTimeout(timer), reject(new Error(`the speech engine could not start (exit ${code})${w.stderr ? `: ${w.stderr.trim().split('\n').at(-1)!.slice(0, 200)}` : ''}`))));
        child.once('error', (e) => (clearTimeout(timer), reject(e)));
      });
    } catch (e) {
      child.kill();
      this.engineError = (e as Error).message;
      throw e;
    }
    this.worker = w;
    return w;
  }

  private async stop(): Promise<void> {
    const w = this.worker;
    this.worker = undefined;
    if (!w || w.closed) return;
    await new Promise<void>((r) => {
      w.child.once('exit', () => r());
      w.child.kill();
      setTimeout(r, 2000).unref?.();
    });
  }

  /** Stop the worker; queued recordings settle first. */
  async dispose(): Promise<void> {
    this.disposed = true;
    clearTimeout(this.idle);
    await this.tail.catch(() => {});
    await this.stop();
  }
}
