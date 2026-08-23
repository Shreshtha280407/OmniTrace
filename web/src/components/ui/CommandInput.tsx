"use client";

import { ArrowUp, Square } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

import { Button } from "./Button";

/**
 * CommandInput — the question composer.
 *
 * Auto-growing textarea with a hard cap, Enter to submit, Shift+Enter for a
 * newline. The submit control turns into a stop control while a request is in
 * flight, because a query that runs four channels plus generation is long
 * enough that the user must be able to abandon it.
 */

export interface CommandInputHandle {
  focus: () => void;
  clear: () => void;
}

export interface CommandInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  busy?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Rendered under the textarea: source picker, modality filters, toggles. */
  toolbar?: React.ReactNode;
  /** Rendered above the textarea: attachments, upload progress. */
  attachments?: React.ReactNode;
  maxRows?: number;
  className?: string;
  "aria-label"?: string;
}

export const CommandInput = forwardRef<CommandInputHandle, CommandInputProps>(function CommandInput(
  {
    value,
    onChange,
    onSubmit,
    onStop,
    busy,
    disabled,
    placeholder = "Ask a question about this collection…",
    toolbar,
    attachments,
    maxRows = 12,
    className,
    "aria-label": ariaLabel = "Question",
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    clear: () => onChange(""),
  }));

  // Grow to fit, then scroll. Measured against the element's own line-height
  // so it stays correct if the type scale changes.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const padding = el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * maxRows) + padding}px`;
  }, [maxRows]);

  useEffect(resize, [value, resize]);

  const canSubmit = value.trim().length > 0 && !busy && !disabled;

  return (
    <div
      className={cn(
        "rounded-xl border border-ink-550 bg-ink-800/90 shadow-raised transition-colors duration-150 focus-within:border-signal-500/50 focus-within:shadow-signal-focus",
        disabled && "opacity-60",
        className,
      )}
    >
      {attachments && <div className="border-b border-ink-600/60 p-2">{attachments}</div>}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSubmit) onSubmit();
          }
        }}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-command-input
        className="block w-full resize-none bg-transparent px-3.5 py-3 text-ui-base leading-relaxed text-ink-50 placeholder:text-ink-400 focus:outline-none disabled:cursor-not-allowed"
      />

      <div className="flex items-end gap-2 px-2.5 pb-2.5 pt-0.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{toolbar}</div>
        {busy && onStop ? (
          <Button size="icon" variant="secondary" onClick={onStop} aria-label="Stop this query">
            <Square className="fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            variant="primary"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label="Run query"
            aria-keyshortcuts="Enter"
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  );
});
