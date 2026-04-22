"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { trpc } from "@/lib/trpc/client";
import { ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react";

interface CreditHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatReason(reason: string): string {
  if (reason.startsWith("node:")) return reason.replace("node:", "").replace(/-/g, " ");
  if (reason.startsWith("reserve:")) return "Run reservation";
  if (reason.startsWith("settle:node:")) return reason.replace("settle:node:", "").replace(/-/g, " ");
  if (reason.startsWith("settle:")) return reason.replace("settle:", "");
  if (reason.startsWith("refund:")) return "Refund";
  if (reason === "topup") return "Credit top-up";
  return reason;
}

export function CreditHistoryDrawer({ open, onOpenChange }: CreditHistoryDrawerProps) {
  const { data: balanceData } = trpc.credits.getBalance.useQuery(undefined, {
    staleTime: 30_000,
  });

  const { data: historyData, isLoading } = trpc.credits.getHistory.useQuery(
    { limit: 50 },
    { enabled: open }
  );

  const items = historyData?.items ?? [];

  // Group by date
  const grouped = items.reduce<Record<string, typeof items>>((acc, item) => {
    const dateKey = formatDate(item.createdAt);
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(item);
    return acc;
  }, {});

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[400px] bg-[var(--panel-bg)] border-[var(--panel-border)]">
        <SheetHeader>
          <SheetTitle className="text-[var(--text-primary)]">Credit History</SheetTitle>
          {balanceData && (
            <div className="flex items-baseline gap-2 pt-1">
              <span className="text-2xl font-mono tabular-nums tracking-tight text-[var(--text-primary)]">
                {balanceData.balance.toLocaleString("en-US")}
              </span>
              <span className="text-xs text-[var(--text-muted)]">credits</span>
            </div>
          )}
        </SheetHeader>

        <div className="mt-6 flex-1 overflow-y-auto pr-1 -mr-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-[var(--text-muted)] animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-[var(--text-muted)]">No credit activity yet.</p>
              <p className="text-xs text-[var(--text-placeholder)] mt-1">
                Credits will appear here after your first workflow run.
              </p>
            </div>
          ) : (
            Object.entries(grouped).map(([date, entries]) => (
              <div key={date} className="mb-5">
                <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-placeholder)] mb-2 px-1">
                  {date}
                </div>
                <div className="space-y-0.5">
                  {entries.map((entry) => {
                    const isCredit = entry.delta > 0;
                    const isSettlement = entry.reason.startsWith("settle:");
                    if (isSettlement && entry.delta === 0) return null;

                    return (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-[var(--sidebar-item-hover)] transition-colors group"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`
                            w-6 h-6 rounded-md flex items-center justify-center shrink-0
                            ${isCredit ? "bg-[var(--status-success-bg)] text-[var(--status-success)]" : "bg-[var(--badge-bg)] text-[var(--text-muted)]"}
                          `}>
                            {isCredit ? (
                              <ArrowDownLeft className="w-3 h-3" />
                            ) : (
                              <ArrowUpRight className="w-3 h-3" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs text-[var(--text-primary)] truncate capitalize">
                              {formatReason(entry.reason)}
                            </p>
                            <p className="text-[10px] text-[var(--text-muted)]">
                              {formatTime(entry.createdAt)}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`
                            text-xs font-mono tabular-nums shrink-0 ml-3
                            ${isCredit ? "text-[var(--status-success)]" : "text-[var(--text-secondary)]"}
                          `}
                        >
                          {isCredit ? "+" : ""}
                          {entry.delta.toLocaleString("en-US")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
