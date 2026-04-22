/**
 * Returns a Set of target handle IDs that have an incoming edge for a given node.
 * Use this to disable manual input fields when a handle is connected upstream.
 */
export declare function useConnectedHandles(nodeId: string): Set<string>;
