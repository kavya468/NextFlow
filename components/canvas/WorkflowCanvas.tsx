"use client";

import { useCallback, useState, useEffect } from "react";
import {
  ReactFlow,
  MiniMap,
  Background,
  Connection,
  Edge,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStore } from "@/lib/store";
import { useRef } from "react";

// ---------- Config-Driven Node System ----------
import { GenericNode } from "@/components/nodes/GenericNode";
import { NoteNode } from "@/components/nodes/NoteNode";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs"; // side-effect: registers all configs
import { getIOTypeForHandle } from "@/lib/theme";

// ---------- Legacy nodes (will be ported to configs incrementally) ----------
// All initial nodes are now ported. Future unported nodes go here.

import { CanvasControls } from "./CanvasControls";
import { ExecutionControls, type ExecutionControlsProps } from "@/components/canvas/ExecutionControls";
import { DeletableEdge } from "@/components/edges/DeletableEdge";
import { CustomConnectionLine } from "@/components/edges/CustomConnectionLine";
import { EDITOR_UI } from "@/lib/ui-config";
import { showConnectionError } from "@/lib/connection-toasts";

// ─────────────────────────────────────────────────────────────────────────────
// nodeTypes — React Flow requires this object to be STABLE (defined outside
// the component) to avoid infinite re-renders.
//
// Config-driven nodes use GenericNode. Legacy nodes keep their old components
// until each is ported to a config file in lib/nodes/configs/.
// ─────────────────────────────────────────────────────────────────────────────
const nodeTypes: NodeTypes = {
  // ── Config-driven (rendered by GenericNode) ──
  crop: GenericNode,
  text: GenericNode,
  image: GenericNode,
  video: GenericNode,
  llm: GenericNode,
  "openrouter-llm": GenericNode,
  extract: GenericNode,
  "extract-audio": GenericNode,
  "merge-audio-video": GenericNode,
  "merge-videos": GenericNode,
  "seedream-4.5": GenericNode,
  "elevenlabs-tts": GenericNode,
  "kling-01": GenericNode,
  "sync-lipsync": GenericNode,
  "seedance-1.5": GenericNode,

  // ── Visual-only (no handles, no execution) ──
  note: NoteNode,
};

const edgeTypes = {
  deletable: DeletableEdge,
};

const SNAP_GRID: [number, number] = [20, 20];

function wouldCreateCycle(edges: Edge[], connection: Connection): boolean {
  const visited = new Set<string>();
  const stack = [connection.target];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === connection.source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const e of edges) {
      if (e.source === current) stack.push(e.target);
    }
  }
  return false;
}

function Flow(props: ExecutionControlsProps) {
  const nodes = useStore((state) => state.nodes);
  const edges = useStore((state) => state.edges);
  const onNodesChange = useStore((state) => state.onNodesChange);
  const onEdgesChange = useStore((state) => state.onEdgesChange);
  const storeOnConnect = useStore((state) => state.onConnect);
  const setNodes = useStore((state) => state.setNodes);
  const setEdges = useStore((state) => state.setEdges);
  const snapToGrid = useStore((state) => state.snapToGrid);
  
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getNode } = useReactFlow();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: Node } | null>(null);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  // Canvas keyboard shortcuts (undo/redo, copy/paste)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

      if (!(e.metaKey || e.ctrlKey)) return;

      switch (e.key) {
        case "z":
          e.preventDefault();
          if (e.shiftKey) { useStore.getState().redo(); } else { useStore.getState().undo(); }
          break;
        case "c":
          e.preventDefault();
          useStore.getState().copySelection();
          break;
        case "v":
          e.preventDefault();
          useStore.getState().pasteSelection();
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      // ── Cycle detection (DFS from target → source via existing edges) ──
      if (wouldCreateCycle(edges, connection)) {
        showConnectionError("cycle");
        return;
      }

      storeOnConnect(connection);

      // Annotate the newly-created edge with the source handle's IOType
      // so DeletableEdge can color the stroke without a registry lookup.
      const sourceNode = getNode(connection.source);
      const sourceType = sourceNode?.type || "";
      const sourceHandle = connection.sourceHandle || "";
      const ioType = getIOTypeForHandle(sourceType, sourceHandle, "output");

      if (ioType) {
        const currentEdges = useStore.getState().edges;
        const updatedEdges = currentEdges.map((e) => {
          if (
            e.source === connection.source &&
            e.target === connection.target &&
            e.sourceHandle === connection.sourceHandle &&
            e.targetHandle === connection.targetHandle
          ) {
            return { ...e, data: { ...e.data, sourceType: ioType } };
          }
          return e;
        });
        setEdges(updatedEdges);
      }
    },
    [storeOnConnect, getNode, setEdges, edges]
  );

  const onNodeContextMenu = useCallback((_: React.MouseEvent, node: Node) => {
    setContextMenu({ x: _.clientX, y: _.clientY, node });
  }, []);

  const runThisNode = useCallback(() => {
    if (contextMenu) {
      window.dispatchEvent(new CustomEvent("nextflow:run-nodes", { detail: { nodeIds: [contextMenu.node.id] } }));
      setContextMenu(null);
    }
  }, [contextMenu]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const sourceNode = getNode(connection.source);
      const targetNode = getNode(connection.target);

      if (!sourceNode || !targetNode) return false;
      if (sourceNode.id === targetNode.id) return false;
      if (sourceNode.type === "note" || targetNode.type === "note") return false;

      const sourceNodeType = sourceNode.type || "";
      const targetNodeType = targetNode.type || "";
      const sourceHandle = connection.sourceHandle || "";
      const targetHandle = connection.targetHandle || "";

      if (!nodeRegistry.has(sourceNodeType) || !nodeRegistry.has(targetNodeType)) {
        return false;
      }

      const valid = nodeRegistry.isValidConnection(sourceNodeType, sourceHandle, targetNodeType, targetHandle);
      if (!valid) {
        const sourceType = getIOTypeForHandle(sourceNodeType, sourceHandle, "output");
        const targetType = getIOTypeForHandle(targetNodeType, targetHandle, "input");
        if (sourceType && targetType) showConnectionError("type_mismatch", sourceType, targetType);
        return false;
      }

      return true;
    },
    [getNode]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (typeof type === 'undefined' || !type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode = {
        id: crypto.randomUUID(),
        type,
        position,
        data: type === "note" ? { text: "New Note..." } : {},
      };

      useStore.getState().takeSnapshot();
      setNodes(nodes.concat(newNode));
    },
    [screenToFlowPosition, nodes, setNodes]
  );

  return (
    <div className="editor-canvas flex-1 min-h-0 w-full bg-[var(--canvas-bg)] relative" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeContextMenu={onNodeContextMenu}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={{ 
          type: "deletable",
          animated: true, 
          style: { strokeWidth: 2, strokeOpacity: EDITOR_UI.edge.strokeOpacity },
          interactionWidth: 20,
        }}
        connectionLineComponent={CustomConnectionLine}
        deleteKeyCode={['Backspace', 'Delete']}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        snapToGrid={snapToGrid}
        snapGrid={SNAP_GRID}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background 
          variant={BackgroundVariant.Dots} 
          gap={32} 
          size={1.2} 
          color="var(--canvas-dots)" 
        />
        <MiniMap 
          nodeColor="var(--rf-minimap-node)" 
          maskColor="var(--rf-minimap-mask)" 
          className="!bg-[var(--panel-bg)] !border !border-[var(--panel-border)] !rounded-lg overflow-hidden" 
        />
      </ReactFlow>

      {/* Node context menu */}
      {contextMenu && (
        <div
          className="fixed z-[100] min-w-[160px] py-1 bg-[var(--context-menu-bg)] border border-[var(--context-menu-border)] rounded-lg shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={runThisNode}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--context-menu-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 3l14 9-14 9V3z"></path></svg>
            Run this node
          </button>
        </div>
      )}
      
      <div id={EDITOR_UI.ids.controlDock} className="editor-control-dock">
        <CanvasControls />
        <ExecutionControls {...props} />
      </div>
    </div>
  );
}

export function WorkflowCanvas(props: ExecutionControlsProps) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
