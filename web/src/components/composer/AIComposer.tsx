/**
 * From the "AI prompt composer with model selector" snippet the project owner supplied. Adapted for Tether: the models,
 * the draft, attachments and streaming come from the caller (the snippet had six made-up models and a demo toast); Auto
 * means "no override", so the server answers with the bound agent's model; Record dictates with the browser's speech
 * recognition (hidden where there is none) instead of inserting a canned prompt. Left out because the assistant has no
 * field for them: the Plan / Ask / Build modes, effort levels and the @ context menu; and the demo-only parts: the Pro
 * banner and modal, the video tour and the theme switcher (the palette follows Tether's data-theme).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
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
}

type Provider = 'kimi' | 'openai' | 'spark';
const providerOf = (m: string): Provider => (/kimi|moonshot/i.test(m) ? 'kimi' : /gpt|codex|^o\d/i.test(m) ? 'openai' : 'spark');

function ProviderIcon({ model }: { model: string }) {
  const p = providerOf(model);
  if (p === 'kimi')
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4.2 3.2V12.8M4.2 8.2L10.4 3.2M6.8 6.2L11.2 12.8" stroke="#F4F4F6" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12.2" cy="4.2" r="1.15" fill="#F4F4F6" />
      </svg>
    );
  if (p === 'openai')
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M21.2 10.1c.2-1.5-.2-3.1-1.2-4.3-1.3-1.6-3.4-2.3-5.4-1.8-.9-1.1-2.3-1.8-3.8-1.8-2.1 0-3.9 1.3-4.6 3.2-1.5.3-2.8 1.2-3.6 2.5-1 1.8-.9 4 .2 5.7-.2 1.5.2 3.1 1.2 4.3 1.3 1.6 3.4 2.3 5.4 1.8.9 1.1 2.3 1.8 3.8 1.8 2.1 0 3.9-1.3 4.6-3.2 1.5-.3 2.8-1.2 3.6-2.5 1.1-1.8 1-4-.2-5.7z"
          stroke="#F4F4F6"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="2.7" stroke="#F4F4F6" strokeWidth="1.5" />
      </svg>
    );
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <g stroke="#E87B58" strokeWidth="1.35" strokeLinecap="round">
        <line x1="9" y1="2.2" x2="9" y2="15.8" />
        <line x1="2.2" y1="9" x2="15.8" y2="9" />
        <line x1="4.1" y1="4.1" x2="13.9" y2="13.9" />
        <line x1="13.9" y1="4.1" x2="4.1" y2="13.9" />
        <line x1="6.4" y1="2.7" x2="11.6" y2="15.3" />
        <line x1="2.7" y1="6.4" x2="15.3" y2="11.6" />
      </g>
      <circle cx="9" cy="9" r="1.4" fill="#18181c" />
    </svg>
  );
}

const Check = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="flex-shrink-0" aria-hidden="true">
    <path d="M3.2 8.5L6.5 11.8L13 4.5" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
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
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'fav' | 'all'>('fav');
  const [favs, setFavs] = useState<string[]>(() => readFavs(favKey));
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const rec = useRef<Recognition | null>(null);
  const Speech = useMemo(speech, []);

  const auto = p.model === undefined;
  const shown = p.model ?? p.autoModel;
  const favModels = p.models.filter((m) => favs.includes(m));
  const visible = (tab === 'fav' ? favModels : p.models).filter((m) => m.toLowerCase().includes(query.trim().toLowerCase()));
  const ready = p.value.trim().length > 0 && !p.loading;

  // close the menu on any click outside it, or on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('click', close);
    window.addEventListener('keydown', esc);
    return () => (window.removeEventListener('click', close), window.removeEventListener('keydown', esc));
  }, [menuOpen]);

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [recording]);
  useEffect(() => () => rec.current?.stop(), []);

  const openMenu = (e: MouseEvent) => {
    e.stopPropagation();
    if (menuOpen) return setMenuOpen(false);
    setQuery('');
    setTab(favModels.length ? 'fav' : 'all');
    setMenuOpen(true);
    window.setTimeout(() => searchInput.current?.focus(), 160);
  };
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
              <div className="relative inline-flex min-w-0 items-center">
                <button type="button" onClick={openMenu} className="aic-model-trigger" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`Model: ${auto ? 'Auto' : shown}`}>
                  {auto ? null : (
                    <span className="aic-badge">
                      <ProviderIcon model={shown ?? ''} />
                    </span>
                  )}
                  <span className={`truncate ${auto ? 'pl-1.5' : ''}`}>{auto ? 'Auto' : shown}</span>
                  {auto && p.autoModel ? <span className="truncate font-normal" style={{ color: 'var(--text-secondary)' }}>{p.autoModel}</span> : null}
                  <Chevron />
                </button>

                <div onClick={(e) => e.stopPropagation()} className={`aic-popover ${menuOpen ? 'open' : ''} absolute bottom-0 left-0 z-30 w-[256px] rounded-[20px] p-2`} role="menu" aria-label="Models">
                  <div className="flex h-8 items-center gap-2 px-2.5">
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="flex-shrink-0" style={{ color: 'var(--text-secondary)' }} aria-hidden="true">
                      <circle cx="7.2" cy="7.2" r="4.8" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M10.8 10.8L13.8 13.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <input
                      ref={searchInput}
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search models"
                      aria-label="Search models"
                      autoComplete="off"
                      className="w-full border-none bg-transparent p-0 text-[14px] outline-none"
                      style={{ color: 'var(--text-primary)' }}
                    />
                  </div>

                  <div className="flex h-9 items-center justify-between px-2.5">
                    <span className="text-[14px] font-medium">
                      Auto{p.autoModel ? <span className="ml-1.5 font-normal" style={{ color: 'var(--text-secondary)' }}>{p.autoModel}</span> : null}
                    </span>
                    <button type="button" role="switch" aria-checked={auto} aria-label="Auto" onClick={() => pick(auto ? (p.autoModel ?? p.models[0]) : undefined)} className={`aic-switch ${auto ? 'on' : ''}`}>
                      <span className="aic-switch-thumb" />
                    </button>
                  </div>

                  <div role="tablist" aria-label="Filter models" className="aic-filter-bar">
                    <button type="button" role="tab" aria-selected={tab === 'fav'} onClick={() => setTab('fav')} className={`aic-filter-pill ${tab === 'fav' ? 'active' : ''}`}>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill={tab === 'fav' ? '#FACC15' : 'none'} stroke={tab === 'fav' ? '#FACC15' : 'currentColor'} strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                        <path d={STAR} />
                      </svg>
                      <span>fav</span>
                      {favModels.length ? <span className="text-[11.5px] font-normal opacity-75">{favModels.length}</span> : null}
                    </button>
                    <button type="button" role="tab" aria-selected={tab === 'all'} onClick={() => setTab('all')} className={`aic-filter-pill ${tab === 'all' ? 'active' : ''}`}>
                      <span>all</span>
                      <span className="text-[11.5px] font-normal opacity-70">{p.models.length}</span>
                    </button>
                  </div>

                  <div className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto">
                    {visible.length === 0 ? (
                      <div className="px-3 py-3 text-center text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                        {tab === 'fav' && !query.trim() ? 'No favourite models yet. Star one under all.' : 'No matching models'}
                      </div>
                    ) : (
                      visible.map((m) => {
                        const fav = favs.includes(m);
                        return (
                          <div
                            key={m}
                            role="menuitemradio"
                            aria-checked={!auto && m === p.model}
                            tabIndex={0}
                            onClick={() => pick(m)}
                            onKeyDown={(e) => {
                              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                                e.preventDefault();
                                pick(m);
                              }
                            }}
                            className="aic-model-row"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="aic-badge">
                                <ProviderIcon model={m} />
                              </span>
                              <span className="truncate text-[14px] font-medium">{m}</span>
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
                            </div>
                            {!auto && m === p.model ? <Check /> : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
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
