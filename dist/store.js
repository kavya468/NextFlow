"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useStore = void 0;
const zustand_1 = require("zustand");
const react_1 = require("@xyflow/react");
const layout_1 = require("@/lib/layout");
const MAX_HISTORY = 50;
exports.useStore = (0, zustand_1.create)((set, get) => ({
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
        if (past.length === 0)
            return;
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
        if (future.length === 0)
            return;
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
    onNodesChange: (changes) => {
        // Take snapshot before deletions
        const hasRemoval = changes.some((c) => c.type === "remove");
        if (hasRemoval)
            get().takeSnapshot();
        set({ nodes: (0, react_1.applyNodeChanges)(changes, get().nodes) });
    },
    onEdgesChange: (changes) => {
        const hasRemoval = changes.some((c) => c.type === "remove");
        if (hasRemoval)
            get().takeSnapshot();
        set({ edges: (0, react_1.applyEdgeChanges)(changes, get().edges) });
    },
    onConnect: (connection) => {
        get().takeSnapshot();
        set({ edges: (0, react_1.addEdge)(connection, get().edges) });
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
        if (nodes.length === 0)
            return;
        get().takeSnapshot();
        set({ nodes: (0, layout_1.getLayoutedNodes)(nodes, edges) });
    },
    copySelection: () => {
        const { nodes, edges } = get();
        const selectedNodes = nodes.filter((n) => n.selected);
        if (selectedNodes.length === 0)
            return;
        const selectedIds = new Set(selectedNodes.map((n) => n.id));
        const connectedEdges = edges.filter((e) => selectedIds.has(e.source) && selectedIds.has(e.target));
        set({
            clipboard: {
                nodes: structuredClone(selectedNodes),
                edges: structuredClone(connectedEdges),
            },
        });
    },
    pasteSelection: () => {
        const { clipboard, nodes, edges } = get();
        if (clipboard.nodes.length === 0)
            return;
        get().takeSnapshot();
        const idMap = {};
        for (const node of clipboard.nodes) {
            idMap[node.id] = crypto.randomUUID();
        }
        const newNodes = clipboard.nodes.map((n) => ({
            ...structuredClone(n),
            id: idMap[n.id],
            position: { x: n.position.x + 50, y: n.position.y + 50 },
            selected: true,
        }));
        const newEdges = clipboard.edges.map((e) => ({
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
