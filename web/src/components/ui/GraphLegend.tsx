"use client";

import { MODALITIES, MODALITY_META, relationshipLabel } from "@/lib/modality";
import { cn } from "@/lib/utils";

/**
 * GraphLegend — decodes the graph's visual language.
 *
 * Only encodings actually present in the loaded graph are listed. A legend
 * that advertises six relationship types when the data contains two is
 * misinformation dressed as thoroughness.
 */

export interface GraphLegendProps {
  /** Modalities present in the current graph. */
  modalities: string[];
  /** Relationship types present, with their counts. */
  relationshipTypes: { type: string; count: number; confirmed: number }[];
  /** Signals the linker actually reported on these edges. */
  signals?: string[];
  className?: string;
  compact?: boolean;
}

export function GraphLegend({ modalities, relationshipTypes, signals, className, compact }: GraphLegendProps) {
  const present = MODALITIES.filter((m) => modalities.includes(m));

  return (
    <div className={cn("space-y-3.5 text-ui-2xs", className)}>
      {present.length > 0 && (
        <LegendGroup title="Node colour · modality">
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {present.map((m) => (
              <span key={m} className="inline-flex items-center gap-1.5 text-ink-200">
                <span aria-hidden className="size-2 rounded-full" style={{ background: MODALITY_META[m].hex }} />
                {MODALITY_META[m].label}
              </span>
            ))}
          </div>
        </LegendGroup>
      )}

      <LegendGroup title="Node size · relevance">
        <div className="flex items-center gap-2 text-ink-300">
          <span aria-hidden className="size-1.5 rounded-full bg-ink-300" />
          <span aria-hidden className="size-2.5 rounded-full bg-ink-200" />
          <span aria-hidden className="size-3.5 rounded-full bg-ink-100" />
          <span className="ml-1">low → high bundle score</span>
        </div>
      </LegendGroup>

      <LegendGroup title="Node shape · kind">
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-ink-200">
          <ShapeKey shape="circle" label="Atomic observation" />
          <ShapeKey shape="ring" label="Semantic segment" />
          <ShapeKey shape="diamond" label="Semantic event" />
          <ShapeKey shape="square" label="Source" />
        </div>
      </LegendGroup>

      {relationshipTypes.length > 0 && (
        <LegendGroup title="Edges · relationship">
          <ul className="space-y-1">
            {relationshipTypes.map(({ type, count, confirmed }) => (
              <li key={type} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn("h-px w-5 shrink-0", confirmed > 0 ? "bg-signal-500" : "bg-uv-500")}
                  style={confirmed === 0 ? { backgroundImage: "repeating-linear-gradient(90deg,#7A6DC9 0 3px,transparent 3px 6px)", background: "none" } : undefined}
                />
                <span className="flex-1 truncate text-ink-200" title={type}>
                  {relationshipLabel(type)}
                </span>
                <span className="font-mono tabular text-ink-400">
                  {confirmed}
                  <span className="text-ink-500">/{count}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-ink-500">confirmed / total · solid teal is confirmed, dashed violet is tentative</p>
        </LegendGroup>
      )}

      {signals && signals.length > 0 && (
        <LegendGroup title="Link signals reported">
          <div className="flex flex-wrap gap-1.5">
            {signals.map((s) => (
              <span key={s} className="rounded-sm border border-ink-600 bg-ink-750 px-1.5 py-px font-mono text-ink-300">
                {s}
              </span>
            ))}
          </div>
        </LegendGroup>
      )}

      {!compact && (
        <LegendGroup title="Halo">
          <p className="text-ink-300">
            A halo marks the selected node and any node matched directly by the query. Expanded neighbours are not
            haloed.
          </p>
        </LegendGroup>
      )}
    </div>
  );
}

function LegendGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="eyebrow mb-1.5">{title}</h4>
      {children}
    </div>
  );
}

function ShapeKey({ shape, label }: { shape: "circle" | "ring" | "diamond" | "square"; label: string }) {
  const base = "size-2.5 shrink-0 border border-ink-200";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn(
          base,
          shape === "circle" && "rounded-full bg-ink-200",
          shape === "ring" && "rounded-full bg-transparent",
          shape === "diamond" && "rotate-45 bg-ink-200",
          shape === "square" && "rounded-[1px] bg-transparent",
        )}
      />
      {label}
    </span>
  );
}
