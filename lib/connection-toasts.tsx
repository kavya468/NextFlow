import { toast } from "sonner";
import { DataTypeColors } from "@/lib/theme";
import type { IOType } from "@/lib/nodes/types";

// ── Spam guard — max 1 toast per second ─────────────────────────────────
let lastToastAt = 0;
const TOAST_THROTTLE_MS = 1000;

function TypeDot({ type }: { type?: string }) {
  const color =
    DataTypeColors[type as IOType] ?? "#6B7280";
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: color }}
    />
  );
}

export function showConnectionError(
  type: "type_mismatch" | "cycle",
  sourceType?: string,
  targetType?: string
) {
  if (Date.now() - lastToastAt < TOAST_THROTTLE_MS) return;
  lastToastAt = Date.now();

  if (type === "type_mismatch") {
    toast.error("Incompatible types", {
      description: (
        <span className="flex items-center gap-1.5 text-sm">
          <TypeDot type={sourceType} />
          <span className="font-mono text-xs">{sourceType}</span>
          <span className="text-muted-foreground">→</span>
          <TypeDot type={targetType} />
          <span className="font-mono text-xs">{targetType}</span>
        </span>
      ),
      duration: 3000,
    });
  }

  if (type === "cycle") {
    toast.error("Cycle detected", {
      description:
        "Workflows must flow in one direction. This connection would create a loop.",
      duration: 3000,
    });
  }
}
