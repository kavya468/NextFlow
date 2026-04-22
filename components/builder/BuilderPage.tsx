"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { WorkflowCanvas } from "@/components/canvas/WorkflowCanvas";
import { LeftSidebar } from "@/components/sidebar-left/LeftSidebar";
import { RightSidebar } from "@/components/sidebar-right/RightSidebar";
import { useStore } from "@/lib/store";
import { CINEMATIC_TRAILER_TEMPLATE } from "@/lib/templates";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { CreditBadge } from "@/components/credits/CreditBadge";
import { useAutoSave } from "@/hooks/useAutoSave";
import { SaveStatusIndicator } from "@/components/canvas/SaveStatusIndicator";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export function BuilderPage({
  initialWorkflowId,
  initialName,
  initialNodes,
  initialEdges,
  loadTemplate: shouldLoadTemplate,
}: {
  initialWorkflowId?: string;
  initialName?: string;
  initialNodes?: any[];
  initialEdges?: any[];
  loadTemplate?: boolean;
}) {
  const nodes = useStore((state) => state.nodes);
  const edges = useStore((state) => state.edges);
  const setNodes = useStore((state) => state.setNodes);
  const setEdges = useStore((state) => state.setEdges);
  const takeSnapshot = useStore((state) => state.takeSnapshot);
  const isRightSidebarOpen = useStore((state) => state.isRightSidebarOpen);
  const setIsRightSidebarOpen = useStore((state) => state.setIsRightSidebarOpen);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [workflowId, setWorkflowId] = useState<string | undefined>(initialWorkflowId);
  const [workflowName, setWorkflowName] = useState(initialName || "Untitled");
  const [isEditing, setIsEditing] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const { saveStatus } = useAutoSave(workflowId);
  const updateNameMutation = trpc.workflow.update.useMutation();

  // Hydrate store with initial data (from DB or template)
  useEffect(() => {
    if (shouldLoadTemplate) {
      setNodes(CINEMATIC_TRAILER_TEMPLATE.nodes);
      setEdges(CINEMATIC_TRAILER_TEMPLATE.edges);
      setWorkflowName("Cinematic AI Trailer");
    } else if (initialNodes && initialEdges) {
      setNodes(initialNodes);
      setEdges(initialEdges);
    } else {
      setNodes([]);
      setEdges([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveMutation = trpc.workflow.save.useMutation();

  const handleNameClick = () => {
    setIsEditing(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  };

  const saveNameImmediately = useCallback(
    (name: string) => {
      const trimmed = name.trim() || "Untitled";
      setWorkflowName(trimmed);
      if (workflowId && workflowId !== "temp-visual-id") {
        updateNameMutation.mutate({ id: workflowId, name: trimmed });
      }
    },
    [workflowId, updateNameMutation]
  );

  const handleNameBlur = () => {
    setIsEditing(false);
    saveNameImmediately(workflowName);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      setIsEditing(false);
      saveNameImmediately(workflowName);
    }
    if (e.key === "Escape") {
      setIsEditing(false);
    }
  };

  // Initial save for brand-new workflows (no ID yet) — creates the DB record
  // so that auto-save has an ID to update against.
  const ensureWorkflowSaved = useCallback(async () => {
    if (workflowId) return;
    try {
      const cleanNodes = nodes.map((n) => ({
        id: n.id,
        type: n.type || "default",
        position: n.position,
        data: n.data,
      }));
      const cleanEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      }));

      const data = await saveMutation.mutateAsync({
        name: workflowName,
        nodes: cleanNodes,
        edges: cleanEdges,
      });

      if (data.workflowId) {
        setWorkflowId(data.workflowId);
        window.history.replaceState(null, "", `/workflow/${data.workflowId}`);
      }
    } catch {
      // will retry on next node/edge change
    }
  }, [workflowId, nodes, edges, workflowName, saveMutation]);

  // For new workflows, persist on first meaningful change
  useEffect(() => {
    if (!workflowId && nodes.length > 0) {
      ensureWorkflowSaved();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]);

  const loadTemplateAction = () => {
    takeSnapshot();
    setNodes(CINEMATIC_TRAILER_TEMPLATE.nodes);
    setEdges(CINEMATIC_TRAILER_TEMPLATE.edges);
    setWorkflowName("Cinematic AI Trailer");
  };

  const exportWorkflow = () => {
    const workflow = {
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle })),
    };
    const seen = new WeakSet();
    const blob = new Blob([
      JSON.stringify(workflow, (_, v) => {
        if (v && typeof v === "object") {
          if (seen.has(v)) return undefined;
          if (typeof (v as { nodeType?: number }).nodeType === "number") return undefined;
          try { seen.add(v); } catch { return undefined; }
        }
        return typeof v === "function" ? undefined : v;
      }, 2)
    ], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflowName || "nextflow-workflow"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importWorkflow = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const w = JSON.parse((ev.target?.result as string) || "{}");
        if (w.nodes && w.edges) {
          takeSnapshot();
          setNodes(w.nodes);
          setEdges(w.edges);
        }
      } catch {
        alert("Invalid workflow file.");
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[var(--canvas-bg)] text-[var(--text-primary)] overflow-hidden">
      <ReactFlowProvider>
        <main className="flex flex-1 w-full overflow-hidden relative">
          <LeftSidebar />

          <div className="flex-1 relative h-full w-full">
            {/* Top Left: Logo + Editable Name + Save */}
            <div className="absolute top-4 left-4 z-50 flex items-center gap-2">
              <Link
                href="/dashboard"
                className="flex items-center justify-center bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-lg p-2 shadow-sm hover:bg-[var(--sidebar-item-hover)] transition-colors"
              >
                <img src="/logo.png" alt="NextFlow Logo" className="w-5 h-5 rounded-[4px] shrink-0 object-cover" />
              </Link>
              <div className="flex items-center bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-lg px-3 py-2 shadow-sm font-medium text-sm text-[var(--text-primary)]">
                {isEditing ? (
                  <input
                    ref={nameInputRef}
                    value={workflowName}
                    onChange={(e) => setWorkflowName(e.target.value)}
                    onBlur={handleNameBlur}
                    onKeyDown={handleNameKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent text-[var(--text-primary)] text-sm font-medium outline-none border-b border-[var(--border-muted)] w-32"
                    autoFocus
                  />
                ) : (
                  <span
                    onClick={handleNameClick}
                    className="cursor-text hover:text-[var(--text-primary)] transition-colors"
                    title="Click to rename"
                  >
                    {workflowName}
                  </span>
                )}
              </div>

              <SaveStatusIndicator status={saveStatus} />
            </div>

            {/* Top Right Action Bar */}
            <input type="file" accept=".json" ref={fileInputRef} onChange={importWorkflow} className="hidden" />
            <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
              <ThemeToggle />
              <CreditBadge />
              <button
                onClick={loadTemplateAction}
                className="flex items-center gap-2 bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-lg px-3 py-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                Load Template
              </button>
              <button onClick={exportWorkflow} className="flex items-center gap-2 bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-lg px-3 py-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors" title="Export JSON">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Export
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-lg px-3 py-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors" title="Import JSON">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
                Import
              </button>

              <button onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)} className="flex items-center justify-center w-9 h-9 bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-item-hover)] transition-colors ml-2" title="Workflow History">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              </button>
            </div>

            <WorkflowCanvas />
          </div>

          <RightSidebar />
        </main>
      </ReactFlowProvider>
    </div>
  );
}
