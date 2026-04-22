"use client";

import { useState, useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs";
import { NodeDetailDialog } from "./NodeDetailDialog";

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

const STATUS_DOT: Record<string, { color: string; pulse?: boolean }> = {
  SUCCESS: { color: "bg-[var(--status-success)]" },
  FAILED: { color: "bg-[var(--status-error)]" },
  RUNNING: { color: "bg-[var(--status-running)]", pulse: true },
  PENDING: { color: "bg-[var(--status-pending)]", pulse: true },
};

function StatusDot({ status }: { status: string }) {
  const style = STATUS_DOT[status] ?? { color: "bg-[var(--status-unknown)]" };
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.color} ${style.pulse ? "animate-pulse" : ""}`}
    />
  );
}

interface NodeRowProps {
  nodeRun: NodeRun;
  isLast: boolean;
  isStale: boolean;
}

export function NodeRow({ nodeRun, isLast, isStale }: NodeRowProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const displayStatus = isStale && (nodeRun.status === "RUNNING" || nodeRun.status === "PENDING")
    ? "FAILED"
    : nodeRun.status;

  const isFailed = displayStatus === "FAILED";
  const config = useMemo(() => nodeRegistry.get(nodeRun.nodeType), [nodeRun.nodeType]);
  const displayName = config?.name ?? nodeRun.nodeType;

  return (
    <div className="relative">
      {/* Connector dot on the tree line */}
      <div
        className={`absolute -left-[17px] top-[14px] w-[7px] h-[7px] rounded-full border-2 ${
          isFailed ? "border-[var(--status-error-border)] bg-[var(--status-error-bg)]" : "border-[var(--history-entry-border)] bg-[var(--badge-bg)]"
        }`}
      />

      <div
        className={`group rounded-md transition-colors ${
          isFailed
            ? "bg-[var(--status-error-bg)] border border-[var(--status-error-border)]"
            : "hover:bg-[var(--hover-bg)]"
        }`}
      >
        {/* Single row: dot · name · (provider) · (credits) · duration · open icon */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsDialogOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setIsDialogOpen(true);
            }
          }}
          className="flex items-center gap-1.5 py-1.5 px-2 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--focus-ring)] rounded-md"
        >
          <StatusDot status={displayStatus} />

          <span className="text-[12px] font-medium text-[var(--text-primary)] truncate">
            {displayName}
          </span>

          {nodeRun.providerUsed && (
            <span className="text-[10px] text-[var(--history-meta-color)] bg-[var(--badge-bg)] px-1 py-px rounded shrink-0">
              {nodeRun.providerUsed}
            </span>
          )}

          {(nodeRun.creditsUsed ?? 0) > 0 && (
            <span className="text-[10px] font-mono tabular-nums text-[var(--history-meta-color)] shrink-0">
              {nodeRun.creditsUsed!.toLocaleString()} cr
            </span>
          )}

          <div className="flex-1" />

          {nodeRun.durationMs != null && (
            <span className="text-[10px] tabular-nums text-[var(--history-meta-color)] shrink-0">
              {(nodeRun.durationMs / 1000).toFixed(1)}s
            </span>
          )}

          <ExternalLink
            className="w-3 h-3 text-[var(--text-muted)] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </div>

        {/* Error display for failed nodes — keep inline for quick visibility */}
        {isFailed && nodeRun.error && (
          <div className="px-2 pb-1.5 pl-[18px]">
            <p className="text-[11px] text-[var(--status-error)] opacity-90 leading-relaxed line-clamp-2">
              {nodeRun.error}
            </p>
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <NodeDetailDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        nodeRun={nodeRun}
      />
    </div>
  );
}
