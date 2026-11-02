/**
 * Voice notes for Telegram teams (spec 2026-10-30 §6.5): the recognizer and the decoder behind the bridge's `Voice`, and
 * what Settings shows (model state, download progress, what is missing). Nothing downloads until the person asks.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Voice } from '../teams/telegram/bot.js';
import { NO_MODEL } from '../teams/telegram/bot.js';
import type { VoiceSetup } from '../teams/telegram/routes.js';
import { sttDefaults } from './config.js';
import { decodeOgg, findDecoder, type Decoder } from './decode.js';
import { SenseVoice, type SttState } from './recognizer.js';
import { totalBytes } from './runtime.js';

/** Is the native engine (sherpa-onnx-node and its build for this machine) in this install? */
export function engineInstalled(): boolean {
  try {
    const req = createRequire(import.meta.url);
    const main = req.resolve('sherpa-onnx-node');
    createRequire(main).resolve(`sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}/sherpa-onnx.node`);
    return true;
  } catch {
    return false;
  }
}

export interface VoiceView {
  model: SttState;
  /** Bytes the model download takes. */
  size: number;
  decoder: Decoder['name'] | null;
  engine: boolean;
  /** Why voice notes cannot be transcribed now, or null. */
  why: string | null;
}

export class LocalVoice implements Voice, VoiceSetup {
  readonly sv: SenseVoice;
  constructor(
    home: string,
    private o: { sv?: SenseVoice; decoder?: Decoder | null; engine?: boolean } = {},
  ) {
    this.sv = o.sv ?? new SenseVoice(sttDefaults(join(home, 'models', 'sensevoice')));
    void this.sv.inspect();
  }
  private get decoder(): Decoder | undefined {
    return this.o.decoder === undefined ? findDecoder() : (this.o.decoder ?? undefined);
  }
  private get engine(): boolean {
    return this.o.engine ?? engineInstalled();
  }

  unavailable(): string | undefined {
    if (!this.engine) return 'Voice notes are off: this build of Tether has no speech engine.';
    if (this.sv.engineError) return 'Voice notes are off: the speech engine could not start on this Mac.';
    const s = this.sv.snapshot();
    if (s.phase === 'downloading' || s.phase === 'checking') return 'The speech model is still downloading — try again in a minute';
    if (s.phase !== 'ready') return NO_MODEL;
    if (!this.decoder) return 'Voice notes need ffmpeg on this computer to read Telegram audio (brew install ffmpeg)';
    return undefined;
  }
  async transcribe(ogg: Buffer): Promise<string> {
    const d = this.decoder;
    if (!d) throw new Error('no audio decoder on this computer');
    return (await this.sv.transcribe(await decodeOgg(ogg, d))).text;
  }
  view(): VoiceView {
    return { model: this.sv.snapshot(), size: totalBytes(), decoder: this.decoder?.name ?? null, engine: this.engine, why: this.unavailable() ?? null };
  }
  prepare(): void {
    void this.sv.prepare();
  }
  dispose(): Promise<void> {
    return this.sv.dispose();
  }
}
