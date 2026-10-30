// Ported from deepseek-harness experimental/speech-to-text-sensevoice (MIT, © 2026 DeepSeek): pinned assets, verified downloads.
/**
 * The speech model files, pinned by URL, size and SHA-256 (the port's runtime/assets.json, INT8 weights only), downloaded
 * on first use into <home>/models/sensevoice: each into a unique partial file, hashed while it streams, then renamed into
 * place. Nothing is trusted that does not match its pin.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SttConfig } from './config.js';
import { classifyDownloadFailure, SpeechDownloadError } from './download-error.js';
import { orderModelSources } from './model-sources.js';

export interface Asset {
  readonly name: string;
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
}
export interface Assets {
  model: Asset;
  tokens: Asset;
  vad: Asset;
}
export interface RuntimePaths {
  readonly model: string;
  readonly tokens: string;
  readonly vad: string;
}
/** Download progress, for Settings. */
export interface Progress {
  resource: string;
  completedBytes: number;
  totalBytes: number;
}

const HF = 'https://huggingface.co';
export const ASSETS: Assets = {
  model: { name: 'model.int8.onnx', url: `${HF}/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx`, bytes: 239233841, sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51' },
  tokens: { name: 'tokens.txt', url: `${HF}/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt`, bytes: 315894, sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc' },
  vad: { name: 'silero_vad.onnx', url: `${HF}/csukuangfj/vad/resolve/fba88cd2e921609e7675c3aaf51e0b9b295da4bc/silero_vad.onnx`, bytes: 1807522, sha256: 'a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28' },
};
export const totalBytes = (a: Assets = ASSETS) => a.model.bytes + a.tokens.bytes + a.vad.bytes;

export const runtimePaths = (config: SttConfig, a: Assets = ASSETS): RuntimePaths => ({ model: join(config.dataRoot, a.model.name), tokens: join(config.dataRoot, a.tokens.name), vad: join(config.dataRoot, a.vad.name) });

async function matchesAsset(path: string, asset: Asset, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Speech asset is not a regular file: ${asset.name}`);
    if (info.size !== asset.bytes) return false;
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path, { signal })) digest.update(chunk as Buffer);
    return digest.digest('hex') === asset.sha256;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
}

/** The verified files, without downloading or writing anything; undefined when one is missing or does not match its pin. */
export async function inspectRuntime(config: SttConfig, signal: AbortSignal, a: Assets = ASSETS): Promise<RuntimePaths | undefined> {
  const paths = runtimePaths(config, a);
  try {
    await Promise.all([paths.model, paths.tokens, paths.vad].map((p) => access(p)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
  for (const [path, asset] of [
    [paths.model, a.model],
    [paths.tokens, a.tokens],
    [paths.vad, a.vad],
  ] as const)
    if (!(await matchesAsset(path, asset, signal))) return undefined;
  return paths;
}

/** Download into a unique partial file, verify, then publish it atomically. */
export async function downloadAsset(asset: Asset, root: string, signal: AbortSignal, report: (p: Progress) => void = () => {}, f: typeof fetch = fetch): Promise<string> {
  signal.throwIfAborted();
  const destination = join(root, asset.name);
  const partial = `${destination}.${randomUUID()}.part`;
  let source = new URL(asset.url).origin;
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (await matchesAsset(destination, asset, signal)) return destination;
    try {
      const response = await f(asset.url, { signal });
      source = new URL(response.url || asset.url).origin;
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new SpeechDownloadError({ resource: asset.name, source, reason: 'http', status: response.status });
      }
      const digest = createHash('sha256');
      let completedBytes = 0;
      report({ resource: asset.name, completedBytes, totalBytes: asset.bytes });
      const hashing = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          completedBytes += chunk.length;
          if (completedBytes > asset.bytes) return callback(new SpeechDownloadError({ resource: asset.name, source, reason: 'integrity' }));
          digest.update(chunk);
          report({ resource: asset.name, completedBytes, totalBytes: asset.bytes });
          callback(null, chunk);
        },
      });
      await pipeline(response.body, hashing, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal });
      if (completedBytes !== asset.bytes || digest.digest('hex') !== asset.sha256) throw new SpeechDownloadError({ resource: asset.name, source, reason: 'integrity' });
      signal.throwIfAborted();
      await rename(partial, destination);
      return destination;
    } finally {
      await rm(partial, { force: true });
    }
  } catch (error) {
    const timedOut = signal.aborted && (signal.reason as Error | undefined)?.name === 'TimeoutError';
    if ((signal.aborted && !timedOut) || error instanceof SpeechDownloadError) throw error;
    throw new SpeechDownloadError({ resource: asset.name, source, ...(timedOut ? { reason: 'timeout' as const } : classifyDownloadFailure(error)) }, { cause: error });
  }
}

/** Download what is missing (fastest origin first, the others as fallbacks), then verify everything. */
export async function prepareRuntime(config: SttConfig, signal: AbortSignal, report: (p: Progress) => void = () => {}, a: Assets = ASSETS, f: typeof fetch = fetch): Promise<RuntimePaths> {
  const download = async (asset: Asset): Promise<void> => {
    if (await matchesAsset(join(config.dataRoot, asset.name), asset, signal)) return;
    const urls = await orderModelSources(asset.url, config.modelOrigins, config.modelProbeTimeoutMs, signal, f);
    for (const [index, url] of urls.entries()) {
      try {
        await downloadAsset({ ...asset, url }, config.dataRoot, signal, report, f);
        return;
      } catch (error) {
        if (signal.aborted || !(error instanceof SpeechDownloadError) || error.download.reason === 'storage' || error.download.reason === 'unknown' || index === urls.length - 1) throw error;
      }
    }
  };
  for (const asset of [a.model, a.tokens, a.vad]) await download(asset);
  const paths = await inspectRuntime(config, signal, a);
  if (!paths) throw new Error('Speech model verification failed: missing or corrupted model files');
  return paths;
}
