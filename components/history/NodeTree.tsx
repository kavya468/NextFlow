"use client";

import { NodeRow } from "./NodeRow";

type NodeRun = {
  id: string;
  nodeId: string;
  nodeType: string;
  status: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown> | string;
  error?: string | null;
  durationMs?: number | null;
  creditsUsed?: number;
  providerUsed?: string | null;
};

interface NodeTreeProps {
  nodeRuns: NodeRun[];
  isStale: boolean;
}

export function NodeTree({ nodeRuns, isStale }: NodeTreeProps) {
  if (!nodeRuns || nodeRuns.length === 0) return null;

  return (
    <div className="ml-4 border-l border-[var(--history-tree-line)] pl-4 space-y-0.5 mt-2 mb-1">
      {nodeRuns.map((nr, idx) => (
        <NodeRow
          key={nr.id}
          nodeRun={nr}
          isLast={idx === nodeRuns.length - 1}
          isStale={isStale}
        />
      ))}
    </div>
  );
}
