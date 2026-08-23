"use client";

import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils";

/**
 * StreamingText — reveals an answer at a readable rate.
 *
 * Two honest modes, and no third:
 *
 *  - `live`: the caller is receiving real deltas (SSE). `text` grows over
 *    time and we render exactly what has arrived. `done` is set by the caller
 *    when the stream closes.
 *  - `reveal`: the full answer is already in hand from a single JSON response.
 *    We animate it word-by-word purely as a reading aid, and we say so via
 *    `data-mode="reveal"`. This is presentation of received data, not a
 *    simulation of work in progress.
 *
 * Either way the caret disappears the moment there is nothing more to reveal,
 * and the completion callback fires only when the visible text equals the text
 * we were actually given.
 */

export interface StreamingTextProps {
  text: string;
  /** `live` when deltas are still arriving; `reveal` for a completed payload. */
  mode?: "live" | "reveal";
  /** In `live` mode, whether the upstream stream has closed. */
  done?: boolean;
  /** Words revealed per second in `reveal` mode. */
  wordsPerSecond?: number;
  onComplete?: () => void;
  className?: string;
}

export function StreamingText({
  text,
  mode = "reveal",
  done = false,
  wordsPerSecond = 34,
  onComplete,
  className,
}: StreamingTextProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [revealedWords, setRevealedWords] = useState(0);
  const completedRef = useRef(false);

  // Word boundaries are computed once per text change; we slice rather than
  // re-join so whitespace and punctuation survive exactly as the model wrote it.
  const boundaries = useWordBoundaries(text);
  const totalWords = boundaries.length;

  useEffect(() => {
    completedRef.current = false;
    setRevealedWords(0);
  }, [text]);

  useEffect(() => {
    if (mode === "live") return; // caller controls the pace
    if (reducedMotion) {
      setRevealedWords(totalWords);
      return;
    }
    if (totalWords === 0 || revealedWords >= totalWords) return;

    const interval = Math.max(12, 1000 / wordsPerSecond);
    const timer = window.setTimeout(() => {
      // Reveal in small bursts so long answers do not take a minute, while
      // short ones still read as typed.
      const burst = totalWords > 220 ? 3 : totalWords > 90 ? 2 : 1;
      setRevealedWords((n) => Math.min(totalWords, n + burst));
    }, interval);
    return () => window.clearTimeout(timer);
  }, [mode, reducedMotion, revealedWords, totalWords, wordsPerSecond]);

  const isComplete = mode === "live" ? done : revealedWords >= totalWords;

  useEffect(() => {
    if (isComplete && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
  }, [isComplete, onComplete]);

  const visible =
    mode === "live" || reducedMotion || revealedWords >= totalWords
      ? text
      : text.slice(0, boundaries[Math.max(0, revealedWords - 1)] ?? 0);

  return (
    <div
      className={cn("text-pretty text-ui-base leading-[1.7] text-ink-100", className)}
      data-mode={mode}
      data-complete={isComplete || undefined}
    >
      {/* The answer is announced once, complete, rather than re-read on every
          token — an assertive live region here would be unusable. */}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {isComplete ? text : ""}
      </span>
      <span aria-hidden={!isComplete}>{visible}</span>
      {!isComplete && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.16em] animate-caret-blink bg-signal-400 motion-reduce:animate-none"
        />
      )}
    </div>
  );
}

/** Index just past the end of each word. */
function useWordBoundaries(text: string): number[] {
  const cache = useRef<{ text: string; boundaries: number[] }>({ text: "", boundaries: [] });
  if (cache.current.text !== text) {
    const boundaries: number[] = [];
    const re = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) boundaries.push(match.index + match[0].length);
    cache.current = { text, boundaries };
  }
  return cache.current.boundaries;
}
