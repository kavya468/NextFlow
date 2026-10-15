"use client";

import { cn } from "@/lib/utils";
import { EDITOR_UI } from "@/lib/ui-config";
import type { SaveStatus } from "@/hooks/useAutoSave";

export function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  return (
    <span role="status" className={cn(
      "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md select-none",
      status === "saved" ? "text-[var(--status-success)]" : "text-[var(--text-secondary)]",
      (status === "error" || status === "conflict") && "text-[var(--status-error)]",
    )}>
      {status === "saving" && <span aria-hidden="true" className="inline-block w-1 h-1 rounded-full bg-[var(--status-pending)] animate-pulse" />}
      {EDITOR_UI.save.status[status]}
    </span>
  );
}
