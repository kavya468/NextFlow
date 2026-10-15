"use client";

import { ConnectionLineComponentProps, getBezierPath } from "@xyflow/react";
import { EDITOR_UI, editorEdgeGlow } from "@/lib/ui-config";
import { DataTypeColors, getIOTypeForHandle } from "@/lib/theme";

export function CustomConnectionLine({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
  toPosition,
  fromNode,
  fromHandle,
}: ConnectionLineComponentProps) {
  // React Flow's live connection coordinates already use measured handle centers.
  // Only completed edges need the outer-edge correction in DeletableEdge.
  const [edgePath] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });

  const handleId = fromHandle?.id;
  const nodeType = fromNode?.type || "";

  let strokeHex = DataTypeColors.image;
  if (handleId && nodeType) {
    const ioType = getIOTypeForHandle(nodeType, handleId, "output");
    if (ioType) {
      strokeHex = DataTypeColors[ioType];
    }
  }

  return (
    <g>
      <path
        fill="none"
        stroke={strokeHex}
        strokeWidth={2}
        strokeOpacity={EDITOR_UI.edge.strokeOpacity}
        d={edgePath}
        style={{ filter: editorEdgeGlow(strokeHex) }}
      />
    </g>
  );
}
