"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useSyncExternalStore } from "react";
import { useStore } from "@/lib/store";
import { trpc } from "@/lib/trpc/client";
import { EDITOR_UI } from "@/lib/ui-config";
import { SaveCoordinator, workflowDocument, type SavedWorkflow, type WorkflowDocument } from "./save-coordinator";
export type { SaveStatus } from "./save-coordinator";

export function useAutoSave(scope: string, name: string, initial: WorkflowDocument, initialSaved?: SavedWorkflow) {
  const utils = trpc.useUtils();
  const nameRef = useRef(name);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [creationId] = useState(() => crypto.randomUUID());
  const [coordinator] = useState(() => new SaveCoordinator(initial, initialSaved, async request => {
    const payload = { name: request.document.name, nodes: request.document.nodes.map(node => ({ ...node, type: node.type || "default" })), edges: request.document.edges };
    const response = request.id
      ? await utils.client.workflow.update.mutate({ id: request.id, expectedRevision: request.expectedRevision!, ...payload })
      : (await utils.client.workflow.save.mutate({ creationId, ...payload })).workflow;
    const saved = { id: response.id, revision: response.revision, ...workflowDocument(response.name, response.nodes as unknown as WorkflowDocument["nodes"], response.edges as unknown as WorkflowDocument["edges"]) };
    const state = useStore.getState();
    if (state.workflowScope === scope && JSON.stringify(workflowDocument(request.document.name, state.nodes, state.edges)) === JSON.stringify(request.document)) {
      // Preserve React Flow measurements/selection while adopting canonical saved labels.
      const byId = new Map(saved.nodes.map(node => [node.id, node]));
      if (JSON.stringify(request.document.nodes) !== JSON.stringify(saved.nodes)) state.setNodes(state.nodes.map(node => ({ ...node, ...byId.get(node.id) })));
    }
    return saved;
  }));
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);

  const capture = useCallback(() => {
    const current = useStore.getState();
    if (current.workflowScope !== scope) return;
    coordinator.setDraft(workflowDocument(nameRef.current, current.nodes, current.edges));
  }, [coordinator, scope]);
  const schedule = useCallback(() => {
    capture();
    clearTimeout(timerRef.current);
    const current = coordinator.getSnapshot();
    if (current.status !== "unsaved" || (!current.saved && coordinator.getDraft().nodes.length === 0)) return;
    timerRef.current = setTimeout(() => { void coordinator.flush().catch(() => { /* Recovery stays visible in the editor. */ }); }, EDITOR_UI.save.debounceMs);
  }, [capture, coordinator]);
  useLayoutEffect(() => { nameRef.current = name; schedule(); }, [name, schedule]);

  useEffect(() => {
    coordinator.activate();
    schedule();
    const unsubscribe = useStore.subscribe((next, previous) => {
      if (next.workflowScope === scope && (next.nodes !== previous.nodes || next.edges !== previous.edges)) schedule();
    });
    return () => { clearTimeout(timerRef.current); unsubscribe(); coordinator.dispose(); };
  }, [coordinator, schedule, scope]);

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    capture();
    return coordinator.flush();
  }, [capture, coordinator]);
  const retry = useCallback(() => { capture(); return coordinator.retry(); }, [capture, coordinator]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush().catch(() => {});
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (coordinator.getSnapshot().status !== "saved") { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("keydown", keydown); window.removeEventListener("beforeunload", beforeUnload); };
  }, [coordinator, flush]);

  const markConflict = useCallback((error: unknown) => coordinator.markConflict(error), [coordinator]);
  const reset = useCallback((saved: SavedWorkflow) => { nameRef.current = saved.name; coordinator.reset(saved); }, [coordinator]);
  return { saveStatus: state.status, saved: state.saved, flush, retry, markConflict, reset };
}
