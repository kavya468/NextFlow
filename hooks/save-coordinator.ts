import type { Node, Edge } from "@xyflow/react";
import { EDITOR_UI } from "@/lib/ui-config";

export type WorkflowDocument = { name: string; nodes: Node[]; edges: Edge[] };
export type SavedWorkflow = WorkflowDocument & { id: string; revision: number };
export type SaveStatus = "saved" | "saving" | "unsaved" | "error" | "conflict";
export type SaveRequest = { document: WorkflowDocument; id?: string; expectedRevision?: number };
type SaveState = { status: SaveStatus; saved?: SavedWorkflow; error?: unknown };

/** Persist only graph data, not React Flow selection, measurements, or drag state. */
export function workflowDocument(name: string, nodes: Node[], edges: Edge[]): WorkflowDocument {
  return JSON.parse(JSON.stringify({
    name: name.trim() || EDITOR_UI.save.untitled,
    nodes: nodes.map(node => ({ id: node.id, type: node.type || "default", position: node.position, data: node.data })),
    edges: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle })),
  }));
}

const sameDocument = (a: WorkflowDocument, b: WorkflowDocument) => JSON.stringify(a) === JSON.stringify(b);
const documentOf = (saved: SavedWorkflow): WorkflowDocument => ({ name: saved.name, nodes: saved.nodes, edges: saved.edges });
function isConflict(error: unknown) {
  return !!error && typeof error === "object" && "data" in error && (error.data as { code?: string } | undefined)?.code === "CONFLICT";
}

/** One queue owns one editor session. A failed write never silently rebases a draft. */
export class SaveCoordinator {
  private draft: WorkflowDocument;
  private state: SaveState;
  private listeners = new Set<() => void>();
  private inFlight: Promise<SavedWorkflow> | undefined;
  private failedRequest: SaveRequest | undefined;
  private disposed = false;

  constructor(initial: WorkflowDocument, saved: SavedWorkflow | undefined, private write: (request: SaveRequest) => Promise<SavedWorkflow>) {
    this.draft = initial;
    this.state = { status: saved ? "saved" : "unsaved", saved };
  }
  getSnapshot = () => this.state;
  getDraft = () => this.draft;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { this.disposed = false; }
  dispose() { this.disposed = true; }
  private publish(state: SaveState) {
    this.state = state;
    if (!this.disposed) this.listeners.forEach(listener => listener());
  }
  setDraft(document: WorkflowDocument) {
    if (this.disposed || sameDocument(document, this.draft)) return;
    this.draft = document;
    if (this.state.status === "conflict" || this.state.status === "error" || this.inFlight) return;
    const saved = this.state.saved;
    this.publish({ saved, status: saved && sameDocument(document, documentOf(saved)) ? "saved" : "unsaved" });
  }
  markConflict(error: unknown) {
    this.publish({ saved: this.state.saved, status: "conflict", error });
  }
  reset(saved: SavedWorkflow) {
    if (this.inFlight) throw new Error("Wait for the current save before reloading.");
    this.draft = documentOf(saved);
    this.failedRequest = undefined;
    this.publish({ saved, status: "saved" });
  }
  retry() {
    if (this.state.status === "conflict") return Promise.reject(this.state.error);
    this.publish({ saved: this.state.saved, status: "unsaved" });
    return this.flush();
  }
  flush(): Promise<SavedWorkflow> {
    if (this.disposed) return Promise.reject(new Error("This editor session has closed."));
    if (this.inFlight) return this.inFlight;
    if (this.state.error) return Promise.reject(this.state.error);
    if (!this.failedRequest && this.state.saved && sameDocument(this.draft, documentOf(this.state.saved))) return Promise.resolve(this.state.saved);
    this.inFlight = this.drain().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
  private async drain(): Promise<SavedWorkflow> {
    while (!this.disposed) {
      const saved = this.state.saved;
      const request = this.failedRequest ?? { document: structuredClone(this.draft), id: saved?.id, expectedRevision: saved?.revision };
      this.publish({ saved, status: "saving" });
      let result: SavedWorkflow;
      try {
        result = await this.write(request);
      } catch (error) {
        this.failedRequest = request;
        this.publish({ saved, status: isConflict(error) ? "conflict" : "error", error });
        throw error;
      }
      if (this.disposed) throw new Error("This editor session has closed.");
      this.failedRequest = undefined;
      // Apply canonical labels only when the user has not edited during the write.
      if (sameDocument(this.draft, request.document)) this.draft = documentOf(result);
      const complete = sameDocument(this.draft, documentOf(result));
      this.publish({ saved: result, status: complete ? "saved" : "unsaved" });
      if (complete) return result;
    }
    throw new Error("This editor session has closed.");
  }
}
