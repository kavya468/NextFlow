"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RUN_UI } from "@/lib/ui-config";
import { trpc } from "@/lib/trpc/client";
import { CheckCircle2, AlertTriangle, Play } from "lucide-react";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs";

interface PreRunModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
  onConfirm: () => void;
}

function getCategoryColor(nodeType: string): string {
  const config = nodeRegistry.get(nodeType);
  if (!config) return "bg-[var(--status-unknown)]";
  switch (config.category) {
    case "ai": return "bg-violet-500";
    case "media": return "bg-rose-500";
    case "logic": return "bg-sky-500";
    case "utility": return "bg-[var(--status-pending)]";
    case "input": return "bg-[var(--status-unknown)]";
    default: return "bg-[var(--status-unknown)]";
  }
}

function getNodeName(nodeType: string): string {
  const config = nodeRegistry.get(nodeType);
  return config?.name ?? nodeType;
}

export function PreRunModal({ open, onOpenChange, nodes, onConfirm }: PreRunModalProps) {
  const nodesForEstimate = nodes.map((n) => ({
    id: n.id,
    type: n.type || "unknown",
    data: (n.data as Record<string, unknown>) ?? {},
  }));

  const { data: balanceData, isLoading: balanceLoading, error: balanceError } = trpc.credits.getBalance.useQuery(
    undefined,
    { enabled: open, staleTime: 5_000 }
  );

  const { data: estimateData, isLoading: estimateLoading, error: estimateError } = trpc.credits.estimateNodes.useQuery(
    { nodes: nodesForEstimate },
    { enabled: open }
  );

  const balance = balanceData?.balance ?? 0;
  const total = estimateData?.total ?? 0;
  const perNode = estimateData?.perNode ?? [];
  const isLoading = balanceLoading || estimateLoading;
  const hasQuote = !!balanceData && !!estimateData && !balanceError && !estimateError;
  const isSufficient = hasQuote && balance >= total;
  const afterRun = balance - total;

  const maxEstimate = Math.max(...perNode.map((n) => n.estimate), 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[var(--popover-bg)] border-[var(--popover-border)] text-[var(--text-primary)]">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)]">{RUN_UI.labels.reservationTitle}</DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {RUN_UI.messages.reservation}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 rounded-md bg-[var(--hover-bg)] animate-pulse" />
              ))}
            </div>
          ) : !hasQuote ? (
            <p className="text-xs text-[var(--status-error)]" role="alert">{RUN_UI.messages.reservationUnavailable}</p>
          ) : (
            <>
              {/* Per-node breakdown */}
              <div className="space-y-1.5">
                {perNode.map((node) => {
                  const isFree = node.estimate === 0;
                  const barWidth = isFree ? 0 : (node.estimate / maxEstimate) * 100;

                  return (
                    <div key={node.nodeId} className="flex items-center gap-3 text-xs">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${getCategoryColor(node.nodeType)}`} />
                      <span className="text-[var(--text-secondary)] w-32 truncate">
                        {getNodeName(node.nodeType)}
                      </span>
                      <div className="flex-1 h-1.5 bg-[var(--hover-bg)] rounded-full overflow-hidden">
                        {!isFree && (
                          <div
                            className="h-full bg-[var(--status-pending)] rounded-full transition-all"
                            style={{ width: `${Math.max(barWidth, 4)}%` }}
                          />
                        )}
                      </div>
                      <span className="font-mono tabular-nums text-[var(--text-secondary)] w-24 text-right">
                        {isFree
                          ? <span className="text-[var(--text-muted)]">{RUN_UI.labels.noReservation}</span>
                          : `${node.estimate.toLocaleString()} cr`
                        }
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Divider */}
              <div className="border-t border-[var(--separator)] my-3" />

              {/* Totals */}
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--text-secondary)]">{RUN_UI.labels.maximumReservation}</span>
                  <span className="font-mono tabular-nums font-medium text-[var(--text-primary)]">
                    {total.toLocaleString()} cr
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--text-secondary)]">{RUN_UI.labels.availableBalance}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono tabular-nums text-[var(--text-primary)]">
                      {balance.toLocaleString("en-US")} cr
                    </span>
                    {isSufficient ? (
                      <CheckCircle2 className="w-3 h-3 text-[var(--status-success)]" />
                    ) : (
                      <AlertTriangle className="w-3 h-3 text-[var(--status-error)]" />
                    )}
                  </span>
                </div>
                {isSufficient && (
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">{RUN_UI.labels.afterReservation}</span>
                    <span className="font-mono tabular-nums text-[var(--text-secondary)]">
                      {afterRun.toLocaleString()} cr
                    </span>
                  </div>
                )}
              </div>

              <p className="text-[11px] text-[var(--text-secondary)]">{RUN_UI.messages.settlement}</p>
              {total > 0 && <p className="text-[11px] text-[var(--text-muted)]">{RUN_UI.messages.zeroChargeReservation}</p>}

              {/* Insufficient warning */}
              {!isSufficient && (
                <div className="rounded-lg bg-[var(--status-error-bg)] border border-[var(--status-error-border)] p-3 mt-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-[var(--status-error)] mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-[var(--status-error)]">
                        {RUN_UI.labels.insufficientReservation}
                      </p>
                      <p className="text-[11px] text-[var(--status-error)] opacity-80 mt-0.5">
                        This workflow holds {total.toLocaleString()} cr.
                        You have {balance.toLocaleString("en-US")} cr remaining.
                      </p>
                      <a
                        href="mailto:support@nextflow.dev"
                        className="text-[11px] text-[var(--status-error)] underline underline-offset-2 mt-1 inline-block hover:opacity-80"
                      >
                        Request Top-up
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {RUN_UI.labels.cancel}
          </button>
          <button
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
            disabled={isLoading || !isSufficient}
            className={`
              flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium transition-colors
              ${isSufficient && !isLoading
                ? "bg-[var(--status-success)] text-[var(--text-inverse)] hover:opacity-90"
                : "bg-[var(--button-disabled-bg)] text-[var(--button-disabled-text)] cursor-not-allowed"
              }
            `}
          >
            <Play className="w-3 h-3" />
            {RUN_UI.labels.confirmReservation}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
