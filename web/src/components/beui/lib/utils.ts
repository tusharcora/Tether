/**
 * From beui.dev (github.com/starc007/ui-components) `lib/utils.ts`. MIT License, Copyright (c) 2026 Saurabh Chauhan; the
 * full notice is in ../LICENSE. Unchanged apart from this header and the quote style.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
