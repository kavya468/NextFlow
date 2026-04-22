"use client";

import { useStore } from "@/lib/store";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useState, useRef, useCallback, useEffect } from "react";
import type { Node, Edge } from "@xyflow/react";
import { useRealtimeRun } from "@trigger.dev/react-hooks";
import { PreRunModal } from "@/components/credits/PreRunModal";
import { CostEstimateTooltip } from "@/components/credits/CostEstimateTooltip";
import { trpc } from "@/lib/trpc/client";

function jsonSafeReplacer() {
  const seen = new WeakSet();
  return function (this: unknown, _key: string, value: unknown): unknown {
    if (value !== null && typeof value === "object") {
      if (seen.has(value as object)) return undefined;
      if (typeof (value as { nodeType?: number }).nodeType === "number") return undefined;
      if (typeof (value as { __reactFiber?: unknown }).__reactFiber !== "undefined") return undefined;
      try {
        seen.add(value as object);
      } catch {
        return undefined;
      }
    }
    if (typeof value === "function") return undefined;
    return value;
  };
}

export function ExecutionControls() {
  const nodes = useStore((state) => state.nodes);
  const edges = useStore((state) => state.edges);
  const setRunningNodeIds = useStore((state) => state.setRunningNodeIds);
  const runningNodeIds = useStore((state) => state.runningNodeIds);
  const setNodeRunStatuses = useStore((state) => state.setNodeRunStatuses);
  const clearNodeRunStatuses = useStore((state) => state.clearNodeRunStatuses);
  const setNodes = useStore((state) => state.setNodes);
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const pastLength = useStore((state) => state.past.length);
  const futureLength = useStore((state) => state.future.length);

  const utils = trpc.useUtils();
  const executeMutation = trpc.workflow.execute.useMutation();
  const cancelMutation = trpc.workflow.cancel.useMutation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  // ── Execution State ───────────────────────────────────────────────────
  const [isRunning, setIsRunning] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [triggerId, setTriggerId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [showPreRunModal, setShowPreRunModal] = useState(false);
  const [pendingOverrideNodeIds, setPendingOverrideNodeIds] = useState<string[] | undefined>(undefined);

  const currentRunIdRef = useRef<string | null>(null);
  currentRunIdRef.current = currentRunId;

  // Tracks whether we've already handled the terminal state for this run
  // to prevent double-cleanup between onComplete and the useEffect fallback.
  const terminalHandledRef = useRef(false);

  // ── Shared helper: merge node outputs into React Flow node data ────────
  const syncNodeOutputsToStore = useCallback(
    (outputMap: Record<string, Record<string, unknown>>) => {
      const currentNodes = useStore.getState().nodes;
      let changed = false;
      const updatedNodes = currentNodes.map((node) => {
        const outputs = outputMap[node.id];
        if (!outputs) return node;

        const resultData: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(outputs)) {
          if (value !== undefined && value !== null) {
            resultData[`result_${key}`] = value;
          }
        }
        if (outputs.text) resultData.result = outputs.text;
        if (outputs.url) resultData.result_url = outputs.url;

        if (Object.keys(resultData).length > 0) {
          changed = true;
          return { ...node, data: { ...node.data, ...resultData } };
        }
        return node;
      });
      if (changed) {
        useStore.getState().setNodes(updatedNodes);
      }
    },
    []
  );

  // ── Terminal state handler (shared by onComplete + useEffect fallback) ──
  const handleRunTerminal = useCallback(
    (runMeta?: Record<string, unknown>, failed?: boolean) => {
      if (terminalHandledRef.current) return;
      if (!currentRunIdRef.current) return;
      terminalHandledRef.current = true;

      const finishedRunId = currentRunIdRef.current;

      const nodeStatuses = runMeta?.nodeStatuses as Record<string, string> | undefined;
      if (nodeStatuses) {
        setNodeRunStatuses(nodeStatuses as Record<string, any>);
      }
      const nodeOutputs = runMeta?.nodeOutputs as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (nodeOutputs) {
        syncNodeOutputsToStore(nodeOutputs);
      }

      setRunningNodeIds([]);
      setIsRunning(false);
      window.dispatchEvent(new Event("nextflow:run-complete"));
      utils.credits.getBalance.invalidate();
      setTimeout(() => {
        if (currentRunIdRef.current && currentRunIdRef.current !== finishedRunId) return;
        clearNodeRunStatuses();
      }, 4000);

      if (failed) {
        console.error("Workflow execution failed");
      }

      // One-shot DB fetch: Electric SQL can deliver the COMPLETED status
      // event before the last metadata.set("nodeOutputs", …) flush. A
      // single authoritative read from Prisma guarantees output previews
      // always appear regardless of SSE event ordering.
      if (finishedRunId) {
        utils.client.workflow.status
          .query({ runId: finishedRunId })
          .then((run) => {
            if (!run?.nodeRuns) return;
            const outputMap: Record<string, Record<string, unknown>> = {};
            for (const nr of run.nodeRuns) {
              if ((nr as any).status === "SUCCESS" && (nr as any).outputs) {
                outputMap[(nr as any).nodeId] = (nr as any).outputs as Record<
                  string,
                  unknown
                >;
              }
            }
            syncNodeOutputsToStore(outputMap);
          })
          .catch((err: unknown) =>
            console.warn("Final output fetch failed:", err)
          )
          .finally(() => {
            if (currentRunIdRef.current && currentRunIdRef.current !== finishedRunId) return;
            setCurrentRunId(null);
            setTriggerId(null);
            setAccessToken(null);
          });
      } else {
        setCurrentRunId(null);
        setTriggerId(null);
        setAccessToken(null);
      }
    },
    [setRunningNodeIds, setNodeRunStatuses, clearNodeRunStatuses, syncNodeOutputsToStore, utils.client.workflow.status]
  );

  // ── Trigger.dev Realtime Subscription ─────────────────────────────────
  const { run: realtimeRun, error: realtimeError } = useRealtimeRun(
    triggerId ?? "",
    {
      accessToken: accessToken ?? "",
      enabled: !!triggerId && !!accessToken && isRunning,

      onComplete: (completedRun, completedErr) => {
        if ((completedRun as any).id !== triggerId) return;
        const meta = completedRun.metadata as Record<string, unknown> | undefined;
        handleRunTerminal(meta, !!completedErr || completedRun.status === "FAILED");
      },
    }
  );

  // ── Sync Live Metadata → Zustand Store ────────────────────────────────
  // Fires on every metadata change during execution. Also serves as a
  // fallback terminal-state detector: if onComplete doesn't fire (race
  // between isComplete and finishedAt in the hook's SWR state), this
  // effect catches it via realtimeRun.finishedAt or status fields.
  useEffect(() => {
    if (!realtimeRun || !triggerId) return;

    // After a triggerId change, `realtimeRun` can still hold stale data
    // from the previous subscription until the new one delivers its first
    // event.  Ignore it so we don't accidentally kill a fresh run.
    const runId = (realtimeRun as any).id as string | undefined;
    if (runId && runId !== triggerId) return;

    const meta = realtimeRun.metadata as Record<string, unknown> | undefined;

    // Fallback terminal detection — catches completion even if onComplete
    // doesn't fire due to hook-internal SWR timing issues.
    const isTerminal =
      !!realtimeRun.finishedAt ||
      (realtimeRun as any).status === "COMPLETED" ||
      (meta?.runStatus &&
        ["SUCCESS", "FAILED", "PARTIAL"].includes(meta.runStatus as string));

    if (isTerminal && isRunning) {
      handleRunTerminal(
        meta,
        (realtimeRun as any).status === "FAILED" ||
          meta?.runStatus === "FAILED"
      );
      return;
    }

    // Once the run has been finalized, don't let stale realtime metadata
    // re-populate runningNodeIds (which would restart the pulse animation).
    if (terminalHandledRef.current) return;

    const nodeStatuses = meta?.nodeStatuses as Record<string, string> | undefined;
    if (nodeStatuses) {
      setNodeRunStatuses(nodeStatuses as Record<string, any>);

      const runningIds = Object.entries(nodeStatuses)
        .filter(([, status]) => status === "RUNNING")
        .map(([id]) => id);
      setRunningNodeIds(runningIds);
    }

    const nodeOutputs = meta?.nodeOutputs as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (nodeOutputs) {
      syncNodeOutputsToStore(nodeOutputs);
    }
  }, [
    realtimeRun,
    triggerId,
    isRunning,
    setRunningNodeIds,
    setNodeRunStatuses,
    syncNodeOutputsToStore,
    handleRunTerminal,
  ]);

  useEffect(() => {
    if (realtimeError) {
      console.warn("Realtime subscription error:", realtimeError);
    }
  }, [realtimeError]);

  /**
   * Pre-flight: for every edge where a passthrough text source feeds into a
   * typed target handle (number, boolean, select), run the target node's
   * Zod schema on the coerced value. Aborts with a toast on first failure.
   */
  const runPreFlightValidation = useCallback((): boolean => {
    const currentNodes = useStore.getState().nodes;
    const currentEdges = useStore.getState().edges;
    const nodeMap = new Map(currentNodes.map((n: Node) => [n.id, n]));

    for (const edge of currentEdges) {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!sourceNode || !targetNode) continue;

      const sourceType = sourceNode.type;
      const targetType = targetNode.type;
      if (!sourceType || !targetType) continue;

      const sourceConfig = nodeRegistry.get(sourceType);
      if (!sourceConfig?.isPassthrough) continue;

      const targetHandleKey = edge.targetHandle;
      if (!targetHandleKey) continue;

      const targetConfig = nodeRegistry.get(targetType);
      if (!targetConfig) continue;

      const targetInput = targetConfig.inputs.find((i) => i.key === targetHandleKey);
      if (!targetInput) continue;
      if (!["number", "boolean", "select"].includes(targetInput.type)) continue;

      const sourceData = (sourceNode.data ?? {}) as Record<string, unknown>;
      let sourceValue: unknown;
      if (sourceConfig.passthroughMapping) {
        const sourceOutputKey = edge.sourceHandle;
        const inputKey = Object.entries(sourceConfig.passthroughMapping)
          .find(([, outKey]) => outKey === sourceOutputKey)?.[0];
        sourceValue = inputKey ? sourceData[inputKey] : undefined;
      }
      if (sourceValue === undefined || sourceValue === "") continue;

      try {
        const schema = nodeRegistry.getInputSchema(targetType);
        const partial = { [targetHandleKey]: sourceValue };
        const result = schema.pick({ [targetHandleKey]: true } as any).safeParse(partial);

        if (!result.success) {
          const firstIssue = result.error.issues[0];
          const nodeName = targetConfig.name;
          toast.error(`Validation Error on ${nodeName}: ${firstIssue.message}`);
          return false;
        }
      } catch {
        // Schema generation failure — let the server catch it
      }
    }
    return true;
  }, []);

  const requestRun = useCallback((overrideNodeIds?: string[]) => {
    if (isRunning) return;
    if (!runPreFlightValidation()) return;
    setPendingOverrideNodeIds(overrideNodeIds);
    setShowPreRunModal(true);
  }, [isRunning, runPreFlightValidation]);

  const executeWorkflow = useCallback(async (overrideNodeIds?: string[]) => {
    if (isRunning) return;

    setIsRunning(true);
    terminalHandledRef.current = false;

    const selectedNodes = nodes.filter((n) => n.selected && n.type !== "note");
    const selectedNodeIds =
      overrideNodeIds ??
      (selectedNodes.length > 0 ? selectedNodes.map((n) => n.id) : undefined);

    try {
      const executableNodes = nodes.filter((n) => n.type !== "note");

      const payload = {
        nodes: executableNodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: (() => {
            const d = n.data ?? {};
            try {
              return JSON.parse(JSON.stringify(d, jsonSafeReplacer()));
            } catch {
              return {};
            }
          })(),
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          targetHandle: e.targetHandle ?? undefined,
        })),
        ...(selectedNodeIds && { selectedNodeIds }),
      };

      const data = await executeMutation.mutateAsync(payload as any);

      console.log("Triggered Run:", data);
      setCurrentRunId(data.runId);
      setTriggerId(data.triggerId);

      if (data.publicAccessToken) {
        setAccessToken(data.publicAccessToken);
      } else {
        // Initial token mint failed — try the dedicated refresh endpoint
        try {
          const tokenData = await utils.client.workflow.triggerToken.query({
            runId: data.runId,
          });
          setAccessToken(tokenData.publicAccessToken);
        } catch {
          toast.error("Live updates unavailable — could not create realtime token");
        }
      }
    } catch (err: any) {
      console.error("Failed to start workflow:", err);
      const msg = err?.message || err?.data?.message || "Workflow execution failed";
      if (msg.includes("Insufficient credits")) {
        toast.error(msg);
      } else {
        toast.error(msg);
      }
      setIsRunning(false);
      setRunningNodeIds([]);
    }
  }, [isRunning, nodes, edges, setRunningNodeIds, executeMutation, utils.client.workflow.triggerToken]);

  // Listen for "Run this node" from context menu / per-node play button
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ nodeIds: string[] }>;
      if (ev.detail?.nodeIds?.length) requestRun(ev.detail.nodeIds);
    };
    window.addEventListener("nextflow:run-nodes", handler);
    return () => window.removeEventListener("nextflow:run-nodes", handler);
  }, [requestRun]);

  // ── Cancel Handler ──────────────────────────────────────────────────
  const handleCancel = useCallback(async () => {
    if (!currentRunId) return;

    try {
      await cancelMutation.mutateAsync({ runId: currentRunId });

      // Immediately clear ref so onComplete / fallback effect skip cleanup
      currentRunIdRef.current = null;
      terminalHandledRef.current = true;

      setIsRunning(false);
      setRunningNodeIds([]);
      clearNodeRunStatuses();
      setCurrentRunId(null);
      setTriggerId(null);
      setAccessToken(null);
      window.dispatchEvent(new Event("nextflow:run-complete"));
    } catch (err) {
      console.error("Failed to cancel:", err);
    }
  }, [currentRunId, cancelMutation, setRunningNodeIds, clearNodeRunStatuses]);

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4">

      {/* Undo / Redo */}
      <div className="flex items-center bg-[var(--rf-controls-bg)] border border-[var(--rf-controls-border)] rounded-xl shadow-2xl p-1 gap-1">
        <button
          onClick={undo}
          disabled={pastLength === 0}
          className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${pastLength > 0 ? "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-btn-hover)]" : "text-[var(--text-disabled)] cursor-not-allowed"}`}
          title="Undo (⌘Z)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>
        </button>
        <button
          onClick={redo}
          disabled={futureLength === 0}
          className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${futureLength > 0 ? "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-btn-hover)]" : "text-[var(--text-disabled)] cursor-not-allowed"}`}
          title="Redo (⌘⇧Z)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"></path></svg>
        </button>
      </div>

      {/* Run button */}
      <div className="flex items-center gap-2">
      {(() => {
        const selectedCount = nodes.filter((n) => n.selected && n.type !== "note").length;
        const runLabel =
          selectedCount === 0
            ? "Run full workflow"
            : selectedCount === 1
              ? "Run 1 node"
              : `Run ${selectedCount} nodes`;
        const runTitle =
          selectedCount === 0
            ? "Run entire workflow"
            : selectedCount === 1
              ? "Run selected node (and its dependencies)"
              : "Run selected nodes (and their dependencies)";
        return (
          <button
            onClick={() => requestRun()}
            disabled={isRunning || nodes.length === 0}
            title={runTitle}
            className={`flex items-center justify-center gap-2 px-6 h-12 rounded-xl text-[13px] font-semibold tracking-wide shadow-[0_0_20px_var(--btn-primary-shadow)] transition-all
              ${isRunning
                ? "bg-[var(--status-running-bg)] text-[var(--status-running)] cursor-not-allowed border border-[var(--status-running-border)]"
                : "bg-[var(--btn-primary-bg)] text-[var(--text-inverse)] hover:bg-[var(--btn-primary-hover)] hover:-translate-y-0.5"
              }`}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Running...</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l14 9-14 9V3z"></path></svg>
                <span>{runLabel}</span>
                {!isRunning && nodes.length > 0 && (
                  <CostEstimateTooltip nodes={nodes} />
                )}
              </>
            )}
          </button>
        );
      })()}
      
      {isRunning && (
        <button
          onClick={handleCancel}
          disabled={!currentRunId || cancelMutation.isPending}
          className={`flex items-center justify-center px-4 h-12 rounded-xl text-[13px] font-semibold tracking-wide transition-all border
            ${cancelMutation.isPending
              ? "bg-[var(--btn-danger-disabled-bg)] text-[var(--status-error-muted)] border-[var(--btn-danger-disabled-border)] cursor-wait"
              : "bg-[var(--btn-danger-bg)] text-[var(--status-error)] hover:bg-[var(--btn-danger-hover)] border-[var(--btn-danger-border)]"
            }`}
          title="Cancel execution"
        >
          {cancelMutation.isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              Canceling...
            </>
          ) : (
            "Cancel"
          )}
        </button>
      )}
      </div>

      <PreRunModal
        open={showPreRunModal}
        onOpenChange={setShowPreRunModal}
        nodes={nodes}
        onConfirm={() => executeWorkflow(pendingOverrideNodeIds)}
      />
    </div>
  );
}
