import { AudioLines, FileText, ImageIcon, Video, type LucideIcon } from "lucide-react";

import { modalityMeta, type Modality } from "@/lib/modality";
import { cn } from "@/lib/utils";

const ICONS: Record<Modality, LucideIcon> = {
  speech: AudioLines,
  video_visual: Video,
  image: ImageIcon,
  document: FileText,
};

export interface ModalityBadgeProps {
  modality: string;
  /** `full` shows the label, `compact` shows the short code, `dot` is icon-only. */
  variant?: "full" | "compact" | "dot";
  className?: string;
}

/**
 * The modality encoding, rendered. Colour comes from `lib/modality.ts` — the
 * same source the WebGL graph reads — so a teal node and a teal badge always
 * mean speech.
 */
export function ModalityBadge({ modality, variant = "compact", className }: ModalityBadgeProps) {
  const meta = modalityMeta(modality);
  const Icon = (ICONS as Record<string, LucideIcon | undefined>)[modality];

  if (variant === "dot") {
    return (
      <span
        className={cn("inline-flex size-5 items-center justify-center rounded-sm border", meta.border, meta.bg, className)}
        title={meta.label}
      >
        {Icon ? <Icon className={cn("size-3", meta.text)} aria-hidden /> : null}
        <span className="sr-only">{meta.label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-sm border px-1.5 font-mono text-ui-2xs uppercase tracking-[0.06em]",
        meta.border,
        meta.bg,
        meta.text,
        className,
      )}
      title={meta.label}
    >
      {Icon ? <Icon className="size-3" aria-hidden /> : null}
      {variant === "full" ? meta.label : meta.short}
    </span>
  );
}

/** Legend row used by the graph and coverage panels. */
export function ModalityDot({ modality, className }: { modality: string; className?: string }) {
  const meta = modalityMeta(modality);
  return <span aria-hidden className={cn("inline-block size-2 rounded-full", meta.dot, className)} />;
}
