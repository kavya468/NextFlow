// ============================================================================
// components/nodes/DialogueEditor.tsx — ElevenLabs Dialogue Editor
// ============================================================================
//
// Structured editor for multi-speaker dialogue blocks. Replaces the raw JSON
// textarea with a user-friendly form where each dialogue line has:
//   - A text textarea (what the speaker says)
//   - A voice dropdown (which ElevenLabs V3 voice to use)
//   - A React Flow Handle for connecting a Text node to this line's text
//   - Remove button + Add Dialogue Line button
//
// DATA FLOW:
//   The component receives `value` as a JSON string (or parsed array) of
//   DialogueBlock objects: [{ voice: string, text: string }, ...]
//   On any change, it serializes the array back to a JSON string and calls
//   `onChange(jsonString)` — matching the existing pipeline where the task
//   parses the JSON string on the backend.
//
// DYNAMIC HANDLES:
//   Each dialogue line renders a target Handle with ID `dialogue_text_{index}`.
//   When a Text node is connected, the orchestrator injects the upstream value
//   as `payload.dialogue_text_{index}` at execution time. The task merges
//   these values into the inputs array before processing.
//
//   The config must set `allowDynamicHandles: true` so these keys survive
//   Zod validation in the orchestrator.
// ============================================================================

"use client";

import { useCallback, useMemo, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { useStore } from "@/lib/store";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Mic,
  Link,
} from "lucide-react";
import { getDataTypeTheme } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DialogueBlock {
  voice: string;
  text: string;
}

interface DialogueEditorProps {
  value: unknown;
  onChange: (value: string) => void;
  disabled: boolean;
  /** The parent node's ID — needed to detect per-line handle connections */
  nodeId?: string;
}

// ---------------------------------------------------------------------------
// ElevenLabs V3 Voice Catalogue
// These are the known voices available on the fal.ai ElevenLabs V3 proxy.
// The "Custom" option allows entering any voice name for future compatibility.
// ---------------------------------------------------------------------------

const ELEVENLABS_VOICES: Array<{ label: string; value: string }> = [
  { label: "Aria (Female, warm)", value: "Aria" },
  { label: "Charlotte (Female, clear)", value: "Charlotte" },
  { label: "Sarah (Female, gentle)", value: "Sarah" },
  { label: "Laura (Female, expressive)", value: "Laura" },
  { label: "Lily (Female, bright)", value: "Lily" },
  { label: "River (Male, deep)", value: "River" },
  { label: "Roger (Male, authoritative)", value: "Roger" },
  { label: "Charlie (Male, friendly)", value: "Charlie" },
  { label: "George (Male, mature)", value: "George" },
  { label: "Callum (Male, young)", value: "Callum" },
  { label: "Liam (Male, neutral)", value: "Liam" },
  { label: "Daniel (Male, professional)", value: "Daniel" },
];

// Accent colors for speaker lines — visually distinguish speakers
const SPEAKER_ACCENTS = [
  { badge: "rgba(168, 85, 247, 0.15)", text: "#c084fc", border: "rgba(168, 85, 247, 0.4)" },
  { badge: "rgba(6, 182, 212, 0.15)", text: "#22d3ee", border: "rgba(6, 182, 212, 0.4)" },
  { badge: "rgba(251, 146, 60, 0.15)", text: "#fb923c", border: "rgba(251, 146, 60, 0.4)" },
  { badge: "rgba(52, 211, 153, 0.15)", text: "#34d399", border: "rgba(52, 211, 153, 0.4)" },
  { badge: "rgba(248, 113, 113, 0.15)", text: "#f87171", border: "rgba(248, 113, 113, 0.4)" },
  { badge: "rgba(96, 165, 250, 0.15)", text: "#60a5fa", border: "rgba(96, 165, 250, 0.4)" },
];

// Handle styling (matches GenericNode handle conventions)
const HANDLE_STYLE_LEFT = {
  left: -5,
  top: "50%",
  transform: "translateY(-50%)",
};

const textTheme = getDataTypeTheme("text");
const TEXT_HANDLE_STYLE: React.CSSProperties = {
  backgroundColor: textTheme.primary,
  border: `2px solid ${textTheme.muted}`,
  width: 10,
  height: 10,
  borderRadius: "50%",
  transition: "transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
  ["--handle-color" as string]: textTheme.primary,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DialogueEditor({
  value,
  onChange,
  disabled,
  nodeId,
}: DialogueEditorProps) {
  // ── Detect connected handles ───────────────────────────────────────
  const edges = useStore((state) => state.edges);
  const connectedHandles = useMemo(() => {
    if (!nodeId) return new Set<string>();
    const connected = new Set<string>();
    for (const edge of edges) {
      if (edge.target === nodeId && edge.targetHandle?.startsWith("dialogue_text_")) {
        connected.add(edge.targetHandle);
      }
    }
    return connected;
  }, [edges, nodeId]);

  // ── Parse value into DialogueBlock[] ────────────────────────────────
  const blocks: DialogueBlock[] = useMemo(() => {
    if (Array.isArray(value)) {
      return value.filter(
        (b): b is DialogueBlock =>
          b !== null &&
          typeof b === "object" &&
          "voice" in b &&
          "text" in b
      );
    }
    if (typeof value === "string" && value.trim().length > 0) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (b: any): b is DialogueBlock =>
              b !== null &&
              typeof b === "object" &&
              typeof b.voice === "string" &&
              typeof b.text === "string"
          );
        }
      } catch {
        // Invalid JSON — start fresh
      }
    }
    return [];
  }, [value]);

  const [expandedIndex, setExpandedIndex] = useState<number | null>(
    blocks.length > 0 ? 0 : null
  );

  // Track which lines use custom voice names
  const [customVoiceFlags, setCustomVoiceFlags] = useState<
    Record<number, boolean>
  >({});

  // ── Serialization helper ───────────────────────────────────────────
  const emitChange = useCallback(
    (newBlocks: DialogueBlock[]) => {
      onChange(JSON.stringify(newBlocks));
    },
    [onChange]
  );

  // ── CRUD operations ────────────────────────────────────────────────

  const addLine = useCallback(() => {
    const newBlocks = [
      ...blocks,
      { voice: "Aria", text: "" },
    ];
    emitChange(newBlocks);
    setExpandedIndex(newBlocks.length - 1);
  }, [blocks, emitChange]);

  const removeLine = useCallback(
    (index: number) => {
      const updated = blocks.filter((_, i) => i !== index);
      emitChange(updated);
      // Clean up custom voice flag
      setCustomVoiceFlags((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      // Adjust expanded index
      if (expandedIndex === index) {
        setExpandedIndex(
          updated.length > 0
            ? Math.min(index, updated.length - 1)
            : null
        );
      } else if (expandedIndex !== null && expandedIndex > index) {
        setExpandedIndex(expandedIndex - 1);
      }
    },
    [blocks, emitChange, expandedIndex]
  );

  const updateText = useCallback(
    (index: number, text: string) => {
      const updated = blocks.map((b, i) =>
        i === index ? { ...b, text } : b
      );
      emitChange(updated);
    },
    [blocks, emitChange]
  );

  const updateVoice = useCallback(
    (index: number, voice: string) => {
      const updated = blocks.map((b, i) =>
        i === index ? { ...b, voice } : b
      );
      emitChange(updated);
    },
    [blocks, emitChange]
  );

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="px-4">
      {/* Dialogue line cards */}
      <div className="flex flex-col gap-1.5">
        {blocks.map((block, index) => {
          const accent = SPEAKER_ACCENTS[index % SPEAKER_ACCENTS.length];
          const isExpanded = expandedIndex === index;
          const isKnownVoice = ELEVENLABS_VOICES.some(
            (v) => v.value === block.voice
          );
          const isCustom = customVoiceFlags[index] || !isKnownVoice;
          const handleId = `dialogue_text_${index}`;
          const isTextConnected = connectedHandles.has(handleId);

          return (
            <div key={index} className="relative">
              {/* ── Per-line text handle (ALWAYS VISIBLE) ──────────────────── */}
              <Handle
                type="target"
                position={Position.Left}
                id={handleId}
                style={{
                  ...HANDLE_STYLE_LEFT,
                  ...TEXT_HANDLE_STYLE,
                  left: -21, // Aligns with the node's left edge (-16px padding - 5px handle offset)
                }}
                className="!border-none !ring-0 !transition-all"
              />
              <div className="bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg overflow-hidden">
                {/* ── Card header ──────────────────────────────────── */}
              <button
                type="button"
                onClick={() =>
                  setExpandedIndex(isExpanded ? null : index)
                }
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-[var(--node-inner-bg-hover)] transition-colors nodrag"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />
                )}

                {/* Speaker badge */}
                <span
                  className="inline-flex items-center justify-center w-4 h-4 rounded text-[8px] font-bold flex-shrink-0"
                  style={{
                    background: accent.badge,
                    color: accent.text,
                    border: `1px solid ${accent.border}`,
                  }}
                >
                  {index + 1}
                </span>

                {/* Voice name */}
                <span className="text-[10px] font-medium text-[var(--text-secondary)] truncate flex-1">
                  {block.voice || "Select voice"}
                </span>

                {/* Connection indicator */}
                {isTextConnected && (
                  <span className={`text-[8px] font-medium ${textTheme.textClass}`}>
                    ● linked
                  </span>
                )}

                {/* Text preview (collapsed) */}
                {!isExpanded && !isTextConnected && block.text && (
                  <span className="text-[8px] text-[var(--text-placeholder)] truncate max-w-[80px]">
                    {block.text.slice(0, 30)}
                    {block.text.length > 30 ? "…" : ""}
                  </span>
                )}

                {/* Remove button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeLine(index);
                  }}
                  disabled={disabled}
                  className="p-0.5 text-[var(--text-muted)] hover:text-[var(--status-error)] transition-colors flex-shrink-0"
                  title="Remove line"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </button>

              {/* ── Expanded content ─────────────────────────────── */}
              {isExpanded && (
                <div className="px-2.5 pb-2.5 flex flex-col gap-2 border-t border-[var(--node-inner-border)]">
                  {/* Voice selector */}
                  <div className="mt-2">
                    <div className="flex items-center gap-1 mb-1">
                      <Mic
                        className="w-3 h-3"
                        style={{ color: accent.text }}
                      />
                      <span className="text-[9px] font-medium text-[var(--text-muted)]">
                        Voice
                      </span>
                    </div>

                    {isCustom ? (
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={block.voice}
                          onChange={(e) =>
                            updateVoice(index, e.target.value)
                          }
                          disabled={disabled}
                          placeholder="Custom voice name…"
                          className="flex-1 bg-[var(--node-preview-bg)] border border-[var(--node-inner-border)] rounded-md px-2 py-1 text-[10px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] placeholder:text-[var(--text-placeholder)] nodrag"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setCustomVoiceFlags((prev) => ({
                              ...prev,
                              [index]: false,
                            }));
                            updateVoice(index, "Aria");
                          }}
                          disabled={disabled}
                          className="text-[8px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-1.5 py-1 rounded-md bg-[var(--node-preview-bg)] border border-[var(--node-inner-border)] nodrag"
                        >
                          Preset
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <select
                          value={block.voice}
                          onChange={(e) =>
                            updateVoice(index, e.target.value)
                          }
                          disabled={disabled}
                          className="flex-1 bg-[var(--node-preview-bg)] border border-[var(--node-inner-border)] rounded-md px-2 py-1 text-[10px] text-[var(--text-primary)] focus:outline-none cursor-pointer nodrag"
                        >
                          {ELEVENLABS_VOICES.map((v) => (
                            <option key={v.value} value={v.value}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            setCustomVoiceFlags((prev) => ({
                              ...prev,
                              [index]: true,
                            }))
                          }
                          disabled={disabled}
                          className="text-[8px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-1.5 py-1 rounded-md bg-[var(--node-preview-bg)] border border-[var(--node-inner-border)] nodrag"
                          title="Enter a custom voice name"
                        >
                          Custom
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Text input */}
                  <div>
                    <div className="relative flex items-center gap-1 mb-1">
                      <MessageSquare
                        className="w-3 h-3"
                        style={{ color: accent.text }}
                      />
                      <span className="text-[9px] font-medium text-[var(--text-muted)]">
                        Text
                      </span>

                      {isTextConnected && (
                        <span className={`ml-auto text-[8px] font-medium flex items-center gap-0.5 ${textTheme.textClass}`}>
                          <Link className="w-2.5 h-2.5" />
                          from node
                        </span>
                      )}
                    </div>
                    <textarea
                      value={block.text}
                      onChange={(e) =>
                        updateText(index, e.target.value)
                      }
                      disabled={disabled || isTextConnected}
                      placeholder={
                        isTextConnected
                          ? "Text provided by connected node…"
                          : "Enter dialogue text… Use [applause], [laughs], [excited] for effects."
                      }
                      className={`w-full bg-[var(--node-preview-bg)] border border-[var(--node-inner-border)] rounded-md p-2 text-[10px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] resize-none h-16 placeholder:text-[var(--text-placeholder)] nodrag transition-colors ${
                        isTextConnected ? "opacity-60 cursor-not-allowed" : ""
                      }`}
                    />
                  </div>
                </div>
              )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add dialogue line button */}
      <button
        type="button"
        onClick={addLine}
        disabled={disabled}
        className="w-full mt-1.5 flex items-center justify-center gap-1.5 py-1.5 bg-[var(--node-inner-bg)] border border-dashed border-[var(--node-inner-border)] rounded-lg text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--focus-ring)] transition-colors nodrag disabled:opacity-50"
      >
        <Plus className="w-3 h-3" />
        Add Dialogue Line
        {blocks.length > 0 ? ` (${blocks.length})` : ""}
      </button>

      {/* Empty state */}
      {blocks.length === 0 && (
        <p className="text-[9px] text-[var(--text-placeholder)] mt-1 px-0.5 text-center">
          Add dialogue lines with voice and text for each speaker.
          Connect Text nodes to individual lines for dynamic text.
        </p>
      )}
    </div>
  );
}
