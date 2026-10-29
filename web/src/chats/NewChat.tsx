import { useState } from 'react';
import type { RunRow } from '../api';
import { ChatComposer } from '../assistant/Chat';
import type { AssistantContext } from '../assistant/api';
import type { Assistant } from '../assistant/useAssistant';
import { TetherFace } from '../components/faces/TetherFace';
import { shortRunId } from '../ui/studio/RunGlyph';
import './chats.css';

/** What the starters offer, from the project's real state: the failed-run one only when a run failed. */
export function starters(runs: RunRow[], lastFile?: string): { title: string; desc: string; text: string }[] {
  const failed = runs.filter((r) => r.status === 'error').sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))[0];
  return [
    { title: "What's running right now?", desc: 'Runs, steps and anything waiting on you', text: "What's running right now?" },
    ...(failed ? [{ title: `Why did ${shortRunId(failed.id)} fail?`, desc: 'Your last failed run', text: `Why did run ${failed.id} fail?` }] : []),
    { title: 'Plan a change with the crew', desc: 'Tether drafts it, you approve the run', text: 'Plan a change with the crew: ' },
    lastFile ? { title: `Explain ${lastFile.split('/').pop()}`, desc: 'The file you last opened in Code', text: `Explain ${lastFile}` } : { title: 'Explain a file', desc: 'Name it and Tether reads it', text: 'Explain the file ' },
  ];
}

/** The starter a New chat menu's "About a run" or "About a file" opens with: the failed-run one when a run failed. */
export function starterFor(kind: 'run' | 'file', runs: RunRow[], lastFile?: string): string {
  const all = starters(runs, lastFile);
  return (kind === 'run' ? (all.find((s) => s.text.startsWith('Why did run')) ?? all[0]!) : all.at(-1)!).text;
}

/**
 * The New chat screen (mockup board 1): Tether's face, the question, a large composer and starters built from the project's
 * state. A starter fills the composer for the person to send or finish. Sending makes the chat (the shell then opens it).
 */
export function NewChat(p: { chat: Assistant; project?: { id: string; name: string }; context: AssistantContext; runs: RunRow[]; lastFile?: string; starter?: 'run' | 'file' }) {
  const [draft, setDraft] = useState(() => (p.starter ? starterFor(p.starter, p.runs, p.lastFile) : ''));
  const fill = (text: string) => {
    setDraft(text);
    setTimeout(() => {
      const box = document.querySelector<HTMLTextAreaElement>('.chat-new textarea');
      box?.focus();
      box?.setSelectionRange(text.length, text.length);
    });
  };
  return (
    <div className="chat-new">
      <div className="chat-new-hero">
        <TetherFace size={64} eyeScale={1.1} />
        <h1>{p.project ? `What should we look at in ${p.project.name}?` : 'What should we look at?'}</h1>
      </div>
      <div className="chat-new-box">
        <ChatComposer chat={p.chat} project={p.project?.name} context={p.context} placeholder="Ask Tether about your runs, code or notes…" draft={draft} onDraft={setDraft} />
      </div>
      <ul className="chat-starters" aria-label="Starters">
        {starters(p.runs, p.lastFile).map((s) => (
          <li key={s.title}>
            <button type="button" className="chat-starter" onClick={() => fill(s.text)}>
              <b>{s.title}</b>
              <span>{s.desc}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="chat-new-note">Tether reads your runs, code and notes. It changes things only through cards you approve.</p>
    </div>
  );
}
