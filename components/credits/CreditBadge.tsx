"use client";

import { Coins } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import { CreditHistoryDrawer } from "./CreditHistoryDrawer";

export function CreditBadge() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data, isLoading } = trpc.credits.getBalance.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const balance = data?.balance ?? 0;
  const isLow = balance < 100_000;
  const isCritical = balance < 10_000;

  return (
    <>
      <button
        onClick={() => setDrawerOpen(true)}
        className={`
          relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5
          border transition-colors text-xs font-medium
          ${isCritical
            ? "bg-[var(--status-error-bg)] border-[var(--status-error-border)] text-[var(--status-error)] hover:opacity-80"
            : isLow
              ? "bg-[var(--status-warning-bg)] border-[var(--status-warning-border)] text-[var(--status-warning)] hover:opacity-80"
              : "bg-[var(--badge-bg)] border-[var(--badge-border)] text-[var(--text-primary)] hover:bg-[var(--badge-bg-hover)]"
          }
        `}
      >
        <Coins className="w-3.5 h-3.5 shrink-0 opacity-70" />
        <span className="font-mono tabular-nums tracking-tight">
          {isLoading ? "..." : balance.toLocaleString("en-US")}
        </span>
        {isLow && !isCritical && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[var(--status-warning)]" />
        )}
        {isCritical && (
          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[var(--status-error)] animate-pulse" />
        )}
      </button>

      <CreditHistoryDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </>
  );
}
