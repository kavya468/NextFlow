"use client";

import { useStore } from "@/lib/store";
import { trpc } from "@/lib/trpc/client";
import { History, PlayCircle, X } from "lucide-react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { EDITOR_UI, RUN_UI, isActiveRunStatus } from "@/lib/ui-config";
import { RunCard, type HistoryRun } from "@/components/history/RunCard";

export function RightSidebar({ workflowId }: { workflowId?: string }) {
  const { data = [], isLoading: loading, dataUpdatedAt: checkedAt, refetch: fetchHistory } = trpc.workflow.history.useQuery({ workflowId }, {
    enabled: !!workflowId,
    refetchInterval: (query) => {
      const runs = (query.state.data ?? []) as unknown as HistoryRun[];
      const hasRunning = runs.some((r) => isActiveRunStatus(r.status));
      return hasRunning ? RUN_UI.pollIntervalMs : false;
    },
  });

  const runs = useMemo(() => {
    if (!workflowId) return [];
    return [...(data as unknown as HistoryRun[])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [data, workflowId]);

  const [expandedRunId, setExpandedRunId] = useState<string | null | undefined>(undefined);

  const isRightSidebarOpen = useStore((state) => state.isRightSidebarOpen);
  const setIsRightSidebarOpen = useStore((state) => state.setIsRightSidebarOpen);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isRightSidebarOpen && window.matchMedia(EDITOR_UI.historyOverlayViewport).matches) {
      closeButtonRef.current?.focus();
    }
  }, [isRightSidebarOpen]);

  useEffect(() => {
    const onRunComplete = () => { if (workflowId) void fetchHistory(); };
    window.addEventListener("nextflow:run-complete", onRunComplete);
    return () => window.removeEventListener("nextflow:run-complete", onRunComplete);
  }, [fetchHistory, workflowId]);

  // Auto-expand only until the user explicitly opens or closes a history entry.
  const activeRunId = runs.find(run => isActiveRunStatus(run.status))?.id;
  const visibleRunId = expandedRunId === undefined ? activeRunId : expandedRunId;
  const toggleRun = useCallback(
    (id: string) => setExpandedRunId(previous => (previous === undefined ? activeRunId : previous) === id ? null : id),
    [activeRunId],
  );

  const closeHistory = () => {
    setIsRightSidebarOpen(false);
    document.getElementById(EDITOR_UI.ids.historyToggle)?.focus();
  };

  return (
    <aside
      id={EDITOR_UI.ids.history}
      aria-label={EDITOR_UI.labels.history}
      hidden={!isRightSidebarOpen}
      className="editor-history flex flex-col h-full bg-[var(--panel-bg)] border-l border-[var(--panel-border)] overflow-hidden"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          closeHistory();
        }
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-[52px] shrink-0 min-w-0 border-b border-[var(--panel-border)]">
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
          ref={closeButtonRef}
          type="button"
          onClick={closeHistory}
          aria-label={EDITOR_UI.labels.closeHistory}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded-md hover:bg-[var(--sidebar-item-hover)]"
          title={EDITOR_UI.labels.closeHistory}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Run list */}
      <div className="flex-1 overflow-y-auto hide-scrollbar min-w-0">
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
                open={visibleRunId === run.id}
                checkedAt={checkedAt}
                onToggle={() => toggleRun(run.id)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
