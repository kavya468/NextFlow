"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  workflowName: string;
  currentDescription?: string | null;
}

const CATEGORIES = [
  { value: "image", label: "Image", emoji: "🖼" },
  { value: "video", label: "Video", emoji: "🎬" },
  { value: "audio", label: "Audio", emoji: "🎵" },
  { value: "text", label: "Text", emoji: "📝" },
] as const;

export function PublishDialog({
  open,
  onOpenChange,
  workflowId,
  workflowName,
  currentDescription,
}: PublishDialogProps) {
  const [category, setCategory] = useState<string>("image");
  const [description, setDescription] = useState(currentDescription ?? "");
  const [thumbnail, setThumbnail] = useState("");

  const publishMutation = trpc.workflow.publish.useMutation();

  const handlePublish = async () => {
    try {
      await publishMutation.mutateAsync({
        id: workflowId,
        category: category as any,
        description: description || undefined,
        thumbnail: thumbnail || undefined,
      });

      toast.success("Published to gallery!", {
        description: `"${workflowName}" is now available in the Template Gallery.`,
      });

      onOpenChange(false);
    } catch (err: any) {
      toast.error("Failed to publish", {
        description: err.message || "Something went wrong",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[var(--popover-bg)] border-[var(--separator)]">
        <DialogHeader>
          <DialogTitle className="text-[var(--text-primary)]">
            Publish to Gallery
          </DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            Share &ldquo;{workflowName}&rdquo; with the community. Others can run it with their own inputs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Category Selection */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">
              Category <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(cat.value)}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-xs font-medium transition-all duration-200 ${
                    category === cat.value
                      ? "bg-violet-500/15 border-violet-500/30 text-violet-400"
                      : "bg-[var(--node-inner-bg)] border-[var(--node-inner-border)] text-[var(--text-muted)] hover:border-[var(--node-inner-border-hover)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  <span className="text-base">{cat.emoji}</span>
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this workflow does…"
              rows={3}
              className="w-full bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] focus:outline-none focus:border-zinc-500 transition-colors resize-none"
            />
          </div>

          {/* Thumbnail URL */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Thumbnail URL
              <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)]">
                (optional)
              </span>
            </label>
            <input
              type="text"
              value={thumbnail}
              onChange={(e) => setThumbnail(e.target.value)}
              placeholder="https://example.com/thumbnail.jpg"
              className="w-full bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] focus:outline-none focus:border-zinc-500 transition-colors"
            />
            {thumbnail && (
              <div className="mt-2 rounded-lg overflow-hidden border border-[var(--node-inner-border)]">
                <img
                  src={thumbnail}
                  alt="Thumbnail preview"
                  className="w-full h-20 object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handlePublish}
            disabled={publishMutation.isPending}
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-600/50 disabled:cursor-not-allowed text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {publishMutation.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Publishing…
              </>
            ) : (
              "Publish"
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
