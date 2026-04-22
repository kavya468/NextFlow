"use client";

import { trpc } from "@/lib/trpc/client";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs";

interface CostEstimateTooltipProps {
  nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
}

export function CostEstimateTooltip({ nodes }: CostEstimateTooltipProps) {
  const nodesForEstimate = nodes.map((n) => ({
    id: n.id,
    type: n.type || "unknown",
    data: (n.data as Record<string, unknown>) ?? {},
  }));

  const { data } = trpc.credits.estimateNodes.useQuery(
    { nodes: nodesForEstimate },
    { staleTime: 10_000, enabled: nodes.length > 0 }
  );

  if (!data || data.total === 0) return null;

  return (
    <span className="text-[var(--text-muted)] text-[10px] font-mono tabular-nums">
      ~{data.total.toLocaleString("en-US")} cr
    </span>
  );
}
