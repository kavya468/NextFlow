"use client";

// ============================================================================
// components/nodes/GenericNode.tsx — The Universal Node Renderer
// ============================================================================
//
// This single component replaces ALL individual node .tsx files.
// It reads a NodeConfig from the registry and dynamically renders:
//   - Header with name + icon
//   - Input handles with "● linked" indicators
//   - UI controls (text, number, select, textarea, file upload)
//   - Collapsible "Advanced Settings" accordion (animated)
//   - Output handles with optional result preview
//   - Copy/open actions for output URLs
//   - Media upload zones for image/video source nodes
//
// CONNECTOR-SETTING PARITY:
//   Every input definition generates BOTH a visible React Flow Handle AND
//   a UI control. When the handle is connected upstream, the UI control
//   is disabled and shows "● linked" to indicate data flows from the edge.
//
// DESIGN (emil-design-eng principles):
//   - Micro-animations on accordion expand/collapse (height + opacity)
//   - Subtle hover states on all interactive elements
//   - Consistent 11px typography matching the existing Krea aesthetic
//   - Handle glow rings with type-appropriate colors
//   - Output preview with image thumbnails and text snippets
// ============================================================================

import { Handle, Position, useReactFlow } from "@xyflow/react";
import { useStore, type NodeRunStatus } from "@/lib/store";
import { useConnectedHandles } from "@/lib/useConnectedHandles";
import { useCallback, useState, useMemo, useRef, useEffect } from "react";
import { nodeRegistry } from "@/lib/nodes/registry";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ExternalLink,
  Upload,
  Loader2,
  X,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  // We'll dynamically look up icons but import common ones
  Crop,
  Type as TypeIcon,
  Image as ImageIcon,
  Video,
  Bot,
  Scissors,
  Music,
  Sparkles,
  Wand2,
  Mic,
  Film,
  Merge,
  AudioLines,
  Maximize2,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  NodeConfig,
  InputDefinition,
  OutputDefinition,
  IOType,
} from "@/lib/nodes/types";
import { getDataTypeTheme, getCategoryTheme } from "@/lib/theme";
import { MentionTextarea } from "@/components/nodes/MentionTextarea";
import { ElementsEditor } from "@/components/nodes/ElementsEditor";
import { DialogueEditor } from "@/components/nodes/DialogueEditor";

// ---------------------------------------------------------------------------
// Lucide icon lookup — maps config icon names to actual components
// ---------------------------------------------------------------------------
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Crop,
  Type: TypeIcon,
  Image: ImageIcon,
  Video,
  Bot,
  Scissors,
  Music,
  Sparkles,
  Wand2,
  Mic,
  Film,
  Merge,
  AudioLines,
};

function getIcon(iconName: string): React.ComponentType<any> | null {
  return ICON_MAP[iconName] || null;
}

// ---------------------------------------------------------------------------
// Handle positioning constants
// ---------------------------------------------------------------------------
const HANDLE_STYLE_LEFT = {
  left: -5,
  top: "50%",
  transform: "translateY(-50%)",
};

const HANDLE_STYLE_RIGHT = {
  right: -5,
  left: "auto",
  top: "50%",
  transform: "translateY(-50%)",
};

// ---------------------------------------------------------------------------
// Handle style resolution — all colors from lib/theme.ts
// ---------------------------------------------------------------------------
function getHandleStyle(type: IOType): React.CSSProperties {
  const theme = getDataTypeTheme(type);
  return {
    backgroundColor: theme.primary,
    border: `2px solid ${theme.muted}`,
    width: 10,
    height: 10,
    borderRadius: "50%",
    transition: "transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
    // CSS variable consumed by globals.css for hover glow color
    ["--handle-color" as string]: theme.primary,
  };
}

const HANDLE_BASE_CLASSES = "!border-none !ring-0 !transition-all";

// ============================================================================
// MediaSourceArea — Upload zone + preview for passthrough media nodes
// ============================================================================
function MediaSourceArea({
  config,
  data,
  updateField,
}: {
  config: NodeConfig;
  data: Record<string, unknown>;
  updateField: (field: string, value: unknown) => void;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Determine media type from outputs
  const mediaOutput = config.outputs.find(
    (o) => o.type === "image" || o.type === "video"
  );
  if (!mediaOutput) return null;

  const mediaType = mediaOutput.type as "image" | "video";
  const url = (data.url as string) || "";
  const accept = mediaType === "image" ? "image/*" : "video/*";

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      // ── 1. Get signed params from our lightweight JSON endpoint ──────
      const signRes = await fetch("/api/upload/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: mediaType }),
      });

      if (!signRes.ok) {
        const errBody = await signRes.json().catch(() => ({}));
        throw new Error(errBody.error || "Failed to get upload signature");
      }
      const { params, signature } = await signRes.json();

      // ── 2. Upload file DIRECTLY to Transloadit (bypasses Next.js body limit) ──
      const uploadForm = new FormData();
      uploadForm.append("params", params);
      uploadForm.append("signature", signature);
      uploadForm.append("file", file, file.name);

      const assemblyRes = await fetch(
        "https://api2.transloadit.com/assemblies",
        { method: "POST", body: uploadForm }
      );
      const assembly = await assemblyRes.json();

      if (assembly.error) {
        throw new Error(`Transloadit: ${assembly.error}`);
      }

      // ── 3. Poll assembly until completion ────────────────────────────
      const assemblyUrl = assembly.assembly_ssl_url;
      const maxWait = 120_000;
      const start = Date.now();
      let result: any = null;

      while (Date.now() - start < maxWait) {
        const pollRes = await fetch(assemblyUrl);
        const pollData = await pollRes.json();

        if (pollData.ok === "ASSEMBLY_COMPLETED") {
          result = pollData;
          break;
        }
        if (pollData.error) {
          throw new Error(`Processing error: ${pollData.error}`);
        }
        // Wait 2s between polls
        await new Promise((r) => setTimeout(r, 2000));
      }

      if (!result) {
        throw new Error("Upload timed out after 120s");
      }

      // ── 4. Extract CDN URL from results ─────────────────────────────
      // Try processed step first, then fall back to raw uploads
      const stepKey =
        mediaType === "video" ? "video_exported" : "image_exported";
      const stepResults = result.results?.[stepKey];
      const cdnUrl =
        stepResults?.[0]?.ssl_url || result.uploads?.[0]?.ssl_url;

      if (cdnUrl) {
        updateField("url", cdnUrl);
      } else {
        throw new Error("No URL returned from upload");
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      setUploadError(error.message || "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const clearMedia = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateField("url", "");
    setUploadError(null);
  };

  return (
    <div className="px-3">
      <input
        type="file"
        accept={accept}
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileChange}
      />

      <div
        className={`w-full bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-xl overflow-hidden nodrag transition-all duration-200 ${isUploading
            ? "opacity-60 pointer-events-none"
            : url
              ? "hover:border-[var(--node-inner-border-hover)]"
              : "cursor-pointer hover:border-[var(--node-inner-border-hover)] hover:bg-[var(--node-inner-bg-hover)]"
          }`}
        onClick={() => !isUploading && !url && fileInputRef.current?.click()}
      >
        {url ? (
          <div className="relative group">
            {mediaType === "image" ? (
              <img
                src={url}
                alt="Preview"
                className="w-full max-h-40 object-contain rounded-t-xl bg-[var(--node-preview-bg)]"
              />
            ) : (
              <video
                src={url}
                controls
                className="w-full max-h-40 object-contain rounded-t-xl bg-[var(--node-preview-bg)]"
              />
            )}
            {/* Overlay actions */}
            <div className="absolute inset-0 bg-[var(--overlay-bg)] transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="p-1.5 bg-[var(--badge-bg)] rounded-lg text-[var(--text-primary)] hover:text-[var(--text-primary)] hover:bg-[var(--badge-bg-hover)] transition-colors"
                title="Replace"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={clearMedia}
                className="p-1.5 bg-[var(--badge-bg)] rounded-lg text-[var(--text-primary)] hover:text-[var(--status-error)] hover:bg-[var(--badge-bg-hover)] transition-colors"
                title="Remove"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 bg-[var(--badge-bg)] rounded-lg text-[var(--text-primary)] hover:text-[var(--text-primary)] hover:bg-[var(--badge-bg-hover)] transition-colors"
                title="Open in new tab"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-36 gap-2">
            {isUploading ? (
              <>
                <Loader2 className="w-5 h-5 text-[var(--text-muted)] animate-spin" />
                <span className="text-[10px] text-[var(--text-muted)]">Uploading to Transloadit...</span>
              </>
            ) : (
              <>
                <Upload className="w-5 h-5 text-[var(--text-placeholder)]" />
                <span className="text-[10px] text-[var(--text-muted)]">
                  Click to upload {mediaType}
                </span>
                <span className="text-[8px] text-[var(--text-placeholder)]">
                  or paste a URL below
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Upload error feedback */}
      {uploadError && (
        <div className="flex items-center gap-1 mt-1.5 px-0.5">
          <X className="w-3 h-3 text-[var(--status-error)] flex-shrink-0" />
          <p className="text-[9px] text-[var(--status-error)] truncate">{uploadError}</p>
        </div>
      )}

      {/* URL shown below preview */}
      {url && (
        <p className="text-[8px] text-[var(--text-placeholder)] mt-1.5 truncate font-mono px-0.5">
          {url}
        </p>
      )}

      {/* Manual URL paste input — fallback if upload is broken or user has a link */}
      {!url && !isUploading && (
        <input
          type="text"
          className="w-full mt-2 bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg px-2.5 py-1.5 text-[10px] text-[var(--text-secondary)] focus:outline-none focus:border-[var(--focus-ring)] placeholder:text-[var(--text-placeholder)] nodrag transition-colors"
          placeholder={`Paste ${mediaType} URL...`}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const val = (e.target as HTMLInputElement).value.trim();
              if (val) {
                updateField("url", val);
                setUploadError(null);
              }
            }
          }}
          onBlur={(e) => {
            const val = e.target.value.trim();
            if (val) {
              updateField("url", val);
              setUploadError(null);
            }
          }}
        />
      )}
    </div>
  );
}
// ============================================================================
// MultiInputOrderList — Reorderable list for multi-input handles
// ============================================================================
// When a multi-input handle (e.g., Merge Videos' video_urls) has multiple
// sources connected, this shows a visual list with:
//   - Tiny video thumbnail (poster frame) for instant recognition
//   - Extracted filename from the CDN URL
//   - Color-coded accent dot for cross-referencing with the canvas
//   - Up/down arrows to reorder
// The order is persisted in node.data._inputOrder[handleKey].
// ============================================================================

// Accent colors for distinguishing connected inputs visually
const ACCENT_COLORS = [
  { bg: "bg-blue-500", border: "border-blue-500/60", text: "text-blue-400" },
  { bg: "bg-amber-500", border: "border-amber-500/60", text: "text-amber-400" },
  { bg: "bg-emerald-500", border: "border-emerald-500/60", text: "text-emerald-400" },
  { bg: "bg-rose-500", border: "border-rose-500/60", text: "text-rose-400" },
  { bg: "bg-violet-500", border: "border-violet-500/60", text: "text-violet-400" },
  { bg: "bg-cyan-500", border: "border-cyan-500/60", text: "text-cyan-400" },
  { bg: "bg-orange-500", border: "border-orange-500/60", text: "text-orange-400" },
  { bg: "bg-pink-500", border: "border-pink-500/60", text: "text-pink-400" },
];

/** Extract a human-readable name from a CDN URL or node data */
function extractVideoLabel(url: string | undefined): string {
  if (!url) return "No video";
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    // Get the filename from the path
    const segments = pathname.split("/").filter(Boolean);
    const filename = segments[segments.length - 1] || "";

    // Try to decode and clean up the filename
    const decoded = decodeURIComponent(filename);

    // Remove common hash prefixes (e.g., "a3f2b7c1_video.mp4" → "video.mp4")
    // Also handle Transloadit-style names
    const cleaned = decoded
      .replace(/^[a-f0-9]{8,}_/i, "") // Remove leading hash prefix
      .replace(/\.[^.]+$/, "");        // Remove file extension

    if (cleaned && cleaned.length > 2) {
      // Truncate if too long, capitalize first letter
      const display = cleaned.length > 20 ? cleaned.slice(0, 20) + "…" : cleaned;
      return display.charAt(0).toUpperCase() + display.slice(1);
    }

    // Fallback: use domain + short path
    const host = urlObj.hostname.replace(/^(www\.|pub-)/, "").slice(0, 12);
    return `${host}/…${filename.slice(-8)}`;
  } catch {
    // URL parsing failed, show truncated raw string
    return url.length > 24 ? "…" + url.slice(-20) : url;
  }
}

function MultiInputOrderList({
  nodeId,
  handleKey,
  updateField,
  data,
}: {
  nodeId: string;
  handleKey: string;
  updateField: (field: string, value: unknown) => void;
  data: Record<string, unknown>;
}) {
  const edges = useStore((state) => state.edges);
  const nodes = useStore((state) => state.nodes);

  // Find all edges targeting this handle
  const incomingEdges = useMemo(
    () => edges.filter((e) => e.target === nodeId && e.targetHandle === handleKey),
    [edges, nodeId, handleKey]
  );

  // Get the persisted order (array of source node IDs)
  const savedOrder = useMemo(() => {
    const orderMap = (data._inputOrder as Record<string, string[]>) || {};
    return orderMap[handleKey] || [];
  }, [data._inputOrder, handleKey]);

  // Build ordered list: respect saved order, append any new connections at the end
  const orderedSourceIds = useMemo(() => {
    const currentSourceIds = incomingEdges.map((e) => e.source);
    // Start with saved order, filter out stale entries (disconnected)
    const ordered = savedOrder.filter((id) => currentSourceIds.includes(id));
    // Append newly connected sources not yet in the saved order
    for (const id of currentSourceIds) {
      if (!ordered.includes(id)) {
        ordered.push(id);
      }
    }
    return ordered;
  }, [incomingEdges, savedOrder]);

  // Resolve source node info (URL, label, etc.)
  const sourceInfos = useMemo(() => {
    return orderedSourceIds.map((sourceId, index) => {
      const node = nodes.find((n) => n.id === sourceId);
      const url = (node?.data?.url as string) || undefined;
      const label = extractVideoLabel(url);
      const accent = ACCENT_COLORS[index % ACCENT_COLORS.length];
      return { sourceId, url, label, accent };
    });
  }, [orderedSourceIds, nodes]);

  // Auto-persist order whenever connections change
  useEffect(() => {
    const currentSourceIds = incomingEdges.map((e) => e.source);
    if (currentSourceIds.length < 2) return;

    const currentOrderMap = (data._inputOrder as Record<string, string[]>) || {};
    const currentSaved = currentOrderMap[handleKey] || [];

    const needsUpdate =
      orderedSourceIds.length !== currentSaved.length ||
      orderedSourceIds.some((id, i) => currentSaved[i] !== id);

    if (needsUpdate) {
      updateField("_inputOrder", {
        ...currentOrderMap,
        [handleKey]: orderedSourceIds,
      });
    }
  }, [orderedSourceIds, incomingEdges, handleKey, data._inputOrder, updateField]);

  // Don't render anything if fewer than 2 connections
  if (orderedSourceIds.length < 2) return null;

  const moveItem = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= orderedSourceIds.length) return;
    const newOrder = [...orderedSourceIds];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);

    const currentOrderMap = (data._inputOrder as Record<string, string[]>) || {};
    updateField("_inputOrder", {
      ...currentOrderMap,
      [handleKey]: newOrder,
    });
  };

  return (
    <div className="px-4 mt-1">
      <div className="bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[var(--node-inner-border)]">
          <span className="text-[9px] text-[var(--text-muted)] font-medium uppercase tracking-wider">
            Merge Order
          </span>
          <span className="text-[9px] text-[var(--text-placeholder)]">
            {sourceInfos.length} clips
          </span>
        </div>

        {/* Reorderable clip list */}
        {sourceInfos.map(({ sourceId, url, label, accent }, index) => (
          <div
            key={sourceId}
            className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--node-inner-border)] last:border-b-0 group hover:bg-[var(--node-inner-bg-hover)] transition-colors"
          >
            {/* Position badge with accent color */}
            <div
              className={`w-4 h-4 rounded-[4px] ${accent.bg} flex items-center justify-center flex-shrink-0`}
            >
              <span className="text-[9px] font-bold text-[var(--text-inverse)] leading-none">
                {index + 1}
              </span>
            </div>

            {/* Video thumbnail */}
            <div className={`w-10 h-7 rounded overflow-hidden flex-shrink-0 bg-[var(--node-preview-bg)] border ${accent.border}`}>
              {url ? (
                <video
                  src={url}
                  className="w-full h-full object-cover"
                  muted
                  preload="metadata"
                  // Jump to 0.5s to skip black frames
                  onLoadedMetadata={(e) => {
                    const vid = e.currentTarget;
                    if (vid.duration > 0.5) vid.currentTime = 0.5;
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Film className="w-3 h-3 text-[var(--text-disabled)]" />
                </div>
              )}
            </div>

            {/* Label (extracted filename) */}
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-[10px] text-[var(--text-secondary)] truncate leading-tight">
                {label}
              </span>
              {url && (
                <span className="text-[8px] text-[var(--text-placeholder)] truncate font-mono leading-tight">
                  {url.slice(0, 30)}…
                </span>
              )}
            </div>

            {/* Reorder buttons — always visible for clarity */}
            <div className="flex flex-col gap-0 flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  moveItem(index, index - 1);
                }}
                disabled={index === 0}
                className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--badge-bg-hover)] disabled:opacity-20 disabled:hover:text-[var(--text-muted)] disabled:hover:bg-transparent transition-colors nodrag"
                title="Move up"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  moveItem(index, index + 1);
                }}
                disabled={index === sourceInfos.length - 1}
                className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--badge-bg-hover)] disabled:opacity-20 disabled:hover:text-[var(--text-muted)] disabled:hover:bg-transparent transition-colors nodrag"
                title="Move down"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// MediaInputWithUpload — URL input + Upload button for media-type inputs
// Supports both single-URL and multi-URL (input.multi) modes.
// ============================================================================
function MediaInputWithUpload({
  input,
  value,
  onChange,
  disabled,
}: {
  input: InputDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Determine accept type from the input's data type
  const acceptMap: Record<string, string> = {
    image: "image/*",
    video: "video/*",
    audio: "audio/*",
    file: "image/*,video/*,audio/*",
  };
  const accept = acceptMap[input.type] || "*/*";

  // ── Normalize value to array for multi, string for single ─────────
  const isMulti = !!input.multi;

  const urls: string[] = useMemo(() => {
    if (!isMulti) return [];
    if (Array.isArray(value)) return value.filter((v) => typeof v === "string" && v.length > 0);
    if (typeof value === "string" && value.length > 0) return [value];
    return [];
  }, [value, isMulti]);

  const singleUrl = isMulti ? "" : ((value as string) || "");

  // ── Upload handler — appends for multi, replaces for single ───────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Upload failed (${response.status})`);
      }

      const { url } = await response.json();
      if (!url) throw new Error("No URL returned from upload");

      if (isMulti) {
        onChange([...urls, url]);
      } else {
        onChange(url);
      }
    } catch (error: any) {
      console.error("Media upload error:", error);
      setUploadError(error.message || "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const effectivelyDisabled = disabled || isUploading;

  // ── Remove helper ─────────────────────────────────────────────────
  const removeUrl = (index: number) => {
    if (isMulti) {
      const updated = urls.filter((_, i) => i !== index);
      onChange(updated.length > 0 ? updated : []);
    } else {
      onChange("");
    }
    setUploadError(null);
  };

  // ── Inline preview for a single URL ───────────────────────────────
  const renderPreview = (previewUrl: string, size: "sm" | "md" = "md") => {
    const maxH = size === "sm" ? "max-h-16" : "max-h-28";
    if (input.type === "image" || input.type === "file") {
      return (
        <img
          src={previewUrl}
          alt={input.label}
          className={`w-full ${maxH} object-contain bg-[var(--node-preview-bg)]`}
        />
      );
    }
    if (input.type === "video") {
      return (
        <video
          src={previewUrl}
          controls
          className={`w-full ${maxH} object-contain bg-[var(--node-preview-bg)] nodrag`}
        />
      );
    }
    if (input.type === "audio") {
      return (
        <audio src={previewUrl} controls className="w-full nodrag p-1.5" />
      );
    }
    return null;
  };

  // ====================================================================
  // MULTI MODE — list of thumbnails + add more
  // ====================================================================
  if (isMulti) {
    return (
      <div className="px-4">
        <input
          type="file"
          accept={accept}
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileUpload}
        />

        {/* Existing items */}
        {urls.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-1.5">
            {urls.map((itemUrl, index) => (
              <div
                key={`${itemUrl}-${index}`}
                className="relative group bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg overflow-hidden"
              >
                <div className="flex items-center gap-2 p-1.5">
                  {/* Thumbnail */}
                  <div className="w-12 h-10 rounded overflow-hidden flex-shrink-0 bg-[var(--node-preview-bg)] border border-[var(--node-inner-border)]">
                    {input.type === "image" || input.type === "file" ? (
                      <img
                        src={itemUrl}
                        alt={`${input.label} ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                    ) : input.type === "video" ? (
                      <video
                        src={itemUrl}
                        className="w-full h-full object-cover"
                        muted
                        preload="metadata"
                        onLoadedMetadata={(e) => {
                          const vid = e.currentTarget;
                          if (vid.duration > 0.5) vid.currentTime = 0.5;
                        }}
                      />
                    ) : input.type === "audio" ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <Music className="w-4 h-4 text-[var(--text-disabled)]" />
                      </div>
                    ) : null}
                  </div>

                  {/* URL + index */}
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-[9px] text-[var(--text-muted)] font-medium">
                      #{index + 1}
                    </span>
                    <span className="text-[8px] text-[var(--text-placeholder)] truncate font-mono">
                      {itemUrl.length > 35 ? "…" + itemUrl.slice(-30) : itemUrl}
                    </span>
                  </div>

                  {/* Remove button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeUrl(index);
                    }}
                    disabled={effectivelyDisabled}
                    className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--status-error)] hover:bg-[var(--badge-bg-hover)] transition-colors nodrag flex-shrink-0"
                    title="Remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add more — upload button + URL paste input */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            className={`flex-1 min-w-0 bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] placeholder:text-[var(--text-placeholder)] nodrag transition-colors ${effectivelyDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
            disabled={effectivelyDisabled}
            placeholder={`Paste ${input.type} URL to add...`}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const val = (e.target as HTMLInputElement).value.trim();
                if (val) {
                  onChange([...urls, val]);
                  (e.target as HTMLInputElement).value = "";
                }
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={effectivelyDisabled}
            className={`flex items-center justify-center w-7 h-7 rounded-lg border border-[var(--node-inner-border)] bg-[var(--node-inner-bg)] transition-colors nodrag flex-shrink-0 ${
              effectivelyDisabled
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-[var(--node-inner-bg-hover)] hover:border-[var(--node-inner-border-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
            title={isUploading ? "Uploading..." : `Upload ${input.type}`}
          >
            {isUploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--status-running)]" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* Count badge */}
        {urls.length > 0 && (
          <p className="text-[9px] text-[var(--text-placeholder)] mt-1 px-0.5">
            {urls.length} {input.type}{urls.length !== 1 ? "s" : ""} added
          </p>
        )}

        {uploadError && (
          <div className="flex items-center gap-1 mt-1 px-0.5">
            <X className="w-3 h-3 text-[var(--status-error)] flex-shrink-0" />
            <p className="text-[9px] text-[var(--status-error)] truncate">{uploadError}</p>
          </div>
        )}
      </div>
    );
  }

  // ====================================================================
  // SINGLE MODE — preview with overlay + URL input
  // ====================================================================
  return (
    <div className="px-4">
      <input
        type="file"
        accept={accept}
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileUpload}
      />

      {/* ── Preview area — shown when a URL is present ──────────────── */}
      {singleUrl && (
        <div className="mb-1.5">
          <div className="relative group bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg overflow-hidden">
            {renderPreview(singleUrl)}

            {/* Hover overlay with replace/remove actions */}
            <div className="absolute inset-0 bg-black/50 transition-opacity flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                disabled={effectivelyDisabled}
                className="p-1.5 bg-[var(--badge-bg)] rounded-lg text-[var(--text-primary)] hover:bg-[var(--badge-bg-hover)] transition-colors nodrag"
                title="Replace"
              >
                <Upload className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeUrl(0);
                }}
                disabled={effectivelyDisabled}
                className="p-1.5 bg-[var(--badge-bg)] rounded-lg text-[var(--text-primary)] hover:text-[var(--status-error)] hover:bg-[var(--badge-bg-hover)] transition-colors nodrag"
                title="Remove"
              >
                <X className="w-3 h-3" />
              </button>
              <a
                href={singleUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 bg-[var(--badge-bg)] rounded-lg text-[var(--text-primary)] hover:bg-[var(--badge-bg-hover)] transition-colors nodrag"
                title="Open in new tab"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
          <p className="text-[8px] text-[var(--text-placeholder)] mt-1 truncate font-mono px-0.5">
            {singleUrl}
          </p>
        </div>
      )}

      {/* ── Upload / URL input row — shown when no URL or during upload */}
      {(!singleUrl || isUploading) && (
        <>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              className={`flex-1 min-w-0 bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] placeholder:text-[var(--text-placeholder)] nodrag transition-colors ${effectivelyDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
              value={singleUrl}
              onChange={(e) => onChange(e.target.value)}
              disabled={effectivelyDisabled}
              placeholder={input.placeholder || `Paste ${input.type} URL...`}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={effectivelyDisabled}
              className={`flex items-center justify-center w-7 h-7 rounded-lg border border-[var(--node-inner-border)] bg-[var(--node-inner-bg)] transition-colors nodrag flex-shrink-0 ${
                effectivelyDisabled
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:bg-[var(--node-inner-bg-hover)] hover:border-[var(--node-inner-border-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
              title={isUploading ? "Uploading..." : `Upload ${input.type}`}
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--status-running)]" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          {uploadError && (
            <div className="flex items-center gap-1 mt-1 px-0.5">
              <X className="w-3 h-3 text-[var(--status-error)] flex-shrink-0" />
              <p className="text-[9px] text-[var(--status-error)] truncate">{uploadError}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// InputControl — renders the appropriate UI control for an input definition
// ============================================================================
function InputControl({
  input,
  value,
  onChange,
  disabled,
  siblingData,
  nodeId,
}: {
  input: InputDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
  siblingData?: Record<string, unknown>;
  nodeId?: string;
}) {
  // Hidden variant — no UI control, handle only
  if (input.uiVariant === "hidden") return null;

  // Mention-textarea variant — rich prompt with @Element/@Image pills
  if (input.uiVariant === "mention-textarea") {
    return (
      <MentionTextarea
        value={(value as string) || ""}
        onChange={(val) => onChange(val)}
        disabled={disabled}
        placeholder={input.placeholder}
        mentionSources={input.mentionSources}
        siblingData={siblingData || {}}
      />
    );
  }

  // Elements-editor variant — compound element list (frontal + reference images)
  // with per-image dynamic React Flow Handles
  if (input.uiVariant === "elements-editor") {
    return (
      <ElementsEditor
        value={value}
        onChange={(val) => onChange(val)}
        disabled={disabled}
        nodeId={nodeId}
      />
    );
  }

  // Dialogue-editor variant — structured dialogue lines (voice + text per line)
  if (input.uiVariant === "dialogue-editor") {
    return (
      <DialogueEditor
        value={value}
        onChange={(val) => onChange(val)}
        disabled={disabled}
        nodeId={nodeId}
      />
    );
  }

  // Disabled state when connected upstream
  const disabledClasses = disabled
    ? "opacity-50 cursor-not-allowed"
    : "";

  switch (input.type) {
    // ── Media types: URL input with upload button ──────────────────────
    case "image":
    case "video":
    case "audio":
    case "file": {
      if (input.uiVariant === "textarea") {
        return (
          <div className={`px-4 ${disabledClasses}`}>
            <textarea
              className="w-full bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg p-2.5 text-[11px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] resize-none h-20 placeholder:text-[var(--text-placeholder)] nodrag transition-colors"
              value={(value as string) || ""}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              placeholder={input.placeholder || `Enter ${input.label.toLowerCase()}...`}
            />
          </div>
        );
      }

      // Media inputs get the upload button alongside the URL input
      return (
        <MediaInputWithUpload
          input={input}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    }

    // ── Text type: plain text input (no upload) ───────────────────────
    case "text": {
      if (input.uiVariant === "textarea") {
        return (
          <div className={`px-4 ${disabledClasses}`}>
            <textarea
              className="w-full bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg p-2.5 text-[11px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] resize-none h-20 placeholder:text-[var(--text-placeholder)] nodrag transition-colors"
              value={(value as string) || ""}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              placeholder={input.placeholder || `Enter ${input.label.toLowerCase()}...`}
            />
          </div>
        );
      }

      return (
        <div className={`px-4 ${disabledClasses}`}>
          <input
            type="text"
            className="w-full bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] placeholder:text-[var(--text-placeholder)] nodrag transition-colors"
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={input.placeholder || `Enter ${input.label.toLowerCase()}...`}
          />
        </div>
      );
    }

    case "number": {
      const min = input.validation?.min;
      const max = input.validation?.max;
      const step = input.validation?.step ?? 1;

      if (input.uiVariant === "slider") {
        return (
          <div className={`px-4 ${disabledClasses}`}>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={(value as number) ?? input.default ?? 0}
                onChange={(e) => onChange(Number(e.target.value))}
                disabled={disabled}
                className="flex-1 h-1 bg-[var(--node-inner-border)] rounded-full appearance-none cursor-pointer nodrag accent-[var(--status-running)]"
              />
              <span className="text-[10px] text-[var(--text-secondary)] font-mono w-8 text-right">
                {(value as number) ?? input.default ?? 0}
              </span>
            </div>
          </div>
        );
      }

      return (
        <div className={`px-4 ${disabledClasses}`}>
          <div className="flex bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg overflow-hidden">
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={(value as number) ?? input.default ?? ""}
              onChange={(e) => {
                let val = Number(e.target.value);
                if (min !== undefined) val = Math.max(min, val);
                if (max !== undefined) val = Math.min(max, val);
                onChange(val);
              }}
              disabled={disabled}
              className="w-full bg-transparent text-[11px] p-1.5 text-[var(--text-primary)] focus:outline-none nodrag text-center disabled:cursor-not-allowed disabled:text-[var(--text-disabled)]"
            />
            {max === 100 && (
              <span className="text-[var(--text-placeholder)] text-[9px] pr-2 flex items-center">%</span>
            )}
          </div>
        </div>
      );
    }

    case "select": {
      const options = input.validation?.options || [];
      return (
        <div className={`px-4 ${disabledClasses}`}>
          <select
            value={(value as string) || (input.default as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="w-full bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] focus:outline-none cursor-pointer nodrag"
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );
    }

    case "boolean": {
      return (
        <div className={`px-4 ${disabledClasses}`}>
          <label className="flex items-center gap-2 cursor-pointer nodrag">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
              disabled={disabled}
              className="w-3.5 h-3.5 rounded border-[var(--node-inner-border)] bg-[var(--node-inner-bg)] text-[var(--status-running)] focus:ring-0 focus:ring-offset-0"
            />
            <span className="text-[11px] text-[var(--text-secondary)]">{input.label}</span>
          </label>
        </div>
      );
    }

    default:
      return null;
  }
}

// ============================================================================
// OutputPreview — renders a result preview for completed outputs
// ============================================================================
function OutputPreview({
  config,
  data,
}: {
  config: NodeConfig;
  data: Record<string, unknown>;
}) {
  const [copied, setCopied] = useState(false);

  if (!config.ui.showOutputPreview || !config.ui.previewOutputKey) return null;

  const outputKey = config.ui.previewOutputKey;
  const outputDef = config.outputs.find((o) => o.key === outputKey);
  if (!outputDef) return null;

  // Check multiple possible locations for the output value
  const outputValue =
    (data as any)[`result_${outputKey}`] ||
    (data as any)[`output_${outputKey}`] ||
    (data as any).result_url ||
    (data as any).result;

  if (!outputValue) return null;

  const copyValue = () => {
    navigator.clipboard.writeText(String(outputValue));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Image/Video/Audio preview
  if (
    outputDef.type === "image" ||
    outputDef.type === "video" ||
    outputDef.type === "audio"
  ) {
    return (
      <div className="px-4 mt-1">
        <div className="bg-[var(--node-inner-bg)] border border-[var(--status-success-border)] rounded-lg p-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-medium text-[var(--status-success)]">
              ✓ {outputDef.label}
            </span>
            <div className="flex gap-1">
              <button
                onClick={copyValue}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors nodrag"
                title="Copy URL"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-[var(--status-success)]" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
              <a
                href={String(outputValue)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors nodrag"
                title="Open in new tab"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
          {outputDef.type === "image" ? (
            <img
              src={String(outputValue)}
              alt={outputDef.label}
              className="w-full h-20 object-cover rounded"
            />
          ) : outputDef.type === "audio" ? (
            <audio
              src={String(outputValue)}
              className="w-full h-10 rounded nodrag"
              controls
            />
          ) : (
            <video
              src={String(outputValue)}
              className="w-full h-20 object-cover rounded"
              controls
            />
          )}
          <p className="text-[8px] text-[var(--text-placeholder)] mt-1 truncate font-mono">
            {String(outputValue)}
          </p>
        </div>
      </div>
    );
  }

  // Text preview
  if (outputDef.type === "text") {
    const textContent = String(outputValue);

    return (
      <div className="px-4 mt-1">
        <div className="bg-[var(--node-inner-bg)] border border-[var(--status-success-border)] rounded-lg p-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-medium text-[var(--status-success)]">
              ✓ {outputDef.label}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={copyValue}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors nodrag"
                title="Copy"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-[var(--status-success)]" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
              <Dialog>
                <DialogTrigger
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors nodrag"
                  title="View full response"
                >
                  <Maximize2 className="w-3 h-3" />
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>{outputDef.label}</DialogTitle>
                  </DialogHeader>
                  <div className="max-h-[70vh] overflow-y-auto overscroll-contain whitespace-pre-wrap text-sm text-[var(--text-primary)] leading-relaxed rounded-lg bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] p-4 node-scrollbar">
                    {textContent}
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={copyValue}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-[var(--status-success)]" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Copied" : "Copy to Clipboard"}
                    </button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <div className="max-h-[200px] overflow-y-auto overscroll-contain whitespace-pre-wrap text-[10px] text-[var(--text-primary)] leading-relaxed node-scrollbar nodrag">
            {textContent}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ============================================================================
// GenericNode — The Universal Node Component
// ============================================================================
export function GenericNode({
  id,
  data,
  selected,
  type,
}: {
  id: string;
  data: Record<string, unknown>;
  selected?: boolean;
  type?: string;
}) {
  const config = useMemo(() => {
    if (!type) return null;
    return nodeRegistry.get(type);
  }, [type]);

  const isRunning = useStore((state) => state.runningNodeIds.includes(id));
  const nodeStatus = useStore((state) => state.nodeRunStatuses[id] as NodeRunStatus | undefined);
  const { setNodes } = useReactFlow();
  const connected = useConnectedHandles(id);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedContentRef = useRef<HTMLDivElement>(null);

  const [showExposedTipFor, setShowExposedTipFor] = useState<string | null>(null);
  const tipCheckedRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      tipCheckedRef.current = localStorage.getItem("nextflow:exposed-tip-seen") === "true";
    }
  }, []);

  const handleEyeHover = (key: string) => {
    if (!tipCheckedRef.current && !showExposedTipFor) {
      setShowExposedTipFor(key);
    }
  };

  const dismissTip = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowExposedTipFor(null);
    tipCheckedRef.current = true;
    localStorage.setItem("nextflow:exposed-tip-seen", "true");
  };

  // Split inputs into standard and advanced groups, applying showIf filtering
  const standardInputs = useMemo(
    () => config?.inputs.filter((i) => {
      if (i.isAdvanced) return false;
      if (i.showIf) {
        const siblingValue = data[i.showIf.field];
        return String(siblingValue) === i.showIf.equals;
      }
      return true;
    }) || [],
    [config, data]
  );
  const advancedInputs = useMemo(
    () => config?.inputs.filter((i) => {
      if (!i.isAdvanced) return false;
      if (i.showIf) {
        const siblingValue = data[i.showIf.field];
        return String(siblingValue) === i.showIf.equals;
      }
      return true;
    }) || [],
    [config, data]
  );

  // Detect if this is a media source node (passthrough with image/video output)
  const isMediaSource = useMemo(() => {
    if (!config?.isPassthrough) return false;
    return config.outputs.some(
      (o) => o.type === "image" || o.type === "video"
    );
  }, [config]);

  const updateField = useCallback(
    (field: string, value: unknown) => {
      const currentNodes = useStore.getState().nodes;
      const updatedNodes = currentNodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, [field]: value } }
          : node
      );
      useStore.getState().setNodes(updatedNodes);
    },
    [id]
  );

  // Exposed input key management — toggles a field in node.data.exposedInputKeys
  const exposedInputKeys = useMemo(
    () => (Array.isArray(data.exposedInputKeys) ? data.exposedInputKeys as string[] : []),
    [data.exposedInputKeys]
  );

  const toggleExposedKey = useCallback(
    (inputKey: string) => {
      const current = Array.isArray(data.exposedInputKeys)
        ? (data.exposedInputKeys as string[])
        : [];
      const next = current.includes(inputKey)
        ? current.filter((k) => k !== inputKey)
        : [...current, inputKey];
      updateField("exposedInputKeys", next);
    },
    [data.exposedInputKeys, updateField]
  );

  // If config not found, render a fallback
  if (!config) {
    return (
      <div className="bg-[var(--node-bg)] rounded-2xl w-[240px] p-4 border border-[var(--status-error-border)]">
        <span className="text-[11px] text-[var(--status-error-muted)]">
          Unknown node type: {type}
        </span>
      </div>
    );
  }

  const IconComponent = getIcon(config.icon);

  const handleRunNode = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("nextflow:run-nodes", { detail: { nodeIds: [id] } })
    );
  }, [id]);

  const borderClass = (() => {
    if (selected) return "border-[1.5px] border-[var(--node-selected-border)]";
    if (nodeStatus === "SUCCESS") return "border-[1.5px] border-[var(--status-success-border)]";
    if (nodeStatus === "FAILED") return "border-[1.5px] border-[var(--status-error-border)]";
    if (nodeStatus === "RUNNING") return "border-[1.5px] border-[var(--status-running-border)]";
    return "border-[1px] border-[var(--node-border)]";
  })();

  return (
    <div
      className={`bg-[var(--node-bg)] rounded-2xl pb-4 ${borderClass} ${isRunning ? "animate-node-pulse" : ""
        } shadow-2xl transition-colors duration-300`}
      style={{ width: config.ui.width }}
    >
      {/* ================================================================ */}
      {/* HEADER — Node name + icon + status + run button                 */}
      {/* ================================================================ */}
      <div className="flex justify-between items-center px-4 py-3 border-b border-[var(--node-divider)]">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-[var(--text-secondary)] tracking-wide">
            {config.name}
          </span>
          {nodeStatus === "RUNNING" && (
            <Loader2 className="w-3 h-3 text-[var(--status-warning)] animate-spin" />
          )}
          {nodeStatus === "SUCCESS" && (
            <CheckCircle2 className="w-3 h-3 text-[var(--status-success)]" />
          )}
          {nodeStatus === "FAILED" && (
            <XCircle className="w-3 h-3 text-[var(--status-error)]" />
          )}
          {nodeStatus === "PENDING" && (
            <Clock className="w-3 h-3 text-[var(--status-pending)]" />
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {exposedInputKeys.length > 0 && (
            <span className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400/80 border border-cyan-500/15 font-medium mr-1">
              <Eye className="w-2.5 h-2.5" />
              {exposedInputKeys.length} exposed
            </span>
          )}
          {!config.isPassthrough && !isRunning && (
            <button
              onClick={handleRunNode}
              className="flex items-center justify-center w-5 h-5 rounded-md text-[var(--text-muted)] hover:text-[var(--status-success)] hover:bg-[var(--status-success-bg)] transition-colors"
              title="Run this node"
            >
              <Play className="w-3 h-3" />
            </button>
          )}
          {IconComponent && (
            <IconComponent className={`w-3.5 h-3.5 ${config.ui.color}`} />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-3">
        {/* ================================================================ */}
        {/* MEDIA SOURCE AREA — Upload zone for image/video source nodes    */}
        {/* ================================================================ */}
        {isMediaSource && (
          <MediaSourceArea
            config={config}
            data={data}
            updateField={updateField}
          />
        )}

        {/* ================================================================ */}
        {/* STANDARD INPUTS — Always visible                                 */}
        {/* ================================================================ */}
        {standardInputs.map((input) => (
          <div key={input.key} className="flex flex-col gap-1.5">
            {/* Handle Row */}
            {!input.hideHandle && (
              <div className="relative flex items-center h-6 px-5 group/input">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={input.key}
                  style={{ ...HANDLE_STYLE_LEFT, ...getHandleStyle(input.type) }}
                  className={HANDLE_BASE_CLASSES}
                />
                <span className={`text-[11px] font-medium ${getDataTypeTheme(input.type).textClass}`}>
                  {input.label}
                </span>
                {connected.has(input.key) && (
                  <span className={`ml-1 text-[9px] font-medium ${getDataTypeTheme(input.type).textClass}`}>
                    ● linked
                  </span>
                )}
                {/* Expose toggle — mark this input as overridable for template execution */}
                {exposedInputKeys.includes(input.key) && (
                  <span className="ml-auto mr-1 text-[8px] px-1.5 py-0.5 rounded-md bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 font-medium">
                    Exposed
                  </span>
                )}
                <button
                  onMouseEnter={() => handleEyeHover(input.key)}
                  onClick={(e) => { e.stopPropagation(); toggleExposedKey(input.key); }}
                  className={`flex items-center justify-center w-4 h-4 rounded transition-all nodrag ${
                    exposedInputKeys.includes(input.key)
                      ? "ml-0.5 text-cyan-400 opacity-100"
                      : "ml-auto text-[var(--text-placeholder)] opacity-40 group-hover/input:opacity-70 hover:!opacity-100"
                  }`}
                  title={exposedInputKeys.includes(input.key) ? "Input exposed — click to hide" : "Expose as template input"}
                >
                  {exposedInputKeys.includes(input.key) ? (
                    <Eye className="w-3 h-3" />
                  ) : (
                    <EyeOff className="w-3 h-3" />
                  )}
                </button>
                {showExposedTipFor === input.key && (
                  <div className="absolute right-0 top-6 z-50 w-40 p-2 bg-[var(--node-bg)] border border-[var(--node-inner-border)] rounded shadow-xl flex flex-col gap-1.5 nodrag cursor-default" onClick={(e) => e.stopPropagation()}>
                    <p className="text-[10px] text-[var(--text-primary)] leading-tight">
                      Expose this input so template users can customize it at run time.
                    </p>
                    <button
                      onClick={dismissTip}
                      className="self-end text-[9px] px-1.5 py-0.5 bg-[var(--node-inner-bg)] hover:bg-[var(--node-inner-bg-hover)] text-[var(--text-primary)] rounded transition-colors"
                    >
                      Got it
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* UI Control (disabled when connected) */}
            {input.uiVariant !== "hidden" && (
              <InputControl
                input={input}
                value={data[input.key]}
                onChange={(val) => updateField(input.key, val)}
                disabled={connected.has(input.key)}
                siblingData={data}
                nodeId={id}
              />
            )}

            {/* Reorderable list for multi-inputs with 2+ connections */}
            {input.multi && connected.has(input.key) && (
              <MultiInputOrderList
                nodeId={id}
                handleKey={input.key}
                updateField={updateField}
                data={data}
              />
            )}
          </div>
        ))}

        {/* ================================================================ */}
        {/* ADVANCED SETTINGS ACCORDION                                     */}
        {/* Handles are ALWAYS rendered. Only the UI controls animate.      */}
        {/* ================================================================ */}
        {advancedInputs.length > 0 && (
          <>
            {/* Accordion toggle */}
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex items-center gap-1.5 px-5 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors nodrag group"
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform duration-200 ${advancedOpen ? "rotate-180" : ""
                  }`}
              />
              <span className="font-medium">
                {advancedOpen ? "Hide" : "Show"} Advanced
              </span>
              <span className="text-[var(--text-placeholder)] group-hover:text-[var(--text-muted)]">
                ({advancedInputs.length})
              </span>
            </button>

            {/* Advanced content — rendered outside overflow-hidden so handles aren't clipped */}
            {advancedOpen && (
              <div ref={advancedContentRef} className="flex flex-col gap-3 pb-1">
                {advancedInputs.map((input) => (
                  <div key={input.key} className="flex flex-col gap-1.5">
                    {/* Handle + label row */}
                    {!input.hideHandle && (
                      <div className="relative flex items-center h-6 px-5 group/input">
                        <Handle
                          type="target"
                          position={Position.Left}
                          id={input.key}
                          style={{ ...HANDLE_STYLE_LEFT, ...getHandleStyle(input.type) }}
                          className={HANDLE_BASE_CLASSES}
                        />
                        <span className={`text-[11px] font-medium ${getDataTypeTheme(input.type).textClass}`}>
                          {input.label}
                        </span>
                        {connected.has(input.key) && (
                          <span className={`ml-1 text-[9px] font-medium ${getDataTypeTheme(input.type).textClass}`}>
                            ● linked
                          </span>
                        )}
                        {/* Expose toggle for advanced inputs */}
                        {exposedInputKeys.includes(input.key) && (
                          <span className="ml-auto mr-1 text-[8px] px-1.5 py-0.5 rounded-md bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 font-medium">
                            Exposed
                          </span>
                        )}
                        <button
                          onMouseEnter={() => handleEyeHover(input.key)}
                          onClick={(e) => { e.stopPropagation(); toggleExposedKey(input.key); }}
                          className={`flex items-center justify-center w-4 h-4 rounded transition-all nodrag ${
                            exposedInputKeys.includes(input.key)
                              ? "ml-0.5 text-cyan-400 opacity-100"
                              : "ml-auto text-[var(--text-placeholder)] opacity-40 group-hover/input:opacity-70 hover:!opacity-100"
                          }`}
                          title={exposedInputKeys.includes(input.key) ? "Input exposed — click to hide" : "Expose as template input"}
                        >
                          {exposedInputKeys.includes(input.key) ? (
                            <Eye className="w-3 h-3" />
                          ) : (
                            <EyeOff className="w-3 h-3" />
                          )}
                        </button>
                        {showExposedTipFor === input.key && (
                          <div className="absolute right-0 top-6 z-50 w-40 p-2 bg-[var(--node-bg)] border border-[var(--node-inner-border)] rounded shadow-xl flex flex-col gap-1.5 nodrag cursor-default" onClick={(e) => e.stopPropagation()}>
                            <p className="text-[10px] text-[var(--text-primary)] leading-tight">
                              Expose this input so template users can customize it at run time.
                            </p>
                            <button
                              onClick={dismissTip}
                              className="self-end text-[9px] px-1.5 py-0.5 bg-[var(--node-inner-bg)] hover:bg-[var(--node-inner-bg-hover)] text-[var(--text-primary)] rounded transition-colors"
                            >
                              Got it
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* UI Control */}
                    <InputControl
                      input={input}
                      value={data[input.key]}
                      onChange={(val) => updateField(input.key, val)}
                      disabled={connected.has(input.key)}
                      siblingData={data}
                      nodeId={id}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Divider */}
        <div className="w-full h-[1px] bg-[var(--node-divider)]" />

        {/* ================================================================ */}
        {/* OUTPUTS — Handles on the right side                             */}
        {/* ================================================================ */}
        {config.outputs.map((output) => (
          <div
            key={output.key}
            className="relative flex items-center justify-end h-6 px-5"
          >
            <span className={`text-[11px] font-medium ${getDataTypeTheme(output.type).textClass}`}>
              {output.label}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={output.key}
              style={{ ...HANDLE_STYLE_RIGHT, ...getHandleStyle(output.type) }}
              className={HANDLE_BASE_CLASSES}
            />
          </div>
        ))}

        {/* ================================================================ */}
        {/* OUTPUT PREVIEW — Image/text/audio result display                */}
        {/* ================================================================ */}
        <OutputPreview config={config} data={data} />
      </div>
    </div>
  );
}
