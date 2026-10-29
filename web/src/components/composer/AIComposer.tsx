/**
 * From the "AI prompt composer with model selector" snippet the project owner supplied. Adapted for Tether: the models,
 * the draft, attachments and streaming come from the caller (the snippet had six made-up models and a demo toast); Auto
 * means "no override", so the server answers with the bound agent's model; Record dictates with the browser's speech
 * recognition (hidden where there is none) instead of inserting a canned prompt. Left out because the assistant has no
 * field for them: the Plan / Ask / Build modes, effort levels and the @ context menu; and the demo-only parts: the Pro
 * banner and modal, the video tour and the theme switcher (the palette follows Tether's data-theme).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { CheckIcon } from 'lucide-react';
import { ModelSelector, ModelSelectorContent, ModelSelectorEmpty, ModelSelectorGroup, ModelSelectorInput, ModelSelectorItem, ModelSelectorList, ModelSelectorLogo, ModelSelectorName, ModelSelectorTrigger } from '../ai-elements/model-selector';
import './AIComposer.css';

export interface AIComposerProps {
  value: string;
  onValueChange: (v: string) => void;
  /** `model` is undefined under Auto. */
  onSubmit: (text: string, model?: string) => void;
  models: string[];
  /** The picked model; undefined is Auto. */
  model?: string;
  onModelChange: (m: string | undefined) => void;
  /** What Auto answers with (the bound agent's model), shown beside "Auto". */
  autoModel?: string;
  loading?: boolean;
  onStop?: () => void;
  files: string[];
  onFiles: (files: File[]) => void;
  onRemoveFile: (name: string) => void;
  accept?: string;
  placeholder?: string;
  'aria-label'?: string;
  /** localStorage key for the starred models. */
  favKey?: string;
  /** Short tags per model shown on its row (OpenRouter: free, tools, images). */
  tags?: Record<string, string[]>;
  /** Shown before Record (the chat's context ring). */
  extra?: ReactNode;
  /** A group heading for a model instead of its maker's (NVIDIA's hosted models listed together). */
  groupOf?: (m: string) => string | undefined;
}

/** Who made a model, for its group and its models.dev logo. OpenRouter and NVIDIA ids name it before the slash. No logo: models.dev has none. */
const MAKERS: Record<string, [logo: string | undefined, name: string]> = {
  anthropic: ['anthropic', 'Anthropic'],
  openai: ['openai', 'OpenAI'],
  google: ['google', 'Google'],
  nvidia: ['nvidia', 'NVIDIA'],
  deepseek: ['deepseek', 'DeepSeek'],
  'deepseek-ai': ['deepseek', 'DeepSeek'],
  'meta-llama': ['llama', 'Meta'],
  meta: ['llama', 'Meta'],
  qwen: ['alibaba', 'Qwen'],
  mistralai: ['mistral', 'Mistral'],
  'nv-mistralai': ['mistral', 'Mistral'],
  moonshotai: ['moonshotai', 'Moonshot'],
  minimax: ['minimax', 'MiniMax'],
  minimaxai: ['minimax', 'MiniMax'],
  'stepfun-ai': ['stepfun', 'StepFun'],
  ai21labs: ['ai21', 'AI21'],
  databricks: ['databricks', 'Databricks'],
  poolside: ['poolside', 'Poolside'],
  'x-ai': ['xai', 'xAI'],
  'z-ai': ['zai', 'Z.ai'],
  ibm: [undefined, 'IBM'],
};
const GUESS: [RegExp, string][] = [
  [/claude|haiku|sonnet|opus/i, 'anthropic'],
  [/gpt|codex|^o\d/i, 'openai'],
  [/gemini|gemma/i, 'google'],
  [/llama/i, 'meta-llama'],
  [/qwen/i, 'qwen'],
  [/deepseek/i, 'deepseek'],
  [/mistral|codestral/i, 'mistralai'],
  [/kimi|moonshot/i, 'moonshotai'],
];
export function makerOf(m: string): { logo?: string; name: string } {
  const key = m.includes('/') ? m.split('/')[0]!.toLowerCase() : GUESS.find(([re]) => re.test(m))?.[1];
  if (!key) return { name: 'Other' };
  // a maker not listed: its slug, capitalised, and no logo (models.dev answers a generic one)
  const [logo, name] = MAKERS[key] ?? [undefined, key.charAt(0).toUpperCase() + key.slice(1)];
  return logo ? { logo, name } : { name };
}

const MakerLogo = ({ model }: { model: string }) => {
  const { logo } = makerOf(model);
  // a maker models.dev has no logo for hides instead of showing broken alt text
  return logo ? <ModelSelectorLogo provider={logo} className="size-3.5" onError={(e) => (e.currentTarget.style.display = 'none')} /> : null;
};

const Chevron = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="flex-shrink-0" style={{ color: 'var(--text-secondary)' }} aria-hidden="true">
    <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const STAR = 'M8 1.6L9.95 5.55L14.3 6.18L11.15 9.25L11.89 13.58L8 11.53L4.11 13.58L4.85 9.25L1.7 6.18L6.05 5.55L8 1.6Z';

interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;
const speech = (): RecognitionCtor | undefined => {
  const w = globalThis as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const readFavs = (key: string): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export function AIComposer(p: AIComposerProps) {
  const favKey = p.favKey ?? 'tether.composer.favModels';
  const [menuOpen, setMenuOpen] = useState(false);
  const [favs, setFavs] = useState<string[]>(() => readFavs(favKey));
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const rec = useRef<Recognition | null>(null);
  const Speech = useMemo(speech, []);

  const auto = p.model === undefined;
  const shown = p.model ?? p.autoModel;
  const favModels = p.models.filter((m) => favs.includes(m));
  // Starred first, then one group per maker in the order the models come
  const groups: [string, string[]][] = favModels.length ? [['Starred', favModels]] : [];
  for (const m of p.models) {
    const name = p.groupOf?.(m) ?? makerOf(m).name;
    const g = groups.find(([h]) => h === name);
    if (g) g[1].push(m);
    else groups.push([name, [m]]);
  }
  const ready = p.value.trim().length > 0 && !p.loading;

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [recording]);
  useEffect(() => () => rec.current?.stop(), []);

  const pick = (m: string | undefined) => {
    p.onModelChange(m);
    setMenuOpen(false);
  };
  const toggleFav = (e: MouseEvent, m: string) => {
    e.stopPropagation();
    const next = favs.includes(m) ? favs.filter((x) => x !== m) : [...favs, m];
    setFavs(next);
    try {
      localStorage.setItem(favKey, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };

  const submit = () => {
    if (!ready) return;
    rec.current?.stop();
    p.onSubmit(p.value.trim(), p.model);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const toggleRecord = () => {
    if (rec.current) return rec.current.stop();
    if (!Speech) return;
    const r = new Speech();
    const base = p.value.trimEnd();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language;
    r.onresult = (e) => {
      const said = Array.from(e.results, (res) => res[0]?.transcript ?? '').join('').trim();
      p.onValueChange(base && said ? `${base} ${said}` : base || said);
    };
    r.onend = () => {
      rec.current = null;
      setRecording(false);
    };
    rec.current = r;
    setSeconds(0);
    setRecording(true);
    r.start();
  };

  return (
    <div className="aic-root">
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept={p.accept}
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          if (list.length) p.onFiles(list);
          e.target.value = '';
        }}
      />

      {p.files.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {p.files.map((name) => (
            <span key={name} className="aic-chip">
              <span className="max-w-[160px] truncate">{name}</span>
              <button type="button" aria-label={`Remove ${name}`} onClick={() => p.onRemoveFile(name)}>
                <svg width="10" height="10" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <section className="aic-card">
        <textarea
          rows={1}
          value={p.value}
          onChange={(e) => p.onValueChange(e.target.value)}
          onKeyDown={onKey}
          className="aic-prompt-input"
          placeholder={p.placeholder}
          aria-label={p['aria-label']}
        />

        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={() => fileInput.current?.click()} className="aic-pill aic-grow aic-add" aria-label="Add files">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0" style={{ color: 'var(--icon-primary)' }} aria-hidden="true">
                <path d="M8 2.5V13.5M2.5 8H13.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span className="aic-grow-label">Add files</span>
            </button>

            {p.models.length > 1 ? (
              <ModelSelector open={menuOpen} onOpenChange={setMenuOpen}>
                <ModelSelectorTrigger asChild>
                  <button type="button" className="aic-model-trigger" aria-label={`Model: ${auto ? 'Auto' : shown}`}>
                    {auto ? null : <MakerLogo model={shown ?? ''} />}
                    <span className={`truncate ${auto ? 'pl-1.5' : ''}`}>{auto ? 'Auto' : shown}</span>
                    {auto && p.autoModel ? <span className="truncate font-normal" style={{ color: 'var(--text-secondary)' }}>{p.autoModel}</span> : null}
                    <Chevron />
                  </button>
                </ModelSelectorTrigger>
                <ModelSelectorContent title="Choose a model" className="sm:max-w-md">
                  <ModelSelectorInput placeholder="Search models..." />
                  <ModelSelectorList className="max-h-[min(60vh,520px)]">
                    <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                    <ModelSelectorGroup>
                      <ModelSelectorItem value="auto" keywords={['auto', p.autoModel ?? '']} onSelect={() => pick(undefined)}>
                        <ModelSelectorName>
                          Auto{p.autoModel ? <span className="ml-1.5" style={{ color: 'var(--text-secondary)' }}>{p.autoModel}</span> : null}
                        </ModelSelectorName>
                        {auto ? <CheckIcon className="ml-auto size-4" /> : <div className="ml-auto size-4" />}
                      </ModelSelectorItem>
                    </ModelSelectorGroup>
                    {groups.map(([heading, list]) => (
                      <ModelSelectorGroup heading={heading} key={heading}>
                        {list.map((m) => {
                          const fav = favs.includes(m);
                          return (
                            <ModelSelectorItem key={m} value={`${heading}:${m}`} keywords={[m]} onSelect={() => pick(m)}>
                              <MakerLogo model={m} />
                              <ModelSelectorName>{m}</ModelSelectorName>
                              {p.tags?.[m]?.map((t) => (
                                <span key={t} className={`aic-tag${t === 'free' ? ' free' : ''}`}>
                                  {t}
                                </span>
                              ))}
                              <button type="button" onClick={(e) => toggleFav(e, m)} className={`aic-star ${fav ? 'starred' : ''}`} aria-label={fav ? `Unstar ${m}` : `Star ${m}`} aria-pressed={fav}>
                                <svg width="13.5" height="13.5" viewBox="0 0 16 16" fill={fav ? '#FACC15' : 'none'} stroke={fav ? '#FACC15' : 'currentColor'} strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
                                  <path d={STAR} />
                                </svg>
                              </button>
                              {!auto && m === p.model ? <CheckIcon className="size-4" /> : <div className="size-4" />}
                            </ModelSelectorItem>
                          );
                        })}
                      </ModelSelectorGroup>
                    ))}
                  </ModelSelectorList>
                </ModelSelectorContent>
              </ModelSelector>
            ) : null}
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            {p.extra}
            {Speech ? (
              <button type="button" onClick={toggleRecord} className={`aic-pill aic-grow aic-record ${recording ? 'recording' : ''}`} aria-label={recording ? 'Stop dictation' : 'Dictate'} aria-pressed={recording}>
                <span className="flex flex-shrink-0 items-center justify-center" style={{ color: recording ? undefined : 'var(--icon-primary)' }}>
                  {recording ? (
                    <span className="aic-recording-dot" />
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect x="5.5" y="1.8" width="5" height="7.6" rx="2.5" stroke="currentColor" strokeWidth="1.45" />
                      <path d="M3.2 7.2C3.2 9.85 5.35 12 8 12C10.65 12 12.8 9.85 12.8 7.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
                      <path d="M8 12V14.2M5.8 14.2H10.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
                    </svg>
                  )}
                </span>
                <span className="aic-grow-label">{recording ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Record'}</span>
              </button>
            ) : null}

            {p.loading ? (
              <button type="button" onClick={p.onStop} disabled={!p.onStop} className="aic-submit ready" aria-label="Stop generating">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button type="button" onClick={submit} disabled={!ready} className={`aic-submit ${ready ? 'ready' : ''}`} aria-label="Send prompt">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 12.8V3.2M8 3.2L3.8 7.4M8 3.2L12.2 7.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
