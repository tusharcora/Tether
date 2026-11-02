/**
 * Telegram voice notes are Ogg/Opus; the recognizer takes 16 kHz mono PCM16. A Mac decodes Ogg/Opus with its own
 * `afconvert` (no install); elsewhere `ffmpeg` does it when it is on PATH. Both run on this machine: audio never leaves it.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { runProcess } from '../proc.js';

export interface Decoder {
  name: 'afconvert' | 'ffmpeg';
  cmd: string;
}

const AFCONVERT = '/usr/bin/afconvert';

/** The decoder this machine has, or undefined (then voice notes say what is missing). */
export function findDecoder(platform: NodeJS.Platform = process.platform, path = process.env.PATH ?? ''): Decoder | undefined {
  if (platform === 'darwin' && existsSync(AFCONVERT)) return { name: 'afconvert', cmd: AFCONVERT };
  const ffmpeg = path
    .split(delimiter)
    .filter(Boolean)
    .map((d) => join(d, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'))
    .find((f) => existsSync(f));
  return ffmpeg ? { name: 'ffmpeg', cmd: ffmpeg } : undefined;
}

/** The PCM16 samples of a 16 kHz mono 16-bit WAV, walking its chunks (afconvert writes an extensible format and padding chunks). */
export function pcmOf(wav: Buffer): Buffer {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('the decoder did not write a WAV file');
  let fmt = false;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = wav.toString('ascii', at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      const format = wav.readUInt16LE(body);
      const pcm = format === 1 || (format === 0xfffe && size >= 40 && wav.readUInt16LE(body + 24) === 1);
      if (!pcm || wav.readUInt16LE(body + 2) !== 1 || wav.readUInt32LE(body + 4) !== 16000 || wav.readUInt16LE(body + 14) !== 16) throw new Error('the decoder wrote something other than 16 kHz mono 16-bit PCM');
      fmt = true;
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before its format');
      return wav.subarray(body, Math.min(body + size, wav.length) - ((Math.min(size, wav.length - body)) % 2));
    }
    at = body + size + (size % 2);
  }
  throw new Error('the decoded WAV has no audio');
}

/** Ogg/Opus to 16 kHz mono PCM16, through a private temp folder that is removed after. */
export async function decodeOgg(ogg: Buffer, d: Decoder, signal: AbortSignal = AbortSignal.timeout(60_000)): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'tether-voice-'));
  try {
    const input = join(dir, 'in.ogg');
    const output = join(dir, 'out.wav');
    writeFileSync(input, ogg, { mode: 0o600 });
    const args = d.name === 'afconvert' ? ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', input, output] : ['-nostdin', '-loglevel', 'error', '-i', input, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', output];
    const r = await runProcess({ cmd: d.cmd, args, cwd: dir, signal });
    if (r.code !== 0) throw new Error(`${d.name} could not read the voice note`);
    return pcmOf(readFileSync(output));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
