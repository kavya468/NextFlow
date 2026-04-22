"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useConnectedHandles = useConnectedHandles;
const store_1 = require("@/lib/store");
const react_1 = require("react");
/**
 * Returns a Set of target handle IDs that have an incoming edge for a given node.
 * Use this to disable manual input fields when a handle is connected upstream.
 */
function useConnectedHandles(nodeId) {
    const edges = (0, store_1.useStore)((state) => state.edges);
    return (0, react_1.useMemo)(() => {
        const connected = new Set();
        for (const edge of edges) {
            if (edge.target === nodeId && edge.targetHandle) {
                connected.add(edge.targetHandle);
            }
        }
        return connected;
    }, [edges, nodeId]);
}
