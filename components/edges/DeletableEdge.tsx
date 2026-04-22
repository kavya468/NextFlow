"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath } from "@xyflow/react";
import { useStore } from "@/lib/store";
import { X } from "lucide-react";
import { DataTypeColors, getIOTypeForHandle } from "@/lib/theme";
import type { IOType } from "@/lib/nodes/types";

export function DeletableEdge({
  id,
  source,
  sourceHandleId,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: any) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
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
    strokeOpacity: 0.7,
    filter: `drop-shadow(0 0 4px ${strokeHex}40)`,
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
            title="Delete connection"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
