"use client";

import { useMemo, useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { NodeTree } from "./NodeTree";
import { RUN_UI, runCreditLabel, runNeedsReview, isActiveRunStatus } from "@/lib/ui-config";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";

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

export type HistoryRun = {
  id: string;
  scope: string;
  status: string;
  durationMs: number | null;
  createdAt: Date;
  nodeRuns: NodeRun[];
  accountingVersion?: number;
  reservedCredits?: number;
  chargedCredits?: number | null;
  settledAt?: Date | string | null;
  dispatchError?: string | null;
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
  run: HistoryRun;
  open: boolean;
  onToggle: () => void;
  checkedAt: number;
}

export function RunCard({ run, open, onToggle, checkedAt }: RunCardProps) {
  const utils = trpc.useUtils();
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const recover = trpc.workflow.recover.useMutation({
    onSuccess: result => {
      setRecoveryMessage(RUN_UI.recovery.outcomes[result.outcome]);
      void utils.workflow.history.invalidate();
      void utils.workflow.status.invalidate({ runId: run.id });
      void utils.credits.getBalance.invalidate();
    },
    onError: () => setRecoveryMessage(RUN_UI.recovery.error),
  });
  const needsReview = runNeedsReview(run, checkedAt);
  const statusCfg = RUN_UI.status[run.status as keyof typeof RUN_UI.status] ?? { color: "bg-[var(--status-unknown)]", label: run.status, pulse: false };
  const creditLabel = runCreditLabel(run);

  const shortId = run.id.slice(-8).toUpperCase();
  const duration = run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : null;

  const relativeTime = useMemo(() => {
    const d = typeof run.createdAt === "string" ? new Date(run.createdAt) : run.createdAt;
    return formatDistanceToNow(d, { addSuffix: true });
  }, [run.createdAt]);

  return (
    <Collapsible.Root open={open} onOpenChange={onToggle}>
      <div className="group">
        <Collapsible.Trigger asChild>
          <button
            type="button"
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

            <div className="text-[11px] text-[var(--history-meta-color)] mt-1 pl-[18px]" title={needsReview ? run.dispatchError || RUN_UI.messages.needsReview : undefined}>
              {statusCfg.label}{needsReview ? ` · ${RUN_UI.labels.needsReview}` : ""}
            </div>
            {/* Row 2: timestamp, scope, credits */}
            <div className="flex flex-wrap items-center gap-1.5 mt-1 pl-[18px]">
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

              <span className="text-[10px] font-mono tabular-nums text-[var(--text-muted)]" title={run.accountingVersion !== 1 ? RUN_UI.messages.legacyBilling : undefined}>
                {creditLabel}
              </span>
            </div>
          </button>
        </Collapsible.Trigger>

        {/* Expanded node tree */}
        <Collapsible.Content className="overflow-hidden data-[state=open]:animate-in data-[state=open]:slide-in-from-top-1 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top-1 data-[state=closed]:fade-out-0 duration-200">
          <div className="px-4 pb-3">
            {needsReview && <p className="text-[11px] text-[var(--status-warning)] mb-2">{run.dispatchError || RUN_UI.messages.needsReview}</p>}
            {run.accountingVersion === 1 && isActiveRunStatus(run.status) && (
              <Button type="button" variant="outline" size="sm" disabled={recover.isPending} onClick={() => recover.mutate({ runId: run.id })}>
                {recover.isPending ? RUN_UI.recovery.pending : RUN_UI.recovery.label}
              </Button>
            )}
            {recoveryMessage && <p role="status" className="text-xs text-[var(--text-muted)] mt-2">{recoveryMessage}</p>}
            <NodeTree nodeRuns={run.nodeRuns ?? []} isStale={false} />
          </div>
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}
