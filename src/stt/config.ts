// Ported from deepseek-harness experimental/speech-to-text-sensevoice (MIT, © 2026 DeepSeek): its runtime settings and defaults.
/**
 * Settings of the local SenseVoice recognizer (spec 2026-10-30 §6.5). The port's schemastery validation is dropped: Tether
 * builds this object itself, it is never read from a person or a file. Only INT8 weights (the smaller download).
 */
export interface SttConfig {
  /** Absolute folder for the verified ONNX files: <home>/models/sensevoice. */
  dataRoot: string;
  /** Hugging Face-compatible origins compared before downloading each missing file. */
  modelOrigins: string[];
  /** Deadline for the HEAD probes that pick an origin. */
  modelProbeTimeoutMs: number;
  /** CPU threads for inference. */
  threads: number;
  /** Longest speech segment handed to the recognizer. */
  segmentSeconds: number;
  /** Silero speech probability threshold. */
  vadThreshold: number;
  /** Shortest speech kept by the VAD. */
  minSpeechSeconds: number;
  /** Silence that splits two segments. */
  minSilenceSeconds: number;
  /** Largest PCM the worker takes (16 kHz mono 16-bit: 32 000 bytes a second). */
  maxAudioBytes: number;
  /** Deadline for downloading and verifying the model files. */
  prepareTimeoutMs: number;
  /** Deadline for loading the model in a new worker. */
  loadTimeoutMs: number;
  /** Deadline for one transcription once the worker is ready. */
  inferenceTimeoutMs: number;
  /** Idle time before the worker stops (it loads again on the next voice note). */
  idleTimeoutMs: number;
  /** Most transcriptions running and waiting. */
  maxPending: number;
  /** Most worker diagnostic bytes kept. */
  maxLogBytes: number;
}

export const sttDefaults = (dataRoot: string): SttConfig => ({
  dataRoot,
  modelOrigins: ['https://huggingface.co', 'https://hf-mirror.com'],
  modelProbeTimeoutMs: 3000,
  threads: 2,
  segmentSeconds: 30,
  vadThreshold: 0.5,
  minSpeechSeconds: 0.25,
  minSilenceSeconds: 0.5,
  maxAudioBytes: 125 * 32_000,
  prepareTimeoutMs: 3_600_000,
  loadTimeoutMs: 120_000,
  inferenceTimeoutMs: 120_000,
  idleTimeoutMs: 300_000,
  maxPending: 4,
  maxLogBytes: 64 * 1024,
});
