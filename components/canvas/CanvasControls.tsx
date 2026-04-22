"use client";

import { useReactFlow } from "@xyflow/react";
import { ZoomIn, ZoomOut, Maximize, LayoutGrid } from "lucide-react";
import { useStore } from "@/lib/store";

export function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const autoLayout = useStore((state) => state.autoLayout);

  return (
    <div className="absolute bottom-6 left-6 z-[60] flex items-center gap-1 p-1.5 bg-[var(--toolbar-bg)] border border-[var(--toolbar-border)] rounded-2xl shadow-2xl backdrop-blur-sm">
      <button
        onClick={() => zoomOut({ duration: 300 })}
        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-btn-hover)] rounded-xl transition-all"
        title="Zoom Out"
      >
        <ZoomOut className="w-4 h-4" />
      </button>
      <div className="h-4 w-[1px] bg-[var(--toolbar-separator)] mx-0.5" />
      <button
        onClick={() => zoomIn({ duration: 300 })}
        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-btn-hover)] rounded-xl transition-all"
        title="Zoom In"
      >
        <ZoomIn className="w-4 h-4" />
      </button>
      <div className="h-4 w-[1px] bg-[var(--toolbar-separator)] mx-0.5" />
      <button
        onClick={() => fitView({ duration: 500, padding: 0.2 })}
        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-btn-hover)] rounded-xl transition-all"
        title="Fit View"
      >
        <Maximize className="w-4 h-4" />
      </button>
      <div className="h-4 w-[1px] bg-[var(--toolbar-separator)] mx-0.5" />
      <button
        onClick={() => {
          autoLayout();
          setTimeout(() => fitView({ duration: 500, padding: 0.2 }), 50);
        }}
        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-btn-hover)] rounded-xl transition-all"
        title="Auto-arrange all nodes"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
    </div>
  );
}
