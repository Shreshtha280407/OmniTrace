"use client";

import { ArrowUpRight, Boxes, FileStack, Route } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { EvidenceDetail } from "@/components/ui/EvidenceDetail";
import { FieldRow, PanelSection } from "@/components/ui/PanelShell";
import { StatusPill } from "@/components/ui/StatusPill";
import type { EvidenceItem, Relationship } from "@/lib/api/schemas";
import { formatConfidence, formatTimecode, truncateId } from "@/lib/format";

import type { GraphData, GraphNode } from "./model";

/**
 * Node inspector for the graph.
 *
 * Evidence nodes reuse `EvidenceDetail` verbatim so the graph and the
 * workspace show the identical record. Event and source nodes are different
 * objects and get their own summaries rather than being forced into the
 * evidence shape.
 */
export function NodeInspector({
  node,
  graph,
  relationships,
  onSelect,
  onTracePath,
  onOpenEvidence,
}: {
  node: GraphNode | null;
  graph: GraphData;
  relationships: Relationship[];
  onSelect: (id: string) => void;
  onTracePath: (id: string) => void;
  onOpenEvidence: (id: string) => void;
}) {
  if (!node) {
    return (
      <EmptyState
        compact
        icon={Boxes}
        title="No node selected"
        description="Click a node to see its content, locator, confidence, provenance chain and every relationship it takes part in."
      />
    );
  }

  const evidenceById: Record<string, EvidenceItem> = {};
  graph.nodes.forEach((n) => {
    if (n.evidence) evidenceById[n.id] = n.evidence;
  });

  if (node.kind === "event") {
    return (
      <div className="divide-y divide-ink-600/50">
        <div className="px-3 py-3.5">
          <StatusPill tone="active" size="xs" className="mb-2">
            Semantic event
          </StatusPill>
          <h3 className="text-pretty text-ui-sm font-medium leading-snug text-ink-50">{node.label}</h3>
        </div>
        <PanelSection title="Event">
          <dl>
            <FieldRow label="Event ID" mono title={node.id}>
              {node.id}
            </FieldRow>
            <FieldRow label="Confidence" mono>
              {formatConfidence(node.confidence)}
            </FieldRow>
            <FieldRow label="Span" mono>
              {node.startMs !== null
                ? `${formatTimecode(node.startMs)} → ${formatTimecode(node.endMs)}`
                : "no timeline span"}
            </FieldRow>
            <FieldRow label="Members" mono>
              {graph.neighbours.get(node.id)?.size ?? 0} connected nodes
            </FieldRow>
          </dl>
          <Button size="sm" variant="secondary" className="mt-3 w-full" onClick={() => onTracePath(node.id)}>
            <Route />
            Trace path from query
          </Button>
        </PanelSection>
      </div>
    );
  }

  if (node.kind === "source") {
    const derived = graph.neighbours.get(node.id)?.size ?? 0;
    return (
      <div className="divide-y divide-ink-600/50">
        <div className="px-3 py-3.5">
          <StatusPill tone="neutral" size="xs" className="mb-2">
            Source
          </StatusPill>
          <h3 className="truncate text-ui-sm font-medium text-ink-50" title={node.label}>
            {node.label}
          </h3>
        </div>
        <PanelSection title="Source">
          <dl>
            <FieldRow label="Source ID" mono title={node.id}>
              {truncateId(node.id, 18, 6)}
            </FieldRow>
            <FieldRow label="Derived" mono>
              {derived} evidence items
            </FieldRow>
          </dl>
          <Button asChild size="sm" variant="secondary" className="mt-3 w-full">
            <Link href={`/workspace/sources/${encodeURIComponent(node.id)}`}>
              <FileStack />
              Inspect source
              <ArrowUpRight />
            </Link>
          </Button>
        </PanelSection>
      </div>
    );
  }

  if (!node.evidence) {
    return (
      <EmptyState
        compact
        title="No record for this node"
        description="This node has no stored evidence document attached."
      />
    );
  }

  return (
    <div>
      <EvidenceDetail
        evidence={node.evidence}
        relationships={relationships}
        evidenceById={evidenceById}
        onSelectEvidence={(id) => graph.nodesById.has(id) && onSelect(id)}
        onViewSource={() => onOpenEvidence(node.id)}
      />
      <div className="border-t border-ink-600/50 p-3">
        <Button size="sm" variant="secondary" className="w-full" onClick={() => onTracePath(node.id)}>
          <Route />
          Trace path to this node
        </Button>
      </div>
    </div>
  );
}
