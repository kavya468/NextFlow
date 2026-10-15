/** React Flow supplies a completed edge at the outer side of its handle box.
 * Move it to the visible port center using measured dimensions, in graph units.
 * Live connection-preview coordinates are already centered and must not use this.
 */
export function centerEdgeEndpoint(
  point: { x: number; y: number },
  position: "left" | "right" | "top" | "bottom",
  handle?: { width: number; height: number },
): { x: number; y: number } {
  if (!handle) return point;
  switch (position) {
    case "left": return { x: point.x + handle.width / 2, y: point.y };
    case "right": return { x: point.x - handle.width / 2, y: point.y };
    case "top": return { x: point.x, y: point.y + handle.height / 2 };
    case "bottom": return { x: point.x, y: point.y - handle.height / 2 };
  }
}
