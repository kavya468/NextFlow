"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLayoutedNodes = getLayoutedNodes;
const dagre_1 = __importDefault(require("dagre"));
const DEFAULT_WIDTH = 250;
const DEFAULT_HEIGHT = 100;
function getLayoutedNodes(nodes, edges) {
    const g = new dagre_1.default.graphlib.Graph();
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
    dagre_1.default.layout(g);
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
