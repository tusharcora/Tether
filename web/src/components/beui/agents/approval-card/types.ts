/**
 * From beui.dev (github.com/starc007/ui-components) `agents/approval-card/types.ts`. MIT License, Copyright (c) 2026 Saurabh Chauhan; the
 * full notice is components/beui/LICENSE. Adapted for Tether: relative imports, Studio tokens through tw.css, lezer instead
 * of Shiki, no metallic or magnetic variants.
 */
// beui.dev/components/agents/approval-card
import type { ReactNode } from "react";

export type ApprovalCardStatus =
  | "pending"
  | "submitting"
  | "approved"
  | "rejected"
  | "changes-requested"
  | "answered";

export interface ApprovalCardOption {
  value: string;
  label: string;
  /** Plain supporting text rendered under the label. */
  description?: string;
  disabled?: boolean;
}

export interface ApprovalCardQuestion {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  options?: ApprovalCardOption[];
  multiple?: boolean;
  autoAdvance?: boolean;
  allowCustom?: boolean;
  customPlaceholder?: string;
}

export interface ApprovalCardAnswer {
  selected: string[];
  custom?: string;
}

export type ApprovalCardAnswers = Record<string, ApprovalCardAnswer>;

export interface ApprovalCardProps {
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  questions?: ApprovalCardQuestion[];
  status?: ApprovalCardStatus;
  answers?: ApprovalCardAnswers;
  defaultAnswers?: ApprovalCardAnswers;
  onAnswersChange?: (answers: ApprovalCardAnswers) => void;
  step?: number;
  defaultStep?: number;
  onStepChange?: (step: number) => void;
  onSubmit?: (answers: ApprovalCardAnswers) => void;
  onApprove?: () => void;
  onReject?: () => void;
  onRequestChanges?: () => void;
  onDismiss?: () => void;
  approveLabel?: ReactNode;
  submitLabel?: ReactNode;
  result?: ReactNode;
  className?: string;
}
