import { useStore } from '@/lib/store';
import { useMemo } from 'react';

/**
 * Returns a Set of target handle IDs that have an incoming edge for a given node.
 * Use this to disable manual input fields when a handle is connected upstream.
 */
export function useConnectedHandles(nodeId: string): Set<string> {
  const edges = useStore((state) => state.edges);

  return useMemo(() => {
    const connected = new Set<string>();
    for (const edge of edges) {
      if (edge.target === nodeId && edge.targetHandle) {
        connected.add(edge.targetHandle);
      }
    }
    return connected;
  }, [edges, nodeId]);
}
