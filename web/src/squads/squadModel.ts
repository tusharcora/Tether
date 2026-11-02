/**
 * A squad's channel (board 8) as data: the Right now strip, the channel filtered to one member, threads, the typing line,
 * who handed work to whom today (the Map), the pulse (pins, what is coming up) and what the sidebar counts as unread.
 * Pure.
 */
import type { TeamMessage, TeamView } from '../teams/teamsApi';

export type Member = TeamView['members'][number];
/** The strip's filter: everyone, the person (you), or one agent's id. */
export type Focus = 'all' | 'you' | string;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const mentions = (text: string, name: string) => new RegExp(`(^|[^\\w@])@${esc(name)}(?![\\w-])`, 'i').test(text);
const waiting = (m: TeamMessage) => (m.card?.kind === 'approval' && m.card.status === 'pending') || (m.card?.kind === 'proposal' && m.card.status === 'proposed');

/** Board 8's Right now: a card per busy agent, a You card when something waits on you, the free agents together. */
export function rightNow(v: Pick<TeamView, 'members' | 'messages'>): { busy: Member[]; you?: { count: number; first: string }; free: Member[] } {
  const busy = v.members.filter((m) => m.state !== 'idle');
  const asks = v.messages.filter(waiting);
  const first = asks[0]?.card;
  const you = asks.length ? { count: asks.length, first: first?.kind === 'approval' ? first.title : first?.kind === 'proposal' ? `Start: ${first.task.split('\n')[0]}` : '' } : undefined;
  return { busy, ...(you ? { you } : {}), free: v.members.filter((m) => m.state === 'idle') };
}

/** The channel: messages outside threads; focused on one member, theirs, the ones that @mention or hand to them (you: what waits on you too). */
export function channel(messages: TeamMessage[], focus: Focus, members: Pick<Member, 'id' | 'name'>[]): TeamMessage[] {
  const top = messages.filter((m) => !m.thread);
  if (focus === 'all') return top;
  if (focus === 'you') return top.filter((m) => m.from.kind === 'person' || mentions(m.text, 'you') || waiting(m));
  const name = members.find((x) => x.id === focus)?.name ?? focus;
  return top.filter((m) => m.from.id === focus || mentions(m.text, name) || m.handoff?.to === focus);
}

/** A thread's replies, oldest first. */
export const threadOf = (messages: TeamMessage[], root: string): TeamMessage[] => messages.filter((m) => m.thread === root && !m.pending);
/** "2 replies · Bolt fixed it": how many, the faces that replied, and the last reply's first words. */
export function threadSummary(messages: TeamMessage[], root: string): { n: number; who: string[]; line: string } | undefined {
  const r = threadOf(messages, root);
  if (!r.length) return undefined;
  const last = r.at(-1)!;
  const words = last.text.split(/(?<=[.!?])\s/)[0]!.replace(/[.!?]$/, '').slice(0, 40);
  return { n: r.length, who: [...new Set(r.map((m) => m.from.id))], line: `${last.from.name} ${words.charAt(0).toLowerCase()}${words.slice(1)}` };
}

/** The live typing line: an agent writing a message now ("Lens is reading Bolt's change", "Lens is typing"). */
export function typing(messages: TeamMessage[], thread?: string): { id: string; name: string; line: string } | undefined {
  const m = [...messages].reverse().find((x) => x.pending && x.from.kind === 'agent' && x.thread === thread);
  if (!m) return undefined;
  const doing = m.text.replace(/…$/, '').trim();
  return { id: m.from.id, name: m.from.name, line: doing && doing !== '…' ? `is ${doing.charAt(0).toLowerCase()}${doing.slice(1)}` : 'is typing' };
}

const startOfDay = (now: number) => new Date(now).setHours(0, 0, 0, 0);
/**
 * The Map: who handed work to whom today (an agent's hand-off chip, a person's @mention of an agent), counted, and live
 * while the one it went to is working now.
 */
export function mapToday(messages: TeamMessage[], members: Pick<Member, 'id' | 'name' | 'state'>[], now = Date.now()): { from: string; to: string; n: number; live: boolean }[] {
  const from0 = startOfDay(now);
  const n = new Map<string, number>();
  const add = (a: string, b: string) => n.set(`${a}\u0000${b}`, (n.get(`${a}\u0000${b}`) ?? 0) + 1);
  for (const m of messages) {
    if (m.at < from0) continue;
    if (m.handoff) add(m.from.id, m.handoff.to);
    else if (m.from.kind === 'person') for (const a of members) if (mentions(m.text, a.name)) add('you', a.id);
  }
  return [...n].map(([k, count]) => {
    const [from, to] = k.split('\u0000') as [string, string];
    return { from, to, n: count, live: members.some((a) => a.id === to && a.state !== 'idle') };
  });
}

/** Pinned messages for the pulse: a message with a link reads "Link", anything else "Decision"; newest pin first. */
export function pinned(messages: TeamMessage[]): { id: string; kind: 'Link' | 'Decision'; text: string; url?: string }[] {
  return messages
    .filter((m) => m.pinned)
    .sort((a, b) => b.pinned!.at - a.pinned!.at)
    .map((m) => {
      const url = /https?:\/\/[^\s)]+/.exec(m.text)?.[0];
      return { id: m.id, kind: url ? ('Link' as const) : ('Decision' as const), text: m.text.replace(/^decision:\s*/i, ''), ...(url ? { url } : {}) };
    });
}

const SEEN_KEY = 'tether.squads.seen';
/** When each squad was last looked at, on this machine (a per-viewer convenience). */
export function seenAt(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}
export function markSeen(id: string, at = Date.now()): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...seenAt(), [id]: at }));
  } catch {
    /* private mode: unread counts just stay */
  }
}
/** Messages from others since the squad was last looked at. */
export const unread = (recent: number[], seen?: number): number => recent.filter((t) => t > (seen ?? 0)).length;
