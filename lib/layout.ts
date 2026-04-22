import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

const DEFAULT_WIDTH = 250;
const DEFAULT_HEIGHT = 100;

export function getLayoutedNodes(
  nodes: Node[],
  edges: Edge[],
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", align: "UL", ranksep: 80, nodesep: 50 });

  for (const node of nodes) {
    const w = node.measured?.width ?? DEFAULT_WIDTH;
    const h = node.measured?.height ?? DEFAULT_HEIGHT;
    g.setNode(node.id, { width: w, height: h });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const w = node.measured?.width ?? DEFAULT_WIDTH;
    const h = node.measured?.height ?? DEFAULT_HEIGHT;
    return {
      ...node,
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
    };
  });
}
