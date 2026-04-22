"use client";

import { useStore } from "@/lib/store";
import { trpc } from "@/lib/trpc/client";
import { History, PlayCircle, X } from "lucide-react";
import { useEffect, useState, useMemo, useCallback } from "react";
import { RunCard } from "@/components/history/RunCard";

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

export function RightSidebar() {
  const { data = [], isLoading: loading, refetch: fetchHistory } = trpc.workflow.history.useQuery(undefined, {
    refetchInterval: (query) => {
      const runs = (query.state.data ?? []) as unknown as Run[];
      const hasRunning = runs.some((r) => r.status === "RUNNING");
      return hasRunning ? 3000 : false;
    },
  });

  const runs = useMemo(() => {
    return (data as unknown as Run[]).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [data]);

  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const isRightSidebarOpen = useStore((state) => state.isRightSidebarOpen);
  const setIsRightSidebarOpen = useStore((state) => state.setIsRightSidebarOpen);

  useEffect(() => {
    const onRunComplete = () => fetchHistory();
    window.addEventListener("nextflow:run-complete", onRunComplete);
    return () => window.removeEventListener("nextflow:run-complete", onRunComplete);
  }, [fetchHistory]);

  // Auto-expand the most recent running run
  useEffect(() => {
    const runningRun = runs.find((r) => r.status === "RUNNING");
    if (runningRun && !expandedRunId) {
      setExpandedRunId(runningRun.id);
    }
  }, [runs, expandedRunId]);

  const toggleRun = useCallback(
    (id: string) => setExpandedRunId((prev) => (prev === id ? null : id)),
    []
  );

  return (
    <div
      className={`flex flex-col h-full bg-[var(--panel-bg)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] border-l border-[var(--panel-border)] overflow-hidden ${
        isRightSidebarOpen ? "w-80" : "w-0 border-none"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-[52px] shrink-0 min-w-[320px] border-b border-[var(--panel-border)]">
        <div className="flex items-center gap-2">
          <History className="w-3.5 h-3.5 text-[var(--sidebar-icon)]" />
          <h2 className="text-[12px] font-medium text-[var(--text-primary)] tracking-wide">
            History
          </h2>
          {runs.length > 0 && (
            <span className="text-[10px] tabular-nums text-[var(--badge-text)] bg-[var(--badge-bg)] px-1.5 py-0.5 rounded">
              {runs.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setIsRightSidebarOpen(false)}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded-md hover:bg-[var(--sidebar-item-hover)]"
          title="Close History"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Run list */}
      <div className="flex-1 overflow-y-auto hide-scrollbar min-w-[320px]">
        {loading && runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <div className="w-5 h-5 border-2 border-[var(--node-border)] border-t-[var(--text-secondary)] rounded-full animate-spin" />
            <p className="text-[11px] text-[var(--text-muted)]">Loading history</p>
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center gap-2 px-6">
            <PlayCircle className="w-8 h-8 text-[var(--text-disabled)]" />
            <p className="text-[13px] text-[var(--text-secondary)] font-medium">No runs yet</p>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Run your workflow to see execution history
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--history-entry-border)]">
            {runs.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                open={expandedRunId === run.id}
                onToggle={() => toggleRun(run.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
