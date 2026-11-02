/**
 * The SenseVoice port (src/stt): download classification and source order (the port's own cases), verified downloads
 * against pinned fakes, the WAV walk and a real Ogg/Opus decode where this machine has a decoder, and the worker host over
 * its real IPC boundary with a stand-in worker (no native module, no model, no network).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sttDefaults } from '../src/stt/config.js';
import { decodeOgg, findDecoder, pcmOf } from '../src/stt/decode.js';
import { classifyDownloadFailure, SpeechDownloadError } from '../src/stt/download-error.js';
import { validatePcm } from '../src/stt/inference.js';
import { orderModelSources } from '../src/stt/model-sources.js';
import { SenseVoice } from '../src/stt/recognizer.js';
import { downloadAsset, inspectRuntime, prepareRuntime, type Asset, type Assets } from '../src/stt/runtime.js';
import { LocalVoice } from '../src/stt/voice.js';
import { NO_MODEL } from '../src/teams/telegram/bot.js';
import { tmp } from './helpers.js';

const FAKE_WORKER = fileURLToPath(new URL('./fixtures/fake-stt-worker.mjs', import.meta.url));
const OGG = fileURLToPath(new URL('./fixtures/voice.ogg', import.meta.url));
const HF = 'https://huggingface.co';
const MIRROR = 'https://hf-mirror.com';

const body = (s: string) => Buffer.from(s);
const asset = (name: string, content: string): Asset => ({ name, url: `${HF}/owner/model/resolve/pinned/${name}`, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
const ASSETS: Assets = { model: asset('model.int8.onnx', 'pinned ONNX fixture'), tokens: asset('tokens.txt', 'a b c'), vad: asset('silero_vad.onnx', 'vad fixture') };
const CONTENT: Record<string, string> = { 'model.int8.onnx': 'pinned ONNX fixture', 'tokens.txt': 'a b c', 'silero_vad.onnx': 'vad fixture' };

/** A fake Hugging Face (and mirror): HEAD answers per origin, GET serves the pinned bytes (or what `bad` says). */
function hub(o: { head?: Record<string, number>; bad?: Record<string, string | number> } = {}) {
  const seen: string[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const name = u.pathname.split('/').pop()!;
    seen.push(`${init?.method ?? 'GET'} ${u.origin} ${name}`);
    if (init?.method === 'HEAD') return new Response(null, { status: o.head?.[u.origin] ?? 200 });
    const bad = o.bad?.[`${u.origin} ${name}`];
    if (typeof bad === 'number') return new Response('nope', { status: bad });
    return new Response(body(bad ?? CONTENT[name]!));
  }) as typeof fetch;
  return { f, seen };
}

describe('download failures (port)', () => {
  it.each([
    ['ENOTFOUND', 'dns'],
    ['ETIMEDOUT', 'timeout'],
    ['CERT_HAS_EXPIRED', 'certificate'],
    ['ENOSPC', 'storage'],
    ['ECONNREFUSED', 'network'],
  ])('classifies nested %s as %s', (code, reason) => {
    const cause = Object.assign(new Error('private details'), { code });
    expect(classifyDownloadFailure(new TypeError('fetch failed', { cause: new AggregateError([new Error('unknown'), cause]) }))).toEqual({ reason, code });
  });
  it('knows deadlines and keeps generic reasons when a cause is unknown', () => {
    expect(classifyDownloadFailure(new DOMException('expired', 'TimeoutError'))).toEqual({ reason: 'timeout' });
    expect(classifyDownloadFailure(new TypeError('fetch failed'))).toEqual({ reason: 'network' });
    expect(classifyDownloadFailure(Object.assign(new Error('x'), { code: 'PRIVATE' }))).toEqual({ reason: 'unknown' });
    const cyclic = new Error('x');
    cyclic.cause = cyclic;
    expect(classifyDownloadFailure(cyclic)).toEqual({ reason: 'unknown' });
  });
});

describe('model sources (port)', () => {
  it('puts the first origin that answers first, keeps the configured order when none does, probes nothing for one', async () => {
    const path = `${HF}/owner/model/resolve/pinned/model.onnx`;
    const slowHf = hub({ head: { [HF]: 503 } });
    expect(await orderModelSources(path, [HF, MIRROR], 1000, new AbortController().signal, slowHf.f)).toEqual([`${MIRROR}/owner/model/resolve/pinned/model.onnx`, path]);
    const none = hub({ head: { [HF]: 405, [MIRROR]: 500 } });
    expect(await orderModelSources(path, [HF, MIRROR], 1000, new AbortController().signal, none.f)).toEqual([path, `${MIRROR}/owner/model/resolve/pinned/model.onnx`]);
    const one = hub();
    expect(await orderModelSources(path, ['https://private.example', 'https://private.example/'], 50, new AbortController().signal, one.f)).toEqual(['https://private.example/owner/model/resolve/pinned/model.onnx']);
    expect(one.seen).toEqual([]);
    await expect(orderModelSources(path, [HF, MIRROR], 50, AbortSignal.abort(new Error('cancelled')), one.f)).rejects.toThrow('cancelled');
  });
});

describe('verified downloads', () => {
  it('downloads every missing file, checks size and hash, and reports progress; a second prepare downloads nothing', async () => {
    const root = tmp('models-');
    const config = sttDefaults(root);
    const h = hub();
    const progress: number[] = [];
    expect(await inspectRuntime(config, new AbortController().signal, ASSETS)).toBeUndefined();
    const paths = await prepareRuntime(config, new AbortController().signal, (p) => progress.push(p.completedBytes), ASSETS, h.f);
    expect(readFileSync(paths.model, 'utf8')).toBe('pinned ONNX fixture');
    expect(progress.at(-1)).toBe(ASSETS.vad.bytes);
    expect(readdirSync(root).sort()).toEqual(['model.int8.onnx', 'silero_vad.onnx', 'tokens.txt']);
    h.seen.length = 0;
    expect(await prepareRuntime(config, new AbortController().signal, () => {}, ASSETS, h.f)).toEqual(paths);
    expect(h.seen).toEqual([]);
    writeFileSync(paths.tokens, 'x b c');
    expect(await inspectRuntime(config, new AbortController().signal, ASSETS)).toBeUndefined();
  });

  it('refuses a file that does not match its pin and leaves no partial file; falls back to the mirror on an HTTP error', async () => {
    const root = tmp('models-');
    const tampered = hub({ bad: { [`${HF} model.int8.onnx`]: 'tampered ONNX fixtur' } });
    const e = await downloadAsset(ASSETS.model, root, new AbortController().signal, () => {}, tampered.f).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SpeechDownloadError);
    expect((e as SpeechDownloadError).download).toMatchObject({ reason: 'integrity', resource: 'model.int8.onnx' });
    expect(readdirSync(root)).toEqual([]);
    const down = hub({ head: { [MIRROR]: 503 }, bad: { [`${HF} model.int8.onnx`]: 502 } });
    await prepareRuntime(sttDefaults(root), new AbortController().signal, () => {}, ASSETS, down.f);
    expect(down.seen.filter((s) => s.startsWith('GET') && s.endsWith('model.int8.onnx'))).toEqual([`GET ${HF} model.int8.onnx`, `GET ${MIRROR} model.int8.onnx`]);
  });
});

/** A canonical 16 kHz mono PCM16 WAV, optionally with afconvert's extensible format and padding chunk. */
function wav(samples: number[], o: { extensible?: boolean; rate?: number } = {}): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const fmt = Buffer.alloc(o.extensible ? 40 : 16);
  fmt.writeUInt16LE(o.extensible ? 0xfffe : 1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(o.rate ?? 16000, 4);
  fmt.writeUInt32LE((o.rate ?? 16000) * 2, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  if (o.extensible) fmt.writeUInt16LE(1, 24);
  const chunk = (id: string, b: Buffer) => Buffer.concat([Buffer.from(id, 'ascii'), Buffer.from(Uint32Array.of(b.length).buffer), b]);
  const parts = [chunk('fmt ', fmt), ...(o.extensible ? [chunk('FLLR', Buffer.alloc(12))] : []), chunk('data', data)];
  const rest = Buffer.concat([Buffer.from('WAVE', 'ascii'), ...parts]);
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from(Uint32Array.of(rest.length).buffer), rest]);
}

describe('decoding voice notes', () => {
  it('takes the samples out of a plain or an extensible WAV; refuses other formats', () => {
    expect([...new Int16Array(new Uint8Array(pcmOf(wav([1, -2, 3]))).buffer)]).toEqual([1, -2, 3]);
    expect(pcmOf(wav([5, 6], { extensible: true })).length).toBe(4);
    expect(() => pcmOf(wav([1], { rate: 44100 }))).toThrow(/16 kHz/);
    expect(() => pcmOf(Buffer.from('OggS'))).toThrow(/WAV/);
    expect(validatePcm(new Uint8Array(32_000), 64_000)).toBe(1);
    expect(() => validatePcm(new Uint8Array(3), 64_000)).toThrow(/16-bit/);
    expect(() => validatePcm(new Uint8Array(70_000), 64_000)).toThrow(/limit/);
  });

  it('finds afconvert on a Mac, else ffmpeg on PATH, else nothing', () => {
    expect(findDecoder('linux', '/nowhere')).toBeUndefined();
  });

  const d = findDecoder();
  it.skipIf(!d)('decodes a real Ogg/Opus voice note to about a second of 16 kHz PCM', async () => {
    const pcm = await decodeOgg(readFileSync(OGG), d!);
    expect(pcm.length / 32_000).toBeGreaterThan(0.9);
    expect(pcm.length / 32_000).toBeLessThan(1.2);
  });
});

describe('the worker host', () => {
  const ready = (root: string) => {
    const sv = new SenseVoice({ ...sttDefaults(root), idleTimeoutMs: 0 }, { workerPath: FAKE_WORKER, assets: ASSETS });
    return sv;
  };

  it('refuses before the model is ready, then transcribes over IPC, one at a time, keeping the worker for the next', async () => {
    const root = tmp('models-');
    const sv = ready(root);
    await sv.inspect();
    expect(sv.snapshot()).toEqual({ phase: 'missing' });
    await expect(sv.transcribe(new Uint8Array(4))).rejects.toThrow(/not downloaded/);
    const h = hub();
    const sv2 = new SenseVoice({ ...sttDefaults(root), idleTimeoutMs: 0 }, { workerPath: FAKE_WORKER, assets: ASSETS, fetch: h.f });
    await sv2.prepare();
    expect(sv2.snapshot()).toEqual({ phase: 'ready' });
    const [a, b] = await Promise.all([sv2.transcribe(new Uint8Array(32_000)), sv2.transcribe(new Uint8Array(64))]);
    expect([a.text, b.text]).toEqual(['heard 16000 samples', 'heard 32 samples']);
    await expect(sv2.transcribe(new Uint8Array(3))).rejects.toThrow(/16-bit/);
    expect((await sv2.transcribe(new Uint8Array(2))).text).toBe('heard 1 samples');
    // a worker that dies mid-recording: that note fails, the next starts a fresh worker
    await expect(sv2.transcribe(new Uint8Array(4))).rejects.toThrow(/stopped/);
    expect((await sv2.transcribe(new Uint8Array(8))).text).toBe('heard 4 samples');
    await sv2.dispose();
  });

  it('an engine that cannot start: voice notes say so, nothing else breaks', async () => {
    const root = tmp('crash-');
    const sv = new SenseVoice({ ...sttDefaults(root), idleTimeoutMs: 0 }, { workerPath: FAKE_WORKER, assets: ASSETS, fetch: hub().f });
    await sv.prepare();
    await expect(sv.transcribe(new Uint8Array(8))).rejects.toThrow(/could not start \(exit 3\): dyld: Library not loaded/);
    const v = new LocalVoice(root, { sv, decoder: { name: 'afconvert', cmd: '/usr/bin/afconvert' }, engine: true });
    expect(v.unavailable()).toMatch(/could not start on this Mac/);
    await sv.dispose();
  });

  it('what Settings and the bridge are told: no engine, no model, no decoder, ready', async () => {
    const root = tmp('models-');
    const missing = new SenseVoice(sttDefaults(root), { assets: ASSETS });
    expect(new LocalVoice(root, { sv: missing, engine: false }).unavailable()).toMatch(/no speech engine/);
    const v = new LocalVoice(root, { sv: missing, decoder: null, engine: true });
    await missing.inspect();
    expect(v.unavailable()).toBe(NO_MODEL);
    expect(v.view()).toMatchObject({ model: { phase: 'missing' }, decoder: null, engine: true, why: NO_MODEL, size: 241357257 });
    const ok = new SenseVoice(sttDefaults(root), { assets: ASSETS, fetch: hub().f });
    await ok.prepare();
    expect(new LocalVoice(root, { sv: ok, decoder: null, engine: true }).unavailable()).toMatch(/need ffmpeg/);
    expect(new LocalVoice(root, { sv: ok, decoder: { name: 'ffmpeg', cmd: 'ffmpeg' }, engine: true }).unavailable()).toBeUndefined();
    expect(existsSync(join(root, 'model.int8.onnx'))).toBe(true);
  });
});
