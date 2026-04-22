// ============================================================================
// components/nodes/ElementsEditor.tsx — Compound Elements Editor with Handles
// ============================================================================
//
// Manages the `elements` array for the Kling O1 node, where each element
// is an OmniVideoElementInput: { frontal_image_url, reference_image_urls[] }.
//
// Each element appears as an ALWAYS-EXPANDED card with:
//   - A React Flow Handle for the frontal image (connectable from upstream)
//   - React Flow Handles for each reference image (connectable from upstream)
//   - Image upload slots that disable when handles are connected
//   - Remove button
//
// DYNAMIC HANDLES:
//   Each element renders target Handles with IDs following the pattern:
//     element_0_frontal, element_0_ref_0, element_0_ref_1, element_1_frontal, ...
//   When an upstream Image Source node is connected, the orchestrator injects
//   the value as `payload.element_N_frontal` at execution time. The orchestrator
//   reassembles these flat keys into the structured elements[] array.
//
//   The config must set `allowDynamicHandles: true` so these keys survive
//   Zod validation in the orchestrator.
//
// No hardcoded element count limit — the API enforces max 4 total
// (elements + reference images) on its own.
// ============================================================================

"use client";

import { useRef, useState, useMemo, useCallback } from "react";
import { Handle, Position } from "@xyflow/react";
import { useStore } from "@/lib/store";
import { Plus, Trash2, Upload, User, ImageIcon, Link } from "lucide-react";
import { getDataTypeTheme } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ElementData {
  frontal_image_url: string;
  reference_image_urls: string[];
}

interface ElementsEditorProps {
  value: unknown;
  onChange: (value: ElementData[]) => void;
  disabled: boolean;
  /** The parent node's ID — needed to detect per-element handle connections */
  nodeId?: string;
}

// ---------------------------------------------------------------------------
// Handle styling (matches GenericNode + DialogueEditor conventions)
// ---------------------------------------------------------------------------

const HANDLE_STYLE_LEFT = {
  left: -5,
  top: "50%",
  transform: "translateY(-50%)",
};

const imageTheme = getDataTypeTheme("image");
const IMAGE_HANDLE_STYLE: React.CSSProperties = {
  backgroundColor: imageTheme.primary,
  border: `2px solid ${imageTheme.muted}`,
  width: 10,
  height: 10,
  borderRadius: "50%",
  transition:
    "transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
  ["--handle-color" as string]: imageTheme.primary,
};

// Element accent colors (cyan for elements, matching the mention pill colors)
const ELEMENT_ACCENT = {
  badge: "rgba(6, 182, 212, 0.15)",
  text: "#22d3ee",
  border: "rgba(6, 182, 212, 0.4)",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ElementsEditor({
  value,
  onChange,
  disabled,
  nodeId,
}: ElementsEditorProps) {
  // ── Detect connected handles ───────────────────────────────────────
  const edges = useStore((state) => state.edges);
  const connectedHandles = useMemo(() => {
    if (!nodeId) return new Set<string>();
    const connected = new Set<string>();
    for (const edge of edges) {
      if (
        edge.target === nodeId &&
        edge.targetHandle?.startsWith("element_")
      ) {
        connected.add(edge.targetHandle);
      }
    }
    return connected;
  }, [edges, nodeId]);

  // Normalize value to array
  const elements: ElementData[] = useMemo(() => {
    if (Array.isArray(value)) {
      return value.filter(
        (el): el is ElementData =>
          el !== null &&
          typeof el === "object" &&
          "frontal_image_url" in el
      );
    }
    return [];
  }, [value]);

  // ── Add element ────────────────────────────────────────────────────
  const addElement = useCallback(() => {
    const newElements = [
      ...elements,
      { frontal_image_url: "", reference_image_urls: [] },
    ];
    onChange(newElements);
  }, [elements, onChange]);

  // ── Remove element ─────────────────────────────────────────────────
  const removeElement = useCallback(
    (index: number) => {
      const updated = elements.filter((_, i) => i !== index);
      onChange(updated);
    },
    [elements, onChange]
  );

  // ── Update frontal image ──────────────────────────────────────────
  const updateFrontal = useCallback(
    (index: number, url: string) => {
      const updated = elements.map((el, i) =>
        i === index ? { ...el, frontal_image_url: url } : el
      );
      onChange(updated);
    },
    [elements, onChange]
  );

  // ── Update reference images ───────────────────────────────────────
  const updateReferences = useCallback(
    (index: number, urls: string[]) => {
      const updated = elements.map((el, i) =>
        i === index ? { ...el, reference_image_urls: urls } : el
      );
      onChange(updated);
    },
    [elements, onChange]
  );

  // ── Add reference slot ────────────────────────────────────────────
  const addReferenceSlot = useCallback(
    (index: number) => {
      const updated = elements.map((el, i) =>
        i === index
          ? { ...el, reference_image_urls: [...el.reference_image_urls, ""] }
          : el
      );
      onChange(updated);
    },
    [elements, onChange]
  );

  // ── Remove reference slot ─────────────────────────────────────────
  const removeReferenceSlot = useCallback(
    (elementIndex: number, refIndex: number) => {
      const updated = elements.map((el, i) =>
        i === elementIndex
          ? {
              ...el,
              reference_image_urls: el.reference_image_urls.filter(
                (_, ri) => ri !== refIndex
              ),
            }
          : el
      );
      onChange(updated);
    },
    [elements, onChange]
  );

  return (
    <div>
      {/* Element cards */}
      <div className="flex flex-col gap-3">
        {elements.map((element, index) => {
          const frontalHandleId = `element_${index}_frontal`;
          const isFrontalConnected = connectedHandles.has(frontalHandleId);

          return (
            <div key={index} className="flex flex-col gap-1">
              {/* ── Card header ──────────────────────────────────── */}
              <div className="flex items-center gap-1.5 px-5">
                {/* Cyan element badge */}
                <span
                  className="inline-flex items-center justify-center w-4 h-4 rounded text-[8px] font-bold flex-shrink-0"
                  style={{
                    background: ELEMENT_ACCENT.badge,
                    color: ELEMENT_ACCENT.text,
                    border: `1px solid ${ELEMENT_ACCENT.border}`,
                  }}
                >
                  E{index + 1}
                </span>

                <span className="text-[10px] font-medium text-[var(--text-secondary)] flex-1">
                  Element {index + 1}
                </span>

                {/* Status indicators */}
                <span className="text-[8px] text-[var(--text-placeholder)]">
                  {element.frontal_image_url || isFrontalConnected
                    ? "✓ frontal"
                    : ""}{" "}
                  {element.reference_image_urls.filter((u) => u).length > 0
                    ? `· ${element.reference_image_urls.filter((u) => u).length} ref`
                    : ""}
                </span>

                {/* Remove */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeElement(index);
                  }}
                  disabled={disabled}
                  className="p-0.5 text-[var(--text-muted)] hover:text-[var(--status-error)] transition-colors flex-shrink-0"
                  title="Remove element"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {/* ── Frontal Image handle row (standard layout) ──── */}
              <div className="relative flex items-center h-6 px-5">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={frontalHandleId}
                  style={{
                    ...HANDLE_STYLE_LEFT,
                    ...IMAGE_HANDLE_STYLE,
                  }}
                  className="!border-none !ring-0 !transition-all"
                />
                <User className="w-3 h-3 text-cyan-400 mr-1" />
                <span className="text-[9px] font-medium text-[var(--text-muted)]">
                  Frontal Image
                </span>
                {isFrontalConnected && (
                  <span
                    className={`ml-auto text-[8px] font-medium flex items-center gap-0.5 ${imageTheme.textClass}`}
                  >
                    <Link className="w-2.5 h-2.5" />
                    linked
                  </span>
                )}
              </div>

              {/* Frontal upload slot */}
              <div className="px-5">
                <ImageUploadSlot
                  url={element.frontal_image_url}
                  onUpload={(url) => updateFrontal(index, url)}
                  onRemove={() => updateFrontal(index, "")}
                  disabled={disabled || isFrontalConnected}
                  label="frontal"
                  isLinked={isFrontalConnected}
                />
              </div>

              {/* ── Reference Images ───────────────────────────── */}
              {element.reference_image_urls.map((url, refIndex) => {
                const refHandleId = `element_${index}_ref_${refIndex}`;
                const isRefConnected = connectedHandles.has(refHandleId);

                return (
                  <div key={`ref-${refIndex}`}>
                    {/* Reference handle row (standard layout) */}
                    <div className="relative flex items-center h-6 px-5">
                      <Handle
                        type="target"
                        position={Position.Left}
                        id={refHandleId}
                        style={{
                          ...HANDLE_STYLE_LEFT,
                          ...IMAGE_HANDLE_STYLE,
                        }}
                        className="!border-none !ring-0 !transition-all"
                      />
                      <ImageIcon className="w-3 h-3 text-cyan-400 mr-1" />
                      <span className="text-[8px] text-[var(--text-muted)]">
                        Ref {refIndex + 1}
                      </span>
                      {isRefConnected && (
                        <span
                          className={`ml-auto text-[7px] font-medium flex items-center gap-0.5 ${imageTheme.textClass}`}
                        >
                          <Link className="w-2 h-2" />
                          linked
                        </span>
                      )}
                    </div>

                    {/* Reference upload slot */}
                    <div className="px-5">
                      <ImageUploadSlot
                        url={url}
                        onUpload={(newUrl) => {
                          const updated = [
                            ...element.reference_image_urls,
                          ];
                          updated[refIndex] = newUrl;
                          updateReferences(index, updated);
                        }}
                        onRemove={() =>
                          removeReferenceSlot(index, refIndex)
                        }
                        disabled={disabled || isRefConnected}
                        label={`ref ${refIndex + 1}`}
                        isLinked={isRefConnected}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Add reference slot button */}
              <div className="px-5">
                <button
                  type="button"
                  onClick={() => addReferenceSlot(index)}
                  disabled={disabled}
                  className="w-full flex items-center justify-center gap-1 py-1 border border-dashed border-[var(--node-inner-border)] rounded-md text-[8px] text-[var(--text-placeholder)] hover:text-[var(--text-muted)] hover:border-[var(--focus-ring)] transition-colors nodrag disabled:opacity-50"
                >
                  <Plus className="w-2.5 h-2.5" />
                  Add reference
                </button>
              </div>

              {/* Separator between elements */}
              {index < elements.length - 1 && (
                <div className="mx-5 border-b border-[var(--node-inner-border)] mt-1" />
              )}
            </div>
          );
        })}
      </div>

      {/* Add element button */}
      <div className="px-4">
        <button
          type="button"
          onClick={addElement}
          disabled={disabled}
          className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5 bg-[var(--node-inner-bg)] border border-dashed border-[var(--node-inner-border)] rounded-lg text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--focus-ring)] transition-colors nodrag disabled:opacity-50"
        >
          <Plus className="w-3 h-3" />
          Add Element{elements.length > 0 ? ` (${elements.length})` : ""}
        </button>
      </div>

      {/* Empty state */}
      {elements.length === 0 && (
        <p className="text-[9px] text-[var(--text-placeholder)] mt-1 px-4 text-center">
          Add elements to reference characters/objects as @Element1, @Element2
          in your prompt.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageUploadSlot — a single image upload with preview + remove
// ---------------------------------------------------------------------------

function ImageUploadSlot({
  url,
  onUpload,
  onRemove,
  disabled,
  label,
  isLinked,
}: {
  url: string;
  onUpload: (url: string) => void;
  onRemove: () => void;
  disabled: boolean;
  label: string;
  isLinked?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Upload failed");
      const { url: uploadedUrl } = await response.json();
      if (uploadedUrl) onUpload(uploadedUrl);
    } catch (err) {
      console.error("Element image upload failed:", err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (url) {
    return (
      <div
        className={`relative group rounded-md overflow-hidden bg-[var(--node-preview-bg)] border border-[var(--node-inner-border)] ${
          isLinked ? "opacity-60" : ""
        }`}
      >
        <div className="flex items-center gap-1.5 p-1">
          <div className="w-10 h-8 rounded overflow-hidden flex-shrink-0">
            <img
              src={url}
              alt={label}
              className="w-full h-full object-cover"
            />
          </div>
          <span className="text-[8px] text-[var(--text-placeholder)] truncate flex-1 font-mono">
            {url.length > 25 ? "…" + url.slice(-22) : url}
          </span>
          {!isLinked && (
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled}
              className="p-0.5 text-[var(--text-muted)] hover:text-[var(--status-error)] transition-colors opacity-0 group-hover:opacity-100"
            >
              <Trash2 className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isLinked) {
    return (
      <div className="w-full flex items-center justify-center gap-1 py-1.5 bg-[var(--node-preview-bg)] border border-[var(--node-inner-border)] rounded-md text-[9px] text-[var(--text-placeholder)] opacity-60">
        <Link className="w-2.5 h-2.5" />
        Provided by connected node
      </div>
    );
  }

  return (
    <>
      <input
        type="file"
        accept="image/*"
        className="hidden"
        ref={fileInputRef}
        onChange={handleUpload}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || isUploading}
        className="w-full flex items-center justify-center gap-1 py-1.5 bg-[var(--node-preview-bg)] border border-dashed border-[var(--node-inner-border)] rounded-md text-[9px] text-[var(--text-placeholder)] hover:text-[var(--text-muted)] hover:border-[var(--focus-ring)] transition-colors nodrag disabled:opacity-50"
      >
        {isUploading ? (
          <span className="animate-pulse">Uploading…</span>
        ) : (
          <>
            <Upload className="w-2.5 h-2.5" />
            Upload {label}
          </>
        )}
      </button>
    </>
  );
}
