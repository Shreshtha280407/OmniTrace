"use client";

import { AlertCircle, Bug, Loader2, Paperclip, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { CommandInput, type CommandInputHandle } from "@/components/ui/CommandInput";
import { ModalityBadge } from "@/components/ui/ModalityBadge";
import { formatBytes } from "@/lib/format";
import { MODALITIES, MODALITY_META } from "@/lib/modality";
import { cn } from "@/lib/utils";

import { ACCEPT_ATTRIBUTE, useWorkspace, type PendingUpload } from "./WorkspaceProvider";

/**
 * The question composer.
 *
 * Modality filters map to `required_modalities` on POST /query; the debug
 * toggle maps to `debug_trace`. Both are wired straight through — nothing here
 * is decorative.
 */
export function Composer() {
  const { submitQuery, cancelQuery, isQuerying, uploads, addFiles } = useWorkspace();

  const [question, setQuestion] = useState("");
  const [required, setRequired] = useState<string[]>([]);
  const [debugTrace, setDebugTrace] = useState(false);
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<CommandInputHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  // `/` focuses the composer from anywhere that is not already a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    if (!question.trim() || isQuerying) return;
    void submitQuery({ question, requiredModalities: required, debugTrace });
    setQuestion("");
  };

  return (
    <div
      // Drag counting: dragenter/leave fire for every child, so a naive
      // boolean flickers the drop state as the cursor crosses the textarea.
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
      className="relative"
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-signal-500/60 bg-ink-900/85">
          <p className="text-ui-sm font-medium text-signal-300">Drop to ingest as a source</p>
        </div>
      )}

      <CommandInput
        ref={inputRef}
        value={question}
        onChange={setQuestion}
        onSubmit={submit}
        onStop={cancelQuery}
        busy={isQuerying}
        aria-label="Question for this collection"
        placeholder="Ask a question about this collection…"
        attachments={uploads.length > 0 ? <UploadList /> : undefined}
        toolbar={
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              size="xs"
              variant="ghost"
              onClick={() => fileRef.current?.click()}
              aria-label="Add a source file (video, audio, image or document)"
            >
              <Paperclip />
              Add source
            </Button>

            <span className="mx-0.5 h-4 w-px bg-ink-600" aria-hidden />

            <fieldset className="flex items-center gap-1">
              <legend className="sr-only">Require these modalities in the answer</legend>
              {MODALITIES.map((modality) => {
                const on = required.includes(modality);
                return (
                  <button
                    key={modality}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    onClick={() =>
                      setRequired((current) =>
                        current.includes(modality)
                          ? current.filter((m) => m !== modality)
                          : [...current, modality],
                      )
                    }
                    title={`Require ${MODALITY_META[modality].label} evidence`}
                    className={cn(
                      "inline-flex h-[22px] items-center gap-1 rounded-sm border px-1.5 font-mono text-ui-2xs uppercase tracking-[0.06em] transition-colors",
                      on
                        ? cn(MODALITY_META[modality].border, MODALITY_META[modality].bg, MODALITY_META[modality].text)
                        : "border-ink-600 text-ink-400 hover:border-ink-500 hover:text-ink-200",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn("size-1.5 rounded-full", on ? MODALITY_META[modality].dot : "bg-ink-500")}
                    />
                    {MODALITY_META[modality].short}
                  </button>
                );
              })}
            </fieldset>

            <span className="mx-0.5 h-4 w-px bg-ink-600" aria-hidden />

            <button
              type="button"
              role="switch"
              aria-checked={debugTrace}
              onClick={() => setDebugTrace((v) => !v)}
              title="Return the retrieval trace with the response"
              className={cn(
                "inline-flex h-[22px] items-center gap-1.5 rounded-sm border px-1.5 text-ui-2xs transition-colors",
                debugTrace
                  ? "border-uv-500/40 bg-uv-800/40 text-uv-300"
                  : "border-ink-600 text-ink-400 hover:border-ink-500 hover:text-ink-200",
              )}
            >
              <Bug className="size-3" aria-hidden />
              Debug trace
            </button>
          </>
        }
      />

      <p className="mt-2 px-1 text-ui-2xs text-ink-500">
        <kbd className="rounded-xs border border-ink-600 bg-ink-800 px-1 font-mono text-[10px]">Enter</kbd> to run ·{" "}
        <kbd className="rounded-xs border border-ink-600 bg-ink-800 px-1 font-mono text-[10px]">Shift</kbd>+
        <kbd className="rounded-xs border border-ink-600 bg-ink-800 px-1 font-mono text-[10px]">Enter</kbd> for a new
        line · <kbd className="rounded-xs border border-ink-600 bg-ink-800 px-1 font-mono text-[10px]">/</kbd> to focus
      </p>
    </div>
  );
}

function UploadList() {
  const { uploads, removeUpload, retryUpload } = useWorkspace();
  return (
    <ul className="space-y-1.5">
      {uploads.map((upload) => (
        <UploadRow key={upload.id} upload={upload} onRemove={() => removeUpload(upload.id)} onRetry={() => retryUpload(upload.id)} />
      ))}
    </ul>
  );
}

function UploadRow({
  upload,
  onRemove,
  onRetry,
}: {
  upload: PendingUpload;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const fraction = upload.progress?.fraction ?? null;
  const failed = upload.status === "failed";

  return (
    <li
      className={cn(
        "rounded-md border px-2.5 py-2",
        failed ? "border-fault-500/35 bg-fault-900/30" : "border-ink-600 bg-ink-850/70",
      )}
    >
      <div className="flex items-center gap-2">
        {upload.status === "uploading" || upload.status === "processing" ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-signal-400" aria-hidden />
        ) : failed ? (
          <AlertCircle className="size-3.5 shrink-0 text-fault-400" aria-hidden />
        ) : (
          <ModalityBadge modality={mediaToModality(upload.file.name)} variant="dot" />
        )}

        <span className="min-w-0 flex-1 truncate text-ui-2xs text-ink-100" title={upload.file.name}>
          {upload.file.name}
        </span>

        <span className="shrink-0 font-mono text-[10px] tabular text-ink-400">
          {upload.status === "uploading" && fraction !== null
            ? `${Math.round(fraction * 100)}%`
            : upload.status === "processing"
              ? "extracting"
              : upload.status === "done"
                ? "ready"
                : formatBytes(upload.file.size)}
        </span>

        {failed && (
          <Button size="icon-sm" variant="ghost" onClick={onRetry} aria-label={`Retry uploading ${upload.file.name}`}>
            <RotateCw />
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${upload.file.name}`}>
          <X />
        </Button>
      </div>

      {upload.status === "uploading" && (
        <div
          className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-ink-700"
          role="progressbar"
          aria-valuenow={fraction !== null ? Math.round(fraction * 100) : undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Uploading ${upload.file.name}`}
        >
          {/* Indeterminate when the browser cannot report a total — an
              indeterminate bar is honest, a fake percentage is not. */}
          <div
            className={cn("h-full rounded-full bg-signal-500", fraction === null && "w-1/3 animate-pulse-soft")}
            style={fraction !== null ? { width: `${fraction * 100}%` } : undefined}
          />
        </div>
      )}

      {upload.error && <p className="mt-1.5 text-ui-2xs leading-relaxed text-fault-400">{upload.error}</p>}
    </li>
  );
}

function mediaToModality(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mov", "mkv", "webm", "avi", "m4v"].includes(ext)) return "video_visual";
  if (["mp3", "wav", "m4a", "flac", "ogg", "aac"].includes(ext)) return "speech";
  if (["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff"].includes(ext)) return "image";
  return "document";
}
