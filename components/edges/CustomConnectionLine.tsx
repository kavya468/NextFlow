"use client";

import { ConnectionLineComponentProps, getBezierPath } from "@xyflow/react";
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
        strokeOpacity={0.7}
        d={edgePath}
        style={{ filter: `drop-shadow(0 0 4px ${strokeHex}40)` }}
      />
    </g>
  );
}
