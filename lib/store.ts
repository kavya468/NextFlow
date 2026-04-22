import { create } from "zustand";
import {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  addEdge,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
} from "@xyflow/react";
import { getLayoutedNodes } from "@/lib/layout";

export type AppNode = Node;
export type { Edge };

// Snapshot for undo/redo history
type Snapshot = { nodes: AppNode[]; edges: Edge[] };

const MAX_HISTORY = 50;

export type NodeRunStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

export type AppState = {
  nodes: AppNode[];
  edges: Edge[];
  runningNodeIds: string[];
  nodeRunStatuses: Record<string, NodeRunStatus>;
  isRightSidebarOpen: boolean;
  snapToGrid: boolean;

  // Clipboard
  clipboard: { nodes: AppNode[]; edges: Edge[] };

  // History
  past: Snapshot[];
  future: Snapshot[];

  // Actions
  onNodesChange: OnNodesChange<AppNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  setNodes: (nodes: AppNode[]) => void;
  setEdges: (edges: Edge[]) => void;
  setRunningNodeIds: (ids: string[]) => void;
  setNodeRunStatuses: (statuses: Record<string, NodeRunStatus>) => void;
  clearNodeRunStatuses: () => void;
  setIsRightSidebarOpen: (isOpen: boolean) => void;
  setSnapToGrid: (snap: boolean) => void;
  autoLayout: () => void;
  takeSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  copySelection: () => void;
  pasteSelection: () => void;
};

export const useStore = create<AppState>((set, get) => ({
  nodes: [],
  edges: [],
  runningNodeIds: [],
  nodeRunStatuses: {},
  isRightSidebarOpen: true,
  snapToGrid: true,
  clipboard: { nodes: [], edges: [] },
  past: [],
  future: [],

  // Save current state to history before a destructive action
  takeSnapshot: () => {
    const { nodes, edges, past } = get();
    set({
      past: [...past.slice(-MAX_HISTORY + 1), { nodes: structuredClone(nodes), edges: structuredClone(edges) }],
      future: [], // clear redo stack on new action
    });
  },

  undo: () => {
    const { past, nodes, edges } = get();
    if (past.length === 0) return;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, -1);

    set({
      nodes: previous.nodes,
      edges: previous.edges,
      past: newPast,
      future: [{ nodes: structuredClone(nodes), edges: structuredClone(edges) }, ...get().future],
    });
  },

  redo: () => {
    const { future, nodes, edges } = get();
    if (future.length === 0) return;

    const next = future[0];
    const newFuture = future.slice(1);

    set({
      nodes: next.nodes,
      edges: next.edges,
      future: newFuture,
      past: [...get().past, { nodes: structuredClone(nodes), edges: structuredClone(edges) }],
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  onNodesChange: (changes: NodeChange<AppNode>[]) => {
    // Take snapshot before deletions
    const hasRemoval = changes.some((c) => c.type === "remove");
    if (hasRemoval) get().takeSnapshot();

    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes: EdgeChange[]) => {
    const hasRemoval = changes.some((c) => c.type === "remove");
    if (hasRemoval) get().takeSnapshot();

    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  onConnect: (connection: Connection) => {
    get().takeSnapshot();
    set({ edges: addEdge(connection, get().edges) });
  },

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setRunningNodeIds: (ids) => set({ runningNodeIds: ids }),
  setNodeRunStatuses: (statuses) => set({ nodeRunStatuses: statuses }),
  clearNodeRunStatuses: () => set({ nodeRunStatuses: {} }),
  setIsRightSidebarOpen: (isOpen) => set({ isRightSidebarOpen: isOpen }),
  setSnapToGrid: (snap) => set({ snapToGrid: snap }),

  autoLayout: () => {
    const { nodes, edges } = get();
    if (nodes.length === 0) return;
    get().takeSnapshot();
    set({ nodes: getLayoutedNodes(nodes, edges) });
  },

  copySelection: () => {
    const { nodes, edges } = get();
    const selectedNodes = nodes.filter((n) => n.selected);
    if (selectedNodes.length === 0) return;

    const selectedIds = new Set(selectedNodes.map((n) => n.id));
    const connectedEdges = edges.filter(
      (e) => selectedIds.has(e.source) && selectedIds.has(e.target)
    );

    set({
      clipboard: {
        nodes: structuredClone(selectedNodes),
        edges: structuredClone(connectedEdges),
      },
    });
  },

  pasteSelection: () => {
    const { clipboard, nodes, edges } = get();
    if (clipboard.nodes.length === 0) return;

    get().takeSnapshot();

    const idMap: Record<string, string> = {};
    for (const node of clipboard.nodes) {
      idMap[node.id] = crypto.randomUUID();
    }

    const newNodes: AppNode[] = clipboard.nodes.map((n) => ({
      ...structuredClone(n),
      id: idMap[n.id],
      position: { x: n.position.x + 50, y: n.position.y + 50 },
      selected: true,
    }));

    const newEdges: Edge[] = clipboard.edges.map((e) => ({
      ...structuredClone(e),
      id: crypto.randomUUID(),
      source: idMap[e.source],
      target: idMap[e.target],
      selected: true,
    }));

    const deselectedNodes = nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
    const deselectedEdges = edges.map((e) => (e.selected ? { ...e, selected: false } : e));

    set({
      nodes: deselectedNodes.concat(newNodes),
      edges: deselectedEdges.concat(newEdges),
      clipboard: {
        nodes: newNodes.map((n) => ({ ...structuredClone(n), selected: false })),
        edges: newEdges.map((e) => ({ ...structuredClone(e), selected: false })),
      },
    });
  },
}));
