"use client";

import { useMemo } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { NodeTree } from "./NodeTree";

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

type Run = {
  id: string;
  scope: string;
  status: string;
  durationMs: number | null;
  createdAt: Date;
  nodeRuns: NodeRun[];
};

const STATUS_CONFIG: Record<string, { color: string; pulse?: boolean; label: string }> = {
  SUCCESS: { color: "bg-[var(--status-success)]", label: "Success" },
  FAILED: { color: "bg-[var(--status-error)]", label: "Failed" },
  PARTIAL: { color: "bg-[var(--status-warning)]", label: "Partial" },
  RUNNING: { color: "bg-[var(--status-running)]", pulse: true, label: "Running" },
  PENDING: { color: "bg-[var(--status-pending)]", pulse: true, label: "Pending" },
};

function scopeLabel(scope: string, nodeCount?: number): string {
  if (scope === "SINGLE") return "Single Node";
  if (scope === "FULL") return "Full Workflow";
  if (scope === "PARTIAL" && nodeCount) return `${nodeCount} Nodes`;
  return scope;
}

function formatFullDate(dateVal: string | Date): string {
  const d = typeof dateVal === "string" ? new Date(dateVal) : dateVal;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface RunCardProps {
  run: Run;
  open: boolean;
  onToggle: () => void;
}

export function RunCard({ run, open, onToggle }: RunCardProps) {
  const isStale = run.status === "RUNNING" && (Date.now() - new Date(run.createdAt).getTime() > 60 * 60 * 1000);
  const displayStatus = isStale ? "FAILED" : run.status;
  const statusCfg = STATUS_CONFIG[displayStatus] ?? { color: "bg-[var(--status-unknown)]", label: displayStatus };

  const shortId = run.id.slice(-8).toUpperCase();
  const duration = run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : null;

  const totalCredits = useMemo(
    () => run.nodeRuns?.reduce((sum, nr) => sum + (nr.creditsUsed ?? 0), 0) ?? 0,
    [run.nodeRuns]
  );

  const relativeTime = useMemo(() => {
    const d = typeof run.createdAt === "string" ? new Date(run.createdAt) : run.createdAt;
    return formatDistanceToNow(d, { addSuffix: true });
  }, [run.createdAt]);

  return (
    <Collapsible.Root open={open} onOpenChange={onToggle}>
      <div className="group">
        <Collapsible.Trigger asChild>
          <div
            role="button"
            tabIndex={0}
            className="w-full text-left px-4 py-3 hover:bg-[var(--list-item-hover)] transition-colors duration-150 cursor-pointer select-none"
          >
            {/* Row 1: status dot, run ID, duration, chevron */}
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${statusCfg.color} ${statusCfg.pulse ? "animate-pulse" : ""}`}
              />
              <span className="font-mono text-[11px] text-[var(--history-run-id-color)] tracking-wide">
                RUN #{shortId}
              </span>

              <div className="flex-1" />

              {duration && (
                <span className="text-[12px] font-medium tabular-nums text-[var(--text-primary)]">
                  {duration}
                </span>
              )}

              <ChevronDown
                className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform duration-200 ${
                  open ? "rotate-0" : "-rotate-90"
                }`}
              />
            </div>

            {/* Row 2: timestamp, scope, credits */}
            <div className="flex items-center gap-1.5 mt-1 pl-[18px]">
              <span
                className="text-[11px] text-[var(--history-meta-color)]"
                title={formatFullDate(run.createdAt)}
              >
                {relativeTime}
              </span>

              <span className="text-[var(--text-muted)]">·</span>

              <span className="text-[10px] text-[var(--badge-text)] bg-[var(--badge-bg)] px-1.5 py-0.5 rounded">
                {scopeLabel(run.scope, run.nodeRuns?.length)}
              </span>

              {totalCredits > 0 && (
                <>
                  <div className="flex-1" />
                  <span className="text-[10px] font-mono tabular-nums text-[var(--text-muted)]">
                    {totalCredits.toLocaleString()} cr
                  </span>
                </>
              )}
            </div>
          </div>
        </Collapsible.Trigger>

        {/* Expanded node tree */}
        <Collapsible.Content className="overflow-hidden data-[state=open]:animate-in data-[state=open]:slide-in-from-top-1 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top-1 data-[state=closed]:fade-out-0 duration-200">
          <div className="px-4 pb-3">
            <NodeTree nodeRuns={run.nodeRuns ?? []} isStale={isStale} />
          </div>
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}
