/** Pinned runs and saved API requests, shown in the sidebar's Pinned section: <home>/pins.json. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from './serverkit.js';

export interface Pin {
  kind: 'run' | 'request';
  /** A run id, or a saved request id (`collection/name`). */
  id: string;
  label: string;
  /** Requests: the workspace the request is saved in. */
  ws?: string;
}

export const MAX_PINS = 50;
const MAX_TEXT = 200;
const file = (home: string) => join(home, 'pins.json');

/** One pin as sent or stored, or a reason it is not one. */
function pinOf(v: unknown): Pin | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'each pin must be an object';
  const o = v as Record<string, unknown>;
  if (o.kind !== 'run' && o.kind !== 'request') return '"kind" must be "run" or "request"';
  const text = (k: string) => typeof o[k] === 'string' && !!(o[k] as string).trim() && (o[k] as string).length <= MAX_TEXT && !/[\n\r]/.test(o[k] as string);
  if (!text('id') || !text('label')) return `"id" and "label" must be single lines of 1 to ${MAX_TEXT} characters`;
  if (o.ws !== undefined && !text('ws')) return '"ws" must be a workspace id';
  return { kind: o.kind, id: o.id as string, label: o.label as string, ...(o.ws !== undefined ? { ws: o.ws as string } : {}) };
}

/** The saved pins; a missing or broken file is no pins, and a broken entry is dropped. */
export function loadPins(home: string): Pin[] {
  try {
    const j = JSON.parse(readFileSync(file(home), 'utf8')) as { pins?: unknown };
    return (Array.isArray(j.pins) ? j.pins : []).map(pinOf).filter((p): p is Pin => typeof p !== 'string').slice(0, MAX_PINS);
  } catch {
    return [];
  }
}

/** A PUT body's pins, or a 400 naming the first problem. */
export function checkPins(body: unknown): Pin[] {
  const list = body && typeof body === 'object' ? (body as { pins?: unknown }).pins : undefined;
  if (!Array.isArray(list)) throw new HttpError(400, '"pins" must be an array');
  if (list.length > MAX_PINS) throw new HttpError(400, `too many pins (max ${MAX_PINS})`);
  return list.map((v) => {
    const p = pinOf(v);
    if (typeof p === 'string') throw new HttpError(400, p);
    return p;
  });
}

export function savePins(home: string, pins: Pin[]): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(`${file(home)}.tmp`, JSON.stringify({ pins }, null, 2) + '\n');
  renameSync(`${file(home)}.tmp`, file(home));
}
