"use client";

import { CloudOff, FileQuestion, PlugZap, ServerCrash, ShieldAlert, TimerOff } from "lucide-react";

import { ApiError } from "@/lib/api";

import { EmptyState } from "./EmptyState";

/**
 * Renders an ApiError honestly: what failed, why, and whether retrying is
 * worth the user's time. A non-retryable failure does not get a Retry button,
 * because offering one implies the next attempt might differ.
 */

const PRESENTATION = {
  network: { icon: PlugZap, title: "Cannot reach the OmniTrace API", tone: "fault" as const },
  timeout: { icon: TimerOff, title: "The backend did not respond in time", tone: "fault" as const },
  not_found: { icon: FileQuestion, title: "Not found", tone: "caution" as const },
  unavailable: { icon: CloudOff, title: "Not available on this backend", tone: "caution" as const },
  validation: { icon: ShieldAlert, title: "The backend rejected this request", tone: "caution" as const },
  server: { icon: ServerCrash, title: "The backend failed", tone: "fault" as const },
  contract: { icon: ShieldAlert, title: "Unexpected response shape", tone: "fault" as const },
};

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  title?: string;
  className?: string;
  compact?: boolean;
}

export function ErrorState({ error, onRetry, retrying, title, className, compact }: ErrorStateProps) {
  if (error instanceof ApiError) {
    const preset = PRESENTATION[error.kind];
    return (
      <EmptyState
        className={className}
        compact={compact}
        icon={preset.icon}
        tone={preset.tone}
        title={title ?? preset.title}
        description={error.userMessage}
        detail={error.status ? `${error.status} · ${error.message}` : error.message}
        action={onRetry && error.retryable ? { label: "Retry", onClick: onRetry, loading: retrying } : undefined}
      />
    );
  }

  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return (
    <EmptyState
      className={className}
      compact={compact}
      icon={ServerCrash}
      tone="fault"
      title={title ?? "Something went wrong"}
      description={message}
      action={onRetry ? { label: "Retry", onClick: onRetry, loading: retrying } : undefined}
    />
  );
}
