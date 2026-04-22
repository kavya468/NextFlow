"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SaveStatus } from "@/hooks/useAutoSave";

export function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  // After "saved" shows for 2s, fade to 40% opacity via CSS transition.
  // We track a separate flag so the transition is pure CSS, not setTimeout→setState.
  const [recentlySaved, setRecentlySaved] = useState(false);

  useEffect(() => {
    if (status === "saved") {
      setRecentlySaved(true);
      const id = setTimeout(() => setRecentlySaved(false), 2000);
      return () => clearTimeout(id);
    }
    setRecentlySaved(false);
  }, [status]);

  if (status === "unsaved") return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md select-none transition-opacity duration-500",
        status === "saved" && "text-[var(--status-success)]/90",
        status === "saved" && !recentlySaved && "opacity-40",
        status === "saving" && "text-[var(--text-secondary)]",
        status === "error" && "text-[var(--status-error)]",
      )}
    >
      {status === "saved" && "✓ Saved"}
      {status === "saving" && (
        <>
          <span className="inline-block w-1 h-1 rounded-full bg-[var(--status-pending)] animate-pulse" />
          Saving…
        </>
      )}
      {status === "error" && "⚠ Save failed"}
    </span>
  );
}
