/**
 * From bencho.dev "Upload dropzone" (Upload.tsx / Upload.css). MIT License, Copyright (c) 2026 Lorenzo Cabra; the full
 * notice is in ./LICENSE. Adapted for Tether: the demo's fake tiles are gone and the box takes real files (native drop and a
 * file input); it keeps bencho's behaviour: a plain filled box that inhales (grows with a bounce, the arrow lifts) while a
 * file is carried over it, a shake with red "Too big" text for a file over the limit, a check once accepted. Studio tokens
 * through Tailwind classes; motion honours prefers-reduced-motion.
 */
import { Check, Upload } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useId, useRef, useState } from 'react';
import { cn } from '../beui/lib/utils';

const mb = (n: number) => `${+(n / 1e6).toFixed(1)} MB`;

export interface UploadDropzoneProps {
  /** Called with the files that passed. */
  onFiles: (files: File[]) => void;
  /** Per file. */
  maxBytes: number;
  maxFiles?: number;
  accept?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function UploadDropzone({ onFiles, maxBytes, maxFiles = 5, accept, label = 'Drop files here or click to choose', disabled, className }: UploadDropzoneProps) {
  const reduce = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const hint = useId();
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [taken, setTaken] = useState<string>();
  const [shake, setShake] = useState(0);

  const take = (list: FileList | File[] | null) => {
    const all = [...(list ?? [])];
    if (!all.length) return;
    const big = all.find((f) => f.size > maxBytes);
    if (big) {
      setProblem(`Too big: ${big.name} is ${mb(big.size)} (up to ${mb(maxBytes)})`);
      setTaken(undefined);
      setShake((n) => n + 1);
      return;
    }
    const files = all.slice(0, maxFiles);
    setProblem(all.length > maxFiles ? `Only the first ${maxFiles} files were taken` : undefined);
    setTaken(files.length === 1 ? files[0]!.name : `${files.length} files`);
    onFiles(files);
  };

  return (
    <motion.div
      key={shake}
      animate={reduce ? undefined : over ? { scale: 1.03 } : shake ? { x: [0, -6, 6, -4, 4, 0] } : { scale: 1 }}
      transition={over ? { type: 'spring', stiffness: 420, damping: 16 } : { duration: 0.28 }}
      className={cn('relative', className)}
    >
      <button
        type="button"
        disabled={disabled}
        aria-describedby={hint}
        onClick={() => input.current?.click()}
        onDragEnter={(e) => (e.preventDefault(), !disabled && setOver(true))}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) take(e.dataTransfer.files);
        }}
        className={cn('flex w-full flex-col items-center gap-1.5 rounded-xl border-0 bg-muted px-4 py-5 text-sm text-foreground transition-colors duration-150', over && 'bg-secondary', disabled ? 'opacity-50' : 'cursor-pointer')}
      >
        <span className={cn('transition-transform duration-150', over && '-translate-y-1')}>{taken && !problem ? <Check size={18} className="text-success" aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}</span>
        <span>{taken && !problem ? `Added ${taken}` : label}</span>
        <span id={hint} className={cn('text-xs', problem ? 'text-danger' : 'text-muted-foreground')} role={problem ? 'alert' : undefined}>
          {problem ?? `Up to ${mb(maxBytes)} each`}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple={maxFiles > 1}
        accept={accept}
        hidden
        data-testid="dropzone-input"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
    </motion.div>
  );
}
