// Ported from deepseek-harness experimental/speech-to-text-sensevoice (MIT, © 2026 DeepSeek): SenseVoice inference with Silero VAD.
/**
 * CPU SenseVoice inference, confined to the worker process. Takes 16 kHz mono PCM16 (the decoder's output) instead of the
 * port's WAV bytes; the language hint is always `auto`.
 */
import { createRequire } from 'node:module';
import type { SttConfig } from './config.js';
import type { RuntimePaths } from './runtime.js';

export interface Transcript {
  text: string;
  audioSeconds: number;
  inferenceSeconds: number;
}
interface Stream {
  acceptWaveform(audio: { samples: Float32Array; sampleRate: number }): void;
}
interface Recognizer {
  createStream(): Stream;
  decode(stream: Stream): void;
  getResult(stream: Stream): { text: string };
}
interface Detector {
  acceptWaveform(samples: Float32Array): void;
  isEmpty(): boolean;
  front(externalBuffer: false): { samples: Float32Array };
  pop(): void;
  reset(): void;
  flush(): void;
}
interface Sherpa {
  OfflineRecognizer: new (config: object) => Recognizer;
  Vad: new (config: object, bufferSeconds: number) => Detector;
}

/** A recording refused before it reaches the native recognizer; the worker stays usable. */
export class SpeechInputError extends Error {}

/** Check PCM16 before inference: even length, within the byte limit. Returns its length in seconds. */
export function validatePcm(pcm: Uint8Array, maxAudioBytes: number): number {
  if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) throw new SpeechInputError('Speech audio must be 16-bit PCM');
  if (pcm.byteLength > maxAudioBytes) throw new SpeechInputError('Speech audio exceeds the worker byte limit');
  return pcm.byteLength / 32_000;
}

/** Load the model pair once; every recording resets the VAD. */
export function createTranscriber(config: SttConfig & RuntimePaths): (pcm: Uint8Array) => Transcript {
  // sherpa-onnx-node is a CommonJS Node-API binding with JSDoc but no declarations
  const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as Sherpa;
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { senseVoice: { model: config.model, language: 'auto', useInverseTextNormalization: 1 }, tokens: config.tokens, numThreads: config.threads, provider: 'cpu', debug: 0 },
  });
  const detector = new sherpa.Vad(
    {
      sileroVad: { model: config.vad, threshold: config.vadThreshold, minSilenceDuration: config.minSilenceSeconds, minSpeechDuration: config.minSpeechSeconds, maxSpeechDuration: config.segmentSeconds, windowSize: 512 },
      sampleRate: 16000,
      numThreads: config.threads,
      provider: 'cpu',
      debug: 0,
    },
    config.segmentSeconds + config.minSilenceSeconds + 1,
  );
  return (pcm) => {
    const audioSeconds = validatePcm(pcm, config.maxAudioBytes);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const samples = Float32Array.from({ length: pcm.byteLength / 2 }, (_, i) => view.getInt16(i * 2, true) / 32768);
    detector.reset();
    const started = performance.now();
    const texts: string[] = [];
    const drain = (): void => {
      while (!detector.isEmpty()) {
        // Electron's V8 memory cage needs copied native buffers, VAD output included
        const segment = detector.front(false);
        const stream = recognizer.createStream();
        stream.acceptWaveform({ sampleRate: 16000, samples: segment.samples });
        recognizer.decode(stream);
        texts.push(recognizer.getResult(stream).text.trim());
        detector.pop();
      }
    };
    for (let offset = 0; offset < samples.length; offset += 512) {
      detector.acceptWaveform(samples.subarray(offset, offset + 512));
      drain();
    }
    detector.flush();
    drain();
    return { text: texts.filter(Boolean).join(' ').trim(), audioSeconds, inferenceSeconds: (performance.now() - started) / 1000 };
  };
}
