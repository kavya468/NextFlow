"use client";

import { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react";
import { ReactFlowProvider, type Node, type Edge } from "@xyflow/react";
import { WorkflowCanvas } from "@/components/canvas/WorkflowCanvas";
import { LeftSidebar } from "@/components/sidebar-left/LeftSidebar";
import { RightSidebar } from "@/components/sidebar-right/RightSidebar";
import { useStore } from "@/lib/store";
import { CINEMATIC_TRAILER_TEMPLATE } from "@/lib/templates";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { CreditBadge } from "@/components/credits/CreditBadge";
import { useAutoSave } from "@/hooks/useAutoSave";
import { workflowDocument, type SavedWorkflow } from "@/hooks/save-coordinator";
import { SaveStatusIndicator } from "@/components/canvas/SaveStatusIndicator";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { EDITOR_UI } from "@/lib/ui-config";

export function BuilderPage({ initialWorkflowId, initialRevision = 0, initialName, initialNodes, initialEdges, loadTemplate: shouldLoadTemplate }: {
  initialWorkflowId?: string; initialRevision?: number; initialName?: string;
  initialNodes?: Node[]; initialEdges?: Edge[]; loadTemplate?: boolean;
}) {
  const nodes = useStore(state => state.nodes);
  const edges = useStore(state => state.edges);
  const setNodes = useStore(state => state.setNodes);
  const setEdges = useStore(state => state.setEdges);
  const takeSnapshot = useStore(state => state.takeSnapshot);
  const isRightSidebarOpen = useStore(state => state.isRightSidebarOpen);
  const setIsRightSidebarOpen = useStore(state => state.setIsRightSidebarOpen);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scope] = useState(() => crypto.randomUUID());
  // Freeze the loaded base for this keyed editor. Query refetches must not replace a local draft.
  const [initial] = useState(() => workflowDocument(
    shouldLoadTemplate ? "Cinematic AI Trailer" : initialName || EDITOR_UI.save.untitled,
    shouldLoadTemplate ? CINEMATIC_TRAILER_TEMPLATE.nodes : initialNodes || [],
    shouldLoadTemplate ? CINEMATIC_TRAILER_TEMPLATE.edges : initialEdges || [],
  ));
  const [initialSaved] = useState<SavedWorkflow | undefined>(() => initialWorkflowId ? { ...initial, id: initialWorkflowId, revision: initialRevision } : undefined);
  const [workflowName, setWorkflowName] = useState(initial.name);
  const [isEditing, setIsEditing] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameBeforeEditRef = useRef(initial.name);
  const utils = trpc.useUtils();

  useLayoutEffect(() => {
    useStore.getState().loadWorkflow(scope, initial.nodes, initial.edges);
    return () => useStore.getState().clearWorkflow(scope);
  }, [scope, initial]);
  const { saveStatus, saved, flush: ensureWorkflowSaved, retry, reset, markConflict } = useAutoSave(scope, workflowName, initial, initialSaved);
  const workflowId = saved?.id;
  const onWorkflowResolved = useCallback((id: string) => {
    if (useStore.getState().workflowScope !== scope) return;
    if (window.location.pathname !== `/workflow/${id}`) window.history.replaceState(null, "", `/workflow/${id}`);
  }, [scope]);
  useEffect(() => { if (workflowId) onWorkflowResolved(workflowId); }, [workflowId, onWorkflowResolved]);

  const handleNameClick = () => { nameBeforeEditRef.current = workflowName; setIsEditing(true); };
  useEffect(() => { if (isEditing) nameInputRef.current?.select(); }, [isEditing]);
  const handleNameBlur = () => { setIsEditing(false); setWorkflowName(name => name.trim() || EDITOR_UI.save.untitled); };
  const handleNameKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") handleNameBlur();
    if (event.key === "Escape") { setWorkflowName(nameBeforeEditRef.current); setIsEditing(false); }
  };
  const reloadSaved = async () => {
    if (!workflowId || !window.confirm(EDITOR_UI.save.reloadConfirm)) return;
    try {
      const result = await utils.client.workflow.load.query({ id: workflowId });
      if (!result || useStore.getState().workflowScope !== scope) return;
      const next = { id: result.id, revision: result.revision, ...workflowDocument(result.name, result.nodes as unknown as Node[], result.edges as unknown as Edge[]) };
      reset(next);
      setWorkflowName(next.name);
      useStore.getState().loadWorkflow(scope, next.nodes, next.edges);
    } catch { toast.error(EDITOR_UI.save.reloadError); }
  };

  const loadTemplateAction = () => {
    takeSnapshot();
    setNodes(CINEMATIC_TRAILER_TEMPLATE.nodes);
    setEdges(CINEMATIC_TRAILER_TEMPLATE.edges);
    setWorkflowName("Cinematic AI Trailer");
  };

  const exportWorkflow = () => {
    const workflow = {
      name: workflowName,
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
      if (useStore.getState().workflowScope !== scope) return;
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
    <div className="flex flex-col h-screen w-full bg-[var(--canvas-bg)] text-[var(--text-primary)] overflow-hidden" onClickCapture={event => {
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor || anchor.target === "_blank" || event.metaKey || event.ctrlKey || event.shiftKey || saveStatus === "saved") return;
      if (!window.confirm(EDITOR_UI.save.leaveConfirm)) { event.preventDefault(); event.stopPropagation(); }
    }}>
      <ReactFlowProvider>
        <main className="editor-layout flex flex-1 w-full overflow-hidden relative">
          <LeftSidebar />

          <div className="editor-workspace">
            <header className="editor-titlebar">
              {/* One wrapping layout keeps title and actions from colliding. */}
              <div className="editor-identity">
                <Link
                  href="/dashboard"
                  aria-label={EDITOR_UI.labels.dashboard}
                  className="flex items-center justify-center bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-lg p-2 shadow-sm hover:bg-[var(--sidebar-item-hover)] transition-colors"
                >
                  <img src="/logo.png" alt="NextFlow Logo" className="w-5 h-5 rounded-[4px] shrink-0 object-cover" />
                </Link>
                <div className="editor-name-surface flex items-center bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-lg px-3 py-2 shadow-sm font-medium text-sm text-[var(--text-primary)]">
                  {isEditing ? (
                    <input
                      ref={nameInputRef}
                      aria-label={EDITOR_UI.labels.workflowName}
                      maxLength={100}
                      name="workflowName"
                      autoComplete="off"
                      value={workflowName}
                      onChange={(e) => setWorkflowName(e.target.value)}
                      onBlur={handleNameBlur}
                      onKeyDown={handleNameKeyDown}
                      onClick={(e) => e.stopPropagation()}
                      className="editor-name-input bg-transparent text-[var(--text-primary)] text-sm font-medium border-b border-[var(--node-border)]"
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      aria-label={`${EDITOR_UI.labels.rename}: ${workflowName}`}
                      onClick={handleNameClick}
                      className="editor-name-button cursor-text hover:text-[var(--text-primary)] transition-colors"
                      title={EDITOR_UI.labels.rename}
                    >
                      {workflowName}
                    </button>
                  )}
                </div>

                <SaveStatusIndicator status={saveStatus} />
              </div>

              {/* Top Right Action Bar */}
              <input type="file" accept=".json" ref={fileInputRef} onChange={importWorkflow} className="hidden" />
              <div className="editor-actions">
                <ThemeToggle />
                <CreditBadge />
                <button
                  type="button"
                  aria-label={EDITOR_UI.labels.loadTemplate}
                  onClick={loadTemplateAction}
                  className="flex items-center gap-2 bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-lg px-3 py-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                  <span className="editor-action-label">Load Template</span>
                </button>
                <button type="button" aria-label={EDITOR_UI.labels.exportWorkflow} onClick={exportWorkflow} className="flex items-center gap-2 bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-lg px-3 py-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors" title="Export JSON">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  <span className="editor-action-label">Export</span>
                </button>
                <button type="button" aria-label={EDITOR_UI.labels.importWorkflow} onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-lg px-3 py-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors" title="Import JSON">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
                  <span className="editor-action-label">Import</span>
                </button>

                <button type="button" id={EDITOR_UI.ids.historyToggle} aria-label={EDITOR_UI.labels.history} aria-controls={EDITOR_UI.ids.history} aria-expanded={isRightSidebarOpen} onClick={() => setIsRightSidebarOpen(!isRightSidebarOpen)} className="flex items-center justify-center w-9 h-9 bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-item-hover)] transition-colors" title={EDITOR_UI.labels.history}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                </button>
              </div>
            </header>

            {(saveStatus === "conflict" || saveStatus === "error") && (
              <section className="editor-save-recovery" aria-label={EDITOR_UI.save.status[saveStatus]}>
                <p role="status">{EDITOR_UI.save[saveStatus]}</p>
                <div className="editor-save-recovery-actions">
                  <button type="button" onClick={exportWorkflow}>{EDITOR_UI.save.export}</button>
                  {saveStatus === "error" && <button type="button" onClick={() => { void retry().catch(() => {}); }}>{EDITOR_UI.save.retry}</button>}
                  {workflowId && <button type="button" onClick={() => { void reloadSaved(); }}>{EDITOR_UI.save.reload}</button>}
                </div>
              </section>
            )}
            <WorkflowCanvas workflowScope={scope} workflowId={workflowId} prepareWorkflow={ensureWorkflowSaved} onSaveConflict={markConflict} onWorkflowResolved={onWorkflowResolved} />
          </div>

          <RightSidebar key={workflowId || scope} workflowId={workflowId} />
        </main>
      </ReactFlowProvider>
    </div>
  );
}
