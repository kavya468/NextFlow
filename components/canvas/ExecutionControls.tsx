"use client";

import { useStore, type NodeRunStatus } from "@/lib/store";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useState, useRef, useCallback, useEffect } from "react";
import type { Node } from "@xyflow/react";
import { useRealtimeRun } from "@trigger.dev/react-hooks";
import { PreRunModal } from "@/components/credits/PreRunModal";
import { CostEstimateTooltip } from "@/components/credits/CostEstimateTooltip";
import { trpc } from "@/lib/trpc/client";
import { EDITOR_UI, RUN_UI, dispatchRunStatus, isKnownRequestRejection, isRecord, isTerminalRunStatus } from "@/lib/ui-config";
import type { ExecuteWorkflowInput } from "@/lib/schemas";
import type { SavedWorkflow } from "@/hooks/save-coordinator";

export interface ExecutionControlsProps {
  workflowId?: string;
  workflowScope: string;
  prepareWorkflow: () => Promise<SavedWorkflow>;
  onWorkflowResolved: (id: string) => void;
  onSaveConflict: (error: unknown) => void;
}

type SavedRun = {
  id: string;
  status: string;
  triggerId?: string | null;
  nodeRuns: Array<{ nodeId: string; status: string; outputs: unknown }>;
};

type AcceptedRun = {
  runId: string;
  workflowId: string;
  status: string;
  triggerId?: string;
  publicAccessToken?: string;
};

export function ExecutionControls({ workflowScope, prepareWorkflow, onWorkflowResolved, onSaveConflict }: ExecutionControlsProps) {
  const mountedRef = useRef(false);
  const isCurrentSession = useCallback(() => mountedRef.current && useStore.getState().workflowScope === workflowScope, [workflowScope]);
  const nodes = useStore((state) => state.nodes);
  const setRunningNodeIds = useStore((state) => state.setRunningNodeIds);
  const setNodeRunStatuses = useStore((state) => state.setNodeRunStatuses);
  const clearNodeRunStatuses = useStore((state) => state.clearNodeRunStatuses);
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const pastLength = useStore((state) => state.past.length);
  const futureLength = useStore((state) => state.future.length);

  const utils = trpc.useUtils();
  const executeMutation = trpc.workflow.execute.useMutation();
  const cancelMutation = trpc.workflow.cancel.useMutation();
  const retryDispatchMutation = trpc.workflow.retryDispatch.useMutation();

  // ── Execution State ───────────────────────────────────────────────────
  const [isRunning, setIsRunning] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [triggerId, setTriggerId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [showPreRunModal, setShowPreRunModal] = useState(false);
  const [pendingOverrideNodeIds, setPendingOverrideNodeIds] = useState<string[] | undefined>(undefined);

  const currentRunIdRef = useRef<string | null>(null);
  const pendingRequestRef = useRef<ExecuteWorkflowInput | null>(null);
  const startingRef = useRef(false);
  const clearStatusesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [requestUnconfirmed, setRequestUnconfirmed] = useState(false);
  const [runStatus, setRunStatus] = useState("PENDING");
  const [awaitingSettlement, setAwaitingSettlement] = useState(false);

  const { data: savedRun, error: statusError } = trpc.workflow.status.useQuery(
    { runId: currentRunId ?? "" },
    {
      enabled: !!currentRunId && isRunning,
      refetchInterval: (query) => isTerminalRunStatus(query.state.data?.status ?? "") ? false : RUN_UI.pollIntervalMs,
      refetchIntervalInBackground: true,
    },
  );
  const { data: tokenData } = trpc.workflow.triggerToken.useQuery(
    { runId: currentRunId ?? "" },
    { enabled: !!currentRunId && !!triggerId && !accessToken && isRunning },
  );
  const realtimeToken = accessToken ?? (tokenData?.triggerId === triggerId ? tokenData.publicAccessToken : null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (clearStatusesTimerRef.current) clearTimeout(clearStatusesTimerRef.current);
    };
  }, []);

  // Tracks whether we've already handled the terminal state for this run
  // to prevent double-cleanup between onComplete and the useEffect fallback.
  const terminalHandledRef = useRef(false);

  // ── Shared helper: merge node outputs into React Flow node data ────────
  const syncNodeOutputsToStore = useCallback(
    (outputMap: Record<string, Record<string, unknown>>) => {
      if (!isCurrentSession()) return;
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

        if (Object.entries(resultData).some(([key, value]) => !Object.is(node.data[key], value))) {
          changed = true;
          return { ...node, data: { ...node.data, ...resultData } };
        }
        return node;
      });
      if (changed) {
        useStore.getState().setNodes(updatedNodes);
      }
    },
    [isCurrentSession]
  );

  // Only the saved run can finish the UI and release its monitoring state.
  const applySavedRun = useCallback((run: SavedRun) => {
    if (!isCurrentSession() || run.id !== currentRunIdRef.current || terminalHandledRef.current) return;
    setRunStatus(run.status);
    if (run.triggerId) setTriggerId(run.triggerId);
    const statuses: Record<string, NodeRunStatus> = {};
    const outputs: Record<string, Record<string, unknown>> = {};
    for (const node of run.nodeRuns) {
      if (["PENDING", "RUNNING", "SUCCESS", "FAILED", "BLOCKED"].includes(node.status)) {
        statuses[node.nodeId] = node.status as NodeRunStatus;
      }
      if (node.status === "SUCCESS" && isRecord(node.outputs)) outputs[node.nodeId] = node.outputs;
    }
    setNodeRunStatuses(statuses);
    syncNodeOutputsToStore(outputs);
    if (!isTerminalRunStatus(run.status)) {
      setRunningNodeIds(run.nodeRuns.filter(node => node.status === "RUNNING").map(node => node.nodeId));
      return;
    }
    terminalHandledRef.current = true;
    setRunningNodeIds([]);
    setIsRunning(false);
    setAwaitingSettlement(false);
    setCurrentRunId(null);
    setTriggerId(null);
    setAccessToken(null);
    window.dispatchEvent(new Event("nextflow:run-complete"));
    void utils.credits.getBalance.invalidate();
    clearStatusesTimerRef.current = setTimeout(() => {
      if (!isCurrentSession() || currentRunIdRef.current !== run.id) return;
      clearNodeRunStatuses();
    }, RUN_UI.nodeStatusClearDelayMs);
  }, [isCurrentSession, setNodeRunStatuses, syncNodeOutputsToStore, setRunningNodeIds, clearNodeRunStatuses, utils.credits.getBalance]);

  useEffect(() => {
    if (savedRun) applySavedRun(savedRun);
  }, [savedRun, applySavedRun]);

  const refreshSavedRun = useCallback(async () => {
    const runId = currentRunIdRef.current;
    if (!isCurrentSession() || !runId || terminalHandledRef.current) return;
    setAwaitingSettlement(true);
    try {
      const run = await utils.client.workflow.status.query({ runId });
      applySavedRun(run);
    } catch {
      // Polling remains active; a transport failure does not establish run failure.
    }
  }, [isCurrentSession, utils.client.workflow.status, applySavedRun]);

  const { run: realtimeRun, error: realtimeError } = useRealtimeRun(triggerId ?? "", {
    accessToken: realtimeToken ?? "",
    enabled: !!triggerId && !!realtimeToken && isRunning,
    onComplete: (completedRun) => {
      if (completedRun.id === triggerId) void refreshSavedRun();
    },
  });

  useEffect(() => {
    if (!isCurrentSession() || !realtimeRun || realtimeRun.id !== triggerId || terminalHandledRef.current) return;
    const meta = realtimeRun.metadata as Record<string, unknown> | undefined;
    if (realtimeRun.finishedAt || realtimeRun.status === "COMPLETED" || isTerminalRunStatus(String(meta?.runStatus ?? ""))) {
      void refreshSavedRun();
      return;
    }
    if (isRecord(meta?.nodeStatuses)) {
      const statuses: Record<string, NodeRunStatus> = {};
      for (const [id, status] of Object.entries(meta.nodeStatuses)) {
        if (typeof status === "string" && ["PENDING", "RUNNING", "SUCCESS", "FAILED", "BLOCKED"].includes(status)) statuses[id] = status as NodeRunStatus;
      }
      setNodeRunStatuses(statuses);
      setRunningNodeIds(Object.keys(statuses).filter(id => statuses[id] === "RUNNING"));
    }
  }, [isCurrentSession, realtimeRun, triggerId, refreshSavedRun, setNodeRunStatuses, setRunningNodeIds]);

  const acceptRun = useCallback((data: AcceptedRun) => {
    if (!isCurrentSession()) return;
    currentRunIdRef.current = data.runId;
    terminalHandledRef.current = false;
    pendingRequestRef.current = null;
    setRequestUnconfirmed(false);
    setCurrentRunId(data.runId);
    setTriggerId(data.triggerId ?? null);
    setAccessToken(data.publicAccessToken ?? null);
    setRunStatus(dispatchRunStatus(data.status));
    setIsRunning(true);
    setAwaitingSettlement(false);
    onWorkflowResolved(data.workflowId);
    void utils.workflow.history.invalidate();
    void utils.credits.getBalance.invalidate();
    if (data.status === "dispatch_unknown") {
      useStore.getState().setIsRightSidebarOpen(true);
      toast.info(RUN_UI.messages.dispatchUnknown);
    }
  }, [isCurrentSession, onWorkflowResolved, utils.workflow.history, utils.credits.getBalance]);

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
        const field = schema.shape[targetHandleKey];
        if (!field) continue;
        const result = field.safeParse(sourceValue);

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
    if (isRunning || startingRef.current) return;
    startingRef.current = true;
    currentRunIdRef.current = null;
    setCurrentRunId(null);
    setTriggerId(null);
    setAccessToken(null);
    setIsRunning(true);
    setAwaitingSettlement(false);
    setRunStatus("PENDING");
    terminalHandledRef.current = false;
    if (clearStatusesTimerRef.current) clearTimeout(clearStatusesTimerRef.current);
    try {
      if (!pendingRequestRef.current) {
        // Run only the acknowledged revision after the entire save queue drains.
        const savedWorkflow = await prepareWorkflow();
        if (!isCurrentSession()) return;
        const selectedNodes = useStore.getState().nodes.filter(node => node.selected && node.type !== "note");
        const selectedNodeIds = overrideNodeIds ?? (selectedNodes.length ? selectedNodes.map(node => node.id) : undefined);
        pendingRequestRef.current = {
          idempotencyKey: crypto.randomUUID(),
          workflowId: savedWorkflow.id,
          expectedRevision: savedWorkflow.revision,
          nodes: savedWorkflow.nodes.filter(node => node.type !== "note").map(node => ({ ...node, type: node.type || "default" })),
          edges: savedWorkflow.edges,
          ...(selectedNodeIds && { selectedNodeIds }),
        };
      }
      acceptRun(await executeMutation.mutateAsync(pendingRequestRef.current));
    } catch (error: unknown) {
      if (!isCurrentSession()) return;
      if (isRecord(error) && isRecord(error.data) && error.data.code === "CONFLICT") onSaveConflict(error);
      const knownRejection = isKnownRequestRejection(error);
      if (knownRejection) pendingRequestRef.current = null;
      const unconfirmed = !!pendingRequestRef.current;
      setRequestUnconfirmed(unconfirmed);
      toast.error(unconfirmed ? RUN_UI.messages.requestUnknown : error instanceof Error ? error.message : "Could not start workflow");
      setIsRunning(false);
      setRunningNodeIds([]);
    } finally {
      startingRef.current = false;
    }
  }, [isRunning, prepareWorkflow, isCurrentSession, onSaveConflict, acceptRun, executeMutation, setRunningNodeIds]);

  const retryDispatch = async () => {
    if (!currentRunId || retryDispatchMutation.isPending) return;
    try {
      acceptRun(await retryDispatchMutation.mutateAsync({ runId: currentRunId }));
    } catch (error: unknown) {
      if (isCurrentSession()) toast.error(error instanceof Error ? error.message : RUN_UI.messages.dispatchUnknown);
    }
  };

  // Listen for "Run this node" from context menu / per-node play button
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent<{ nodeIds: string[] }>;
      if (ev.detail?.nodeIds?.length) requestRun(ev.detail.nodeIds);
    };
    window.addEventListener("nextflow:run-nodes", handler);
    return () => window.removeEventListener("nextflow:run-nodes", handler);
  }, [requestRun]);

  const handleCancel = useCallback(async () => {
    if (!currentRunId) return;
    try {
      const result = await cancelMutation.mutateAsync({ runId: currentRunId });
      if (!isCurrentSession()) return;
      setRunStatus(result.status);
      if (result.status === "CANCEL_REQUESTED") toast.info(RUN_UI.messages.cancellationRequested);
      await refreshSavedRun();
    } catch (error: unknown) {
      if (isCurrentSession()) toast.error(error instanceof Error ? error.message : "Could not request cancellation");
    }
  }, [isCurrentSession, currentRunId, cancelMutation, refreshSavedRun]);

  const monitoringLabel = runStatus === "DISPATCH_UNKNOWN" ? RUN_UI.labels.dispatchUnknown
    : runStatus === "CANCEL_REQUESTED" ? RUN_UI.labels.cancelRequested
    : awaitingSettlement ? RUN_UI.labels.checking
    : !currentRunId ? RUN_UI.labels.starting
    : runStatus === "PENDING" ? RUN_UI.labels.pending : RUN_UI.labels.running;
  const monitoringMessage = statusError ? RUN_UI.messages.statusUnavailable
    : runStatus === "DISPATCH_UNKNOWN" ? RUN_UI.messages.dispatchUnknown
    : runStatus === "CANCEL_REQUESTED" ? RUN_UI.messages.cancellationRequested
    : awaitingSettlement ? RUN_UI.messages.checking
    : realtimeError ? RUN_UI.messages.liveUnavailable : "";

  return (
    <div className="editor-execution-controls" role="group" aria-label={EDITOR_UI.labels.executionControls}>

      {/* Undo / Redo */}
      <div className="flex items-center bg-[var(--rf-controls-bg)] border border-[var(--rf-controls-border)] rounded-xl shadow-2xl p-1 gap-1">
        <button
          onClick={undo}
          disabled={pastLength === 0}
          className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${pastLength > 0 ? "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-btn-hover)]" : "text-[var(--text-disabled)] cursor-not-allowed"}`}
          title="Undo (⌘Z)"
          aria-label={EDITOR_UI.labels.undo}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>
        </button>
        <button
          onClick={redo}
          disabled={futureLength === 0}
          className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${futureLength > 0 ? "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-btn-hover)]" : "text-[var(--text-disabled)] cursor-not-allowed"}`}
          title="Redo (⌘⇧Z)"
          aria-label={EDITOR_UI.labels.redo}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"></path></svg>
        </button>
      </div>

      {/* Run button */}
      <div className="editor-run-actions">
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
            onClick={() => requestUnconfirmed ? void executeWorkflow() : requestRun()}
            disabled={isRunning || (!requestUnconfirmed && nodes.length === 0)}
            title={isRunning ? monitoringMessage || monitoringLabel : requestUnconfirmed ? RUN_UI.messages.requestUnknown : runTitle}
            className={`flex items-center justify-center gap-2 px-6 h-12 rounded-xl text-[13px] font-semibold tracking-wide shadow-[0_0_20px_var(--btn-primary-shadow)] transition-all
              ${isRunning
                ? "bg-[var(--status-running-bg)] text-[var(--status-running)] cursor-not-allowed border border-[var(--status-running-border)]"
                : "bg-[var(--btn-primary-bg)] text-[var(--text-inverse)] hover:bg-[var(--btn-primary-hover)] hover:-translate-y-0.5"
              }`}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{monitoringLabel}</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l14 9-14 9V3z"></path></svg>
                <span>{requestUnconfirmed ? RUN_UI.labels.retryRequest : runLabel}</span>
                {!isRunning && nodes.length > 0 && (
                  <CostEstimateTooltip nodes={nodes} />
                )}
              </>
            )}
          </button>
        );
      })()}
      
      {isRunning && runStatus === "DISPATCH_UNKNOWN" && (
        <button type="button" onClick={retryDispatch} disabled={retryDispatchMutation.isPending}
          className="flex items-center justify-center px-4 h-12 rounded-xl text-[13px] font-semibold border border-[var(--rf-controls-border)] bg-[var(--rf-controls-bg)] text-[var(--text-primary)] hover:bg-[var(--toolbar-btn-hover)]">
          {retryDispatchMutation.isPending ? RUN_UI.labels.retryingDispatch : RUN_UI.labels.retryDispatch}
        </button>
      )}
      {isRunning && (
        <button
          onClick={handleCancel}
          disabled={!currentRunId || cancelMutation.isPending || runStatus === "CANCEL_REQUESTED"}
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
              {RUN_UI.labels.cancelling}
            </>
          ) : (
            runStatus === "CANCEL_REQUESTED" ? RUN_UI.labels.cancelRequested : RUN_UI.labels.cancel
          )}
        </button>
      )}
      </div>

      <span className="sr-only" role="status" aria-live="polite">{isRunning ? `${monitoringLabel}. ${monitoringMessage}` : requestUnconfirmed ? RUN_UI.messages.requestUnknown : ""}</span>
      <PreRunModal
        open={showPreRunModal}
        onOpenChange={setShowPreRunModal}
        nodes={nodes}
        onConfirm={() => executeWorkflow(pendingOverrideNodeIds)}
      />
    </div>
  );
}
