"use client";

import { useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs";
import { NodeOutput } from "./NodeOutput";

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

function normalizeOutputs(
  raw: NodeRun["outputs"] | NodeRun["inputs"]
): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // not JSON
    }
    return { text: raw };
  }
  return raw;
}

interface NodeDetailDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  nodeRun: NodeRun;
}

export function NodeDetailDialog({
  isOpen,
  onOpenChange,
  nodeRun,
}: NodeDetailDialogProps) {
  const config = useMemo(
    () => nodeRegistry.get(nodeRun.nodeType),
    [nodeRun.nodeType]
  );
  const displayName = config?.name ?? nodeRun.nodeType;

  const outputs = useMemo(() => normalizeOutputs(nodeRun.outputs), [nodeRun.outputs]);
  const inputs = useMemo(() => normalizeOutputs(nodeRun.inputs), [nodeRun.inputs]);

  // Sanitize inputs: strip any leaked output keys (e.g. result, result_text, result_model)
  // that older database runs may have stored into the inputs payload.
  const cleanInputs = useMemo(() => {
    if (!inputs) return {};
    return Object.fromEntries(
      Object.entries(inputs).filter(([key]) => !key.startsWith("result"))
    );
  }, [inputs]);

  const hasOutputs = outputs && Object.keys(outputs).length > 0;
  const hasInputs = cleanInputs && Object.keys(cleanInputs).length > 0;
  const hasError = !!nodeRun.error;

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* ── Overlay ──────────────────────────────────────── */}
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--overlay-bg)] backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200" />

        {/* ── Content ─────────────────────────────────────── */}
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-200 focus:outline-none">
          {/* ── Header ──────────────────────────────────────── */}
          <div className="flex items-center justify-between border-b border-[var(--separator)] px-5 py-3.5">
            <Dialog.Title className="text-sm font-semibold text-[var(--text-primary)] truncate pr-4">
              {displayName}
            </Dialog.Title>

            <Dialog.Close asChild>
              <button
                className="shrink-0 rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* ── Tabs Body ───────────────────────────────────── */}
          <Tabs.Root defaultValue="output" className="flex flex-col">
            <Tabs.List className="flex border-b border-[var(--separator)] px-5 gap-1">
              <Tabs.Trigger
                value="output"
                className="relative px-3 py-2 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] data-[state=active]:text-[var(--text-primary)] focus:outline-none after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--btn-primary-bg)] after:opacity-0 data-[state=active]:after:opacity-100 after:transition-opacity"
              >
                Output
              </Tabs.Trigger>

              <Tabs.Trigger
                value="input"
                className="relative px-3 py-2 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] data-[state=active]:text-[var(--text-primary)] focus:outline-none after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--btn-primary-bg)] after:opacity-0 data-[state=active]:after:opacity-100 after:transition-opacity"
              >
                Input
              </Tabs.Trigger>

              {hasError && (
                <Tabs.Trigger
                  value="error"
                  className="relative px-3 py-2 text-xs font-medium text-[var(--status-error-muted)] transition-colors hover:text-[var(--status-error)] data-[state=active]:text-[var(--status-error)] focus:outline-none after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--status-error)] after:opacity-0 data-[state=active]:after:opacity-100 after:transition-opacity"
                >
                  Error
                </Tabs.Trigger>
              )}
            </Tabs.List>

            {/* ── Tab: Output ──────────────────────────────── */}
            <Tabs.Content
              value="output"
              className="max-h-[50vh] overflow-y-auto px-5 py-4 node-scrollbar focus:outline-none"
            >
              {hasOutputs ? (
                <NodeOutput outputs={outputs} nodeType={nodeRun.nodeType} />
              ) : (
                <p className="text-xs text-[var(--text-muted)] italic">
                  No output data available for this node.
                </p>
              )}
            </Tabs.Content>

            {/* ── Tab: Input ───────────────────────────────── */}
            <Tabs.Content
              value="input"
              className="max-h-[50vh] overflow-y-auto px-5 py-4 node-scrollbar focus:outline-none"
            >
              {hasInputs ? (
                <NodeOutput outputs={cleanInputs} nodeType={nodeRun.nodeType} />
              ) : (
                <p className="text-xs text-[var(--text-muted)] italic">
                  No input data available for this node.
                </p>
              )}
            </Tabs.Content>

            {/* ── Tab: Error ───────────────────────────────── */}
            {hasError && (
              <Tabs.Content
                value="error"
                className="max-h-[50vh] overflow-y-auto px-5 py-4 node-scrollbar focus:outline-none"
              >
                <div className="rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-bg)] px-4 py-3">
                  <p className="text-xs font-medium text-[var(--status-error)] mb-1">
                    Error Details
                  </p>
                  <p className="text-xs text-[var(--status-error-muted)] leading-relaxed whitespace-pre-wrap break-words font-mono">
                    {nodeRun.error}
                  </p>
                </div>
              </Tabs.Content>
            )}
          </Tabs.Root>

          {/* ── Footer metadata ─────────────────────────────── */}
          {(nodeRun.durationMs != null || nodeRun.providerUsed || (nodeRun.creditsUsed ?? 0) > 0) && (
            <div className="flex items-center gap-3 border-t border-[var(--separator)] px-5 py-2.5">
              {nodeRun.durationMs != null && (
                <span className="text-[10px] tabular-nums text-[var(--text-muted)]">
                  Duration: {(nodeRun.durationMs / 1000).toFixed(1)}s
                </span>
              )}
              {nodeRun.providerUsed && (
                <span className="text-[10px] text-[var(--history-meta-color)] bg-[var(--badge-bg)] px-1.5 py-0.5 rounded">
                  {nodeRun.providerUsed}
                </span>
              )}
              {(nodeRun.creditsUsed ?? 0) > 0 && (
                <span className="text-[10px] font-mono tabular-nums text-[var(--history-meta-color)]">
                  {nodeRun.creditsUsed!.toLocaleString()} credits
                </span>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
