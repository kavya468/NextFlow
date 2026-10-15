"use client";

import { useReactFlow, useNodesInitialized } from "@xyflow/react";
import { useEffect, useRef } from "react";
import { ZoomIn, ZoomOut, Maximize, LayoutGrid } from "lucide-react";
import { useStore } from "@/lib/store";
import { EDITOR_UI, editorMotionDuration, editorFitPadding } from "@/lib/ui-config";

export function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const initiallyFitted = useRef(false);
  useEffect(() => {
    if (!nodesInitialized || initiallyFitted.current) return;
    const frame = requestAnimationFrame(() => {
      initiallyFitted.current = true;
      void fitView({ padding: editorFitPadding() });
    });
    return () => cancelAnimationFrame(frame);
  }, [nodesInitialized, fitView]);
  const autoLayout = useStore((state) => state.autoLayout);

  return (
    <div role="group" aria-label={EDITOR_UI.labels.canvasControls} className="editor-view-controls flex items-center gap-1 p-1.5 bg-[var(--toolbar-bg)] border border-[var(--toolbar-border)] rounded-2xl shadow-2xl backdrop-blur-sm">
      <button
        type="button"
        onClick={() => zoomOut({ duration: editorMotionDuration(EDITOR_UI.motion.zoom) })}
        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-btn-hover)] rounded-xl transition-colors"
        title={EDITOR_UI.labels.zoomOut}
        aria-label={EDITOR_UI.labels.zoomOut}
      >
        <ZoomOut className="w-4 h-4" />
      </button>
      <div className="h-4 w-[1px] bg-[var(--toolbar-separator)] mx-0.5" />
      <button
        type="button"
        onClick={() => zoomIn({ duration: editorMotionDuration(EDITOR_UI.motion.zoom) })}
        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-btn-hover)] rounded-xl transition-colors"
        title={EDITOR_UI.labels.zoomIn}
        aria-label={EDITOR_UI.labels.zoomIn}
      >
        <ZoomIn className="w-4 h-4" />
      </button>
      <div className="h-4 w-[1px] bg-[var(--toolbar-separator)] mx-0.5" />
      <button
        type="button"
        onClick={() => fitView({ duration: editorMotionDuration(EDITOR_UI.motion.fit), padding: editorFitPadding() })}
        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-btn-hover)] rounded-xl transition-colors"
        title={EDITOR_UI.labels.fitView}
        aria-label={EDITOR_UI.labels.fitView}
      >
        <Maximize className="w-4 h-4" />
      </button>
      <div className="h-4 w-[1px] bg-[var(--toolbar-separator)] mx-0.5" />
      <button
        type="button"
        onClick={() => {
          autoLayout();
          setTimeout(() => fitView({ duration: editorMotionDuration(EDITOR_UI.motion.fit), padding: editorFitPadding() }), EDITOR_UI.motion.afterLayout);
        }}
        className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--toolbar-btn-hover)] rounded-xl transition-colors"
        title={EDITOR_UI.labels.autoArrange}
        aria-label={EDITOR_UI.labels.autoArrange}
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
    </div>
  );
}
