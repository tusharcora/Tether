// Ported from deepseek-harness experimental/speech-to-text-sensevoice (MIT, © 2026 DeepSeek): the recognition child process.
/**
 * The speech worker: a child process (the app's own binary as Node) that loads the native model once and answers
 * transcriptions over Node IPC, one at a time. The port's authenticated loopback HTTP server is replaced by IPC: no
 * listening socket, no token. Audio arrives over the pipe and never leaves this Mac.
 */
import { sttDefaults, type SttConfig } from './config.js';
import { createTranscriber, SpeechInputError } from './inference.js';
import type { RuntimePaths } from './runtime.js';

const raw = JSON.parse(process.argv[2] ?? '{}') as Partial<SttConfig & RuntimePaths>;
for (const k of ['dataRoot', 'model', 'tokens', 'vad'] as const) if (typeof raw[k] !== 'string' || !raw[k]) throw new Error(`speech worker: missing ${k}`);
const config = { ...sttDefaults(raw.dataRoot!), ...raw } as SttConfig & RuntimePaths;
const transcribe = createTranscriber(config);
process.on('message', (m: { id?: unknown; pcm?: unknown }) => {
  if (typeof m?.id !== 'number' || !(m.pcm instanceof Uint8Array)) return;
  try {
    process.send!({ id: m.id, ...transcribe(m.pcm) });
  } catch (e) {
    process.send!({ id: m.id, error: (e as Error).message, ...(e instanceof SpeechInputError ? { input: true } : {}) });
  }
});
process.on('disconnect', () => process.exit(0));
process.send!({ ready: true });
