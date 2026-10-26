/** Small HTTP helpers shared by server.ts and the route modules it delegates to. */
import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** More fields for the JSON error body, next to `error` (a 409's current mtime, a 423's run). */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const MAX_BODY = 1_000_000;

export async function readJson(req: IncomingMessage, max = MAX_BODY): Promise<any> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > max) throw new HttpError(413, 'request body too large');
    chunks.push(c as Buffer);
  }
  if (!n) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

/** Body must be a JSON object. */
export function reqObject(b: unknown): Record<string, unknown> {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'the body must be a JSON object');
  return b as Record<string, unknown>;
}
