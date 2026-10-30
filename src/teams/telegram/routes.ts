/**
 * /api/telegram* and /api/squads/:id/pair (loopback, Host and Origin checked by server.ts first): the bot's status, the
 * one-time `/iam` and `/pair` codes, and the voice model download. Never the token (connect and disconnect are under
 * /api/accounts/telegram).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { send } from '../../serverkit.js';
import type { Telegram } from './bot.js';

export interface VoiceSetup {
  /** What Settings shows: the model's state and download progress, and what is missing. */
  view(): unknown;
  /** Start the model download (once; a second call joins it). */
  prepare(): void;
}

export async function telegramRoute(c: { telegram: Telegram; voice: VoiceSetup }, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  const m = req.method ?? 'GET';
  if (p === '/api/telegram' && m === 'GET') return send(res, 200, { ...c.telegram.view(), voice: c.voice.view() }), true;
  if (p === '/api/telegram/iam' && m === 'POST') return send(res, 200, c.telegram.iamCode()), true;
  if (p === '/api/telegram/voice' && m === 'POST') return c.voice.prepare(), send(res, 202, c.voice.view()), true;
  const g = /^\/api\/squads\/([a-z0-9][a-z0-9_-]{0,39})\/pair$/.exec(p);
  if (g && m === 'POST') return send(res, 200, c.telegram.pairCode(g[1]!)), true;
  return false;
}
