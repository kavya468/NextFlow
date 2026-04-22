"use client";

import { useState, useEffect, useRef } from "react";
import { useDebouncedCallback } from "use-debounce";
import { useStore } from "@/lib/store";
import { trpc } from "@/lib/trpc/client";

export type SaveStatus = "saved" | "saving" | "unsaved" | "error";

export function useAutoSave(workflowId: string | undefined) {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const update = trpc.workflow.update.useMutation();

  // Skip auto-save until we have a persisted workflow ID
  const canSave = !!workflowId && workflowId !== "temp-visual-id";

  // Track whether the initial hydration has completed so we don't
  // fire a save for the first render (store starts empty, then
  // BuilderPage sets initialNodes/initialEdges).
  const hydratedRef = useRef(false);
  const isFirstChangeRef = useRef(true);

  const debouncedSave = useDebouncedCallback(async () => {
    if (!canSave) return;
    setSaveStatus("saving");
    try {
      const currentNodes = useStore.getState().nodes;
      const currentEdges = useStore.getState().edges;

      const cleanNodes = currentNodes.map((n) => ({
        id: n.id,
        type: n.type || "default",
        position: n.position,
        data: n.data,
      }));
      const cleanEdges = currentEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      }));

      await update.mutateAsync({
        id: workflowId!,
        nodes: cleanNodes,
        edges: cleanEdges,
      });
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, 1500);

  useEffect(() => {
    // Ignore the very first render (empty store) and the hydration render
    if (!hydratedRef.current) {
      if (nodes.length > 0 || edges.length > 0) {
        hydratedRef.current = true;
      }
      return;
    }
    if (isFirstChangeRef.current) {
      isFirstChangeRef.current = false;
      return;
    }

    if (!canSave) return;

    setSaveStatus("unsaved");
    debouncedSave();
  }, [nodes, edges, canSave, debouncedSave]);

  // Ctrl+S / Cmd+S — flush the debounce immediately
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        debouncedSave.flush();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [debouncedSave]);

  return { saveStatus };
}
