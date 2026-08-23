/**
 * Modality is a fixed four-way encoding produced by the backend
 * (`omnitrace/models.py` EvidenceItem.modality). Colour, label and icon are
 * defined here once so the graph canvas, the badges and the coverage panel
 * can never disagree about what blue means.
 */

export const MODALITIES = ["speech", "video_visual", "image", "document"] as const;
export type Modality = (typeof MODALITIES)[number];

export function isModality(value: string): value is Modality {
  return (MODALITIES as readonly string[]).includes(value);
}

interface ModalityMeta {
  label: string;
  /** Short form for dense contexts — chips, legends, axis labels. */
  short: string;
  /** Hex, for WebGL and canvas. Tailwind classes below for DOM. */
  hex: string;
  /** Tailwind text/border/background triplet. */
  text: string;
  border: string;
  bg: string;
  dot: string;
  /** True when evidence of this modality carries a real timeline position.
   *  The timeline scrubber uses this to avoid inventing timestamps for
   *  documents and images (§06 Location rules). */
  timeBearing: boolean;
}

export const MODALITY_META: Record<Modality, ModalityMeta> = {
  speech: {
    label: "Speech",
    short: "SPCH",
    hex: "#19D6C4",
    text: "text-modality-speech",
    border: "border-modality-speech/35",
    bg: "bg-modality-speech/10",
    dot: "bg-modality-speech",
    timeBearing: true,
  },
  video_visual: {
    label: "Video visual",
    short: "VID",
    hex: "#4C9BE8",
    text: "text-modality-visual",
    border: "border-modality-visual/35",
    bg: "bg-modality-visual/10",
    dot: "bg-modality-visual",
    timeBearing: true,
  },
  image: {
    label: "Image",
    short: "IMG",
    hex: "#9488DD",
    text: "text-modality-image",
    border: "border-modality-image/35",
    bg: "bg-modality-image/10",
    dot: "bg-modality-image",
    timeBearing: false,
  },
  document: {
    label: "Document",
    short: "DOC",
    hex: "#D98E6A",
    text: "text-modality-document",
    border: "border-modality-document/35",
    bg: "bg-modality-document/10",
    dot: "bg-modality-document",
    timeBearing: false,
  },
};

const UNKNOWN_MODALITY: ModalityMeta = {
  label: "Unknown",
  short: "—",
  hex: "#5A6577",
  text: "text-ink-300",
  border: "border-ink-500/40",
  bg: "bg-ink-500/10",
  dot: "bg-ink-400",
  timeBearing: false,
};

export function modalityMeta(modality: string | null | undefined): ModalityMeta {
  if (modality && isModality(modality)) return MODALITY_META[modality];
  return UNKNOWN_MODALITY;
}

/** Media types are the *source* taxonomy (video/audio/image/document); they
 *  are not the same axis as evidence modality and must not be conflated. */
export const MEDIA_TYPES = ["video", "audio", "image", "document"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const MEDIA_TYPE_LABEL: Record<string, string> = {
  video: "Video",
  audio: "Audio",
  image: "Image",
  document: "Document",
};

/**
 * Evidence types the pipeline emits, mapped to readable names. Unknown values
 * pass through rather than being coerced into a known bucket.
 */
const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  utterance: "Utterance",
  ocr_region: "OCR region",
  visual_state: "Visual state",
  document_block: "Document block",
  table: "Table",
  diagram_fact: "Diagram fact",
  scanned_page: "Scanned page",
  semantic_segment: "Semantic segment",
};

export function evidenceTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return EVIDENCE_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

/** Relationship types from `link/`. Direction and meaning are shown as-is;
 *  we never soften a typed edge into a generic "related to". */
export const RELATIONSHIP_TYPES = [
  "SAME_EVENT",
  "EXPLAINS",
  "MENTIONS",
  "SHOWS",
  "VISUALLY_MATCHES",
  "TEMPORALLY_ALIGNS",
  "TEMPORALLY_OVERLAPS",
  "PART_OF_EVENT",
  "SUPERSEDES",
] as const;

export function relationshipLabel(type: string): string {
  return type
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Edge hue: confirmed edges take the teal signal, tentative take ultraviolet
 *  at reduced weight. This is the only place the two signal colours are
 *  assigned meaning for relationships. */
export function relationshipColor(status: string): string {
  return status === "confirmed" ? "#19D6C4" : "#7A6DC9";
}
