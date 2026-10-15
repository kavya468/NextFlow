"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, useInternalNode, type EdgeProps } from "@xyflow/react";
import { centerEdgeEndpoint } from "@/lib/edge-geometry";
import { EDITOR_UI, editorEdgeGlow } from "@/lib/ui-config";
import { useStore } from "@/lib/store";
import { X } from "lucide-react";
import { DataTypeColors, getIOTypeForHandle } from "@/lib/theme";
import type { IOType } from "@/lib/nodes/types";

export function DeletableEdge({
  id,
  source,
  sourceHandleId,
  target,
  targetHandleId,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const sourceInternal = useInternalNode(source);
  const targetInternal = useInternalNode(target);
  const sourceHandles = sourceInternal?.internals.handleBounds?.source ?? [];
  const targetHandles = [...(targetInternal?.internals.handleBounds?.target ?? []), ...(targetInternal?.internals.handleBounds?.source ?? [])];
  const sourceHandle = sourceHandleId ? sourceHandles.find(handle => handle.id === sourceHandleId) : sourceHandles[0];
  const targetHandle = targetHandleId ? targetHandles.find(handle => handle.id === targetHandleId) : targetHandles[0];
  const sourceCenter = centerEdgeEndpoint({ x: sourceX, y: sourceY }, sourcePosition, sourceHandle);
  const targetCenter = centerEdgeEndpoint({ x: targetX, y: targetY }, targetPosition, targetHandle);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: sourceCenter.x,
    sourceY: sourceCenter.y,
    sourcePosition,
    targetX: targetCenter.x,
    targetY: targetCenter.y,
    targetPosition,
  });

  const edges = useStore((state) => state.edges);
  const nodes = useStore((state) => state.nodes);
  const setEdges = useStore((state) => state.setEdges);
  const takeSnapshot = useStore((state) => state.takeSnapshot);

  const onEdgeClick = (evt: React.MouseEvent) => {
    evt.stopPropagation();
    takeSnapshot();
    setEdges(edges.filter((e) => e.id !== id));
  };

  const sourceNode = nodes.find((n) => n.id === source);
  const sourceType = sourceNode?.type || "";

  // Resolve color from edge data first (set at connect time),
  // fall back to runtime registry lookup
  let ioType: IOType | null =
    (data?.sourceType as IOType) ?? null;
  if (!ioType && sourceHandleId && sourceType) {
    ioType = getIOTypeForHandle(sourceType, sourceHandleId, "output");
  }

  const strokeHex = ioType
    ? DataTypeColors[ioType]
    : DataTypeColors.image;

  const customizedStyle = {
    ...style,
    stroke: strokeHex,
    strokeOpacity: EDITOR_UI.edge.strokeOpacity,
    filter: editorEdgeGlow(strokeHex),
  };

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={customizedStyle} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          <button
            className="w-5 h-5 flex items-center justify-center bg-[var(--rf-controls-bg)] border border-[var(--rf-controls-border)] rounded-full text-[var(--text-muted)] hover:text-[var(--status-error)] hover:border-[var(--status-error-border)] hover:bg-[var(--btn-danger-hover)] shadow-lg cursor-pointer transition-colors"
            onClick={onEdgeClick}
            type="button"
            aria-label={EDITOR_UI.labels.deleteConnection}
            title={EDITOR_UI.labels.deleteConnection}
          >
            <X aria-hidden="true" className="w-3 h-3" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
