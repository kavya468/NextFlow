// ============================================================================
// components/nodes/MentionTextarea.tsx — Rich Prompt with @Mention Pills
// ============================================================================
//
// A lightweight contentEditable-based textarea that supports inline @Element
// and @Image mention pills for referencing uploaded media in prompts.
//
// ARCHITECTURE:
//   - Zero external dependencies (no Draft.js, Slate, react-mentions)
//   - Pure utility functions for tokenization and serialization
//   - Controlled component: plain-text value ↔ rich DOM rendering
//   - Mention popover positioned at caret for natural @-completion UX
//
// USAGE:
//   The GenericNode renderer instantiates this when InputDefinition has
//   uiVariant: "mention-textarea" and mentionSources configured.
// ============================================================================

"use client";

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { InputDefinition } from "@/lib/nodes/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single mentionable item that can be inserted into the prompt */
export interface MentionOption {
  /** Display label, e.g. "Element1", "Image2" */
  label: string;
  /** Token written into the plain text, e.g. "@Element1" */
  token: string;
  /** Visual category for pill styling */
  category: "element" | "image";
  /** The URL this mention resolves to (for submission) */
  url: string;
}

/** A parsed segment of the prompt text */
export type MentionSegment =
  | { type: "text"; value: string }
  | { type: "mention"; token: string; category: "element" | "image" };

// ---------------------------------------------------------------------------
// Pure Utilities — no React, fully testable
// ---------------------------------------------------------------------------

/** Regex matching @Element1, @Element2, @Image1, @Image2, etc. */
const MENTION_REGEX = /@(Element|Image)(\d+)/g;

/**
 * Parse a plain-text prompt into an array of text and mention segments.
 * Pure function — no side effects.
 */
export function parseMentionTokens(text: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let lastIndex = 0;

  // Reset the regex lastIndex since it's global
  MENTION_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }

    const category = match[1].toLowerCase() as "element" | "image";
    segments.push({
      type: "mention",
      token: match[0], // e.g. "@Element1"
      category,
    });

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last match
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}

/**
 * Serialize a contentEditable element's DOM back to plain text with
 * @mention tokens preserved. Walks child nodes, extracting text nodes
 * and data-mention-token attributes from pill spans.
 */
export function serializeContentToPlainText(element: HTMLElement): string {
  let result = "";

  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent || "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const mentionToken = el.getAttribute("data-mention-token");
      if (mentionToken) {
        result += mentionToken;
      } else if (el.tagName === "BR") {
        result += "\n";
      } else {
        // Recurse into nested elements (e.g., <div> line breaks)
        result += serializeContentToPlainText(el);
        // contentEditable wraps new lines in divs
        if (el.tagName === "DIV" && result.length > 0 && !result.endsWith("\n")) {
          result += "\n";
        }
      }
    }
  }

  return result;
}

/**
 * Build the list of available mention options from sibling input data.
 * Scans elementKeys and imageKeys, generates sequential labels.
 */
export function buildMentionOptions(
  mentionSources: NonNullable<InputDefinition["mentionSources"]>,
  siblingData: Record<string, unknown>
): MentionOption[] {
  const options: MentionOption[] = [];

  // Elements: read from the compound elements array (each entry = @Element1, @Element2, etc.)
  // Falls back to checking dynamic handle keys (element_N_frontal) when the array is empty
  let elementIndex = 1;
  if (mentionSources.elementsKey) {
    const elementsData = siblingData[mentionSources.elementsKey];
    if (Array.isArray(elementsData)) {
      for (const element of elementsData) {
        if (
          element &&
          typeof element === "object" &&
          "frontal_image_url" in element
        ) {
          const url = (element as Record<string, unknown>).frontal_image_url;
          options.push({
            label: `Element${elementIndex}`,
            token: `@Element${elementIndex}`,
            category: "element",
            url: typeof url === "string" && url.length > 0 ? url : "(linked)",
          });
          elementIndex++;
        }
      }
    }

    // Fallback: check for dynamic handle keys (element_0_frontal, element_1_frontal, ...)
    // These exist when upstream nodes are connected to per-element handles
    if (elementIndex === 1) {
      for (let i = 0; i < 10; i++) {
        const dynamicKey = `element_${i}_frontal`;
        const dynamicUrl = siblingData[dynamicKey];
        if (typeof dynamicUrl === "string" && dynamicUrl.length > 0) {
          options.push({
            label: `Element${elementIndex}`,
            token: `@Element${elementIndex}`,
            category: "element",
            url: dynamicUrl,
          });
          elementIndex++;
        } else if (!siblingData.hasOwnProperty(dynamicKey)) {
          // Stop scanning once we hit a gap (no element at this index)
          break;
        }
      }
    }
  }

  // Images: keys can be single string or array (multi: true)
  let imageIndex = 1;
  for (const key of mentionSources.imageKeys) {
    const value = siblingData[key];
    if (Array.isArray(value)) {
      for (const url of value) {
        if (typeof url === "string" && url.length > 0) {
          options.push({
            label: `Image${imageIndex}`,
            token: `@Image${imageIndex}`,
            category: "image",
            url,
          });
          imageIndex++;
        }
      }
    } else if (typeof value === "string" && value.length > 0) {
      options.push({
        label: `Image${imageIndex}`,
        token: `@Image${imageIndex}`,
        category: "image",
        url: value,
      });
      imageIndex++;
    }
  }

  return options;
}

// ---------------------------------------------------------------------------
// Pill styling constants
// ---------------------------------------------------------------------------
const PILL_STYLES: Record<"element" | "image", {
  bg: string;
  border: string;
  text: string;
}> = {
  element: {
    bg: "rgba(6, 182, 212, 0.15)",
    border: "1px solid rgba(6, 182, 212, 0.4)",
    text: "#22d3ee",
  },
  image: {
    bg: "rgba(236, 72, 153, 0.15)",
    border: "1px solid rgba(236, 72, 153, 0.4)",
    text: "#f472b6",
  },
};

// ---------------------------------------------------------------------------
// MentionTextarea Component
// ---------------------------------------------------------------------------

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placeholder?: string;
  mentionSources?: InputDefinition["mentionSources"];
  siblingData: Record<string, unknown>;
}

export function MentionTextarea({
  value,
  onChange,
  disabled,
  placeholder,
  mentionSources,
  siblingData,
}: MentionTextareaProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [showPopover, setShowPopover] = useState(false);
  const [popoverFilter, setPopoverFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Track if we're programmatically updating DOM to skip the input handler
  const isUpdatingRef = useRef(false);
  // Track the range where @ was typed for replacement
  const mentionStartRef = useRef<{ node: Node; offset: number } | null>(null);

  // ── Build available mentions from sibling data ─────────────────────
  const availableMentions = useMemo(() => {
    if (!mentionSources) return [];
    return buildMentionOptions(mentionSources, siblingData);
  }, [mentionSources, siblingData]);

  // ── Filter mentions by search text ────────────────────────────────
  const filteredMentions = useMemo(() => {
    if (!popoverFilter) return availableMentions;
    const lower = popoverFilter.toLowerCase();
    return availableMentions.filter((m) =>
      m.label.toLowerCase().includes(lower)
    );
  }, [availableMentions, popoverFilter]);

  // ── Render value → DOM (controlled sync) ──────────────────────────
  useEffect(() => {
    const el = editorRef.current;
    if (!el || isUpdatingRef.current) return;

    // Serialize current DOM to compare with incoming value
    const currentText = serializeContentToPlainText(el);
    if (currentText === value) return;

    // Rebuild DOM from the incoming plain-text value
    const segments = parseMentionTokens(value);
    const fragment = document.createDocumentFragment();

    for (const segment of segments) {
      if (segment.type === "text") {
        // Handle newlines → <br>
        const lines = segment.value.split("\n");
        lines.forEach((line, i) => {
          if (i > 0) fragment.appendChild(document.createElement("br"));
          if (line.length > 0) {
            fragment.appendChild(document.createTextNode(line));
          }
        });
      } else {
        const pill = createPillElement(segment.token, segment.category);
        fragment.appendChild(pill);
      }
    }

    el.innerHTML = "";
    el.appendChild(fragment);
  }, [value]);

  // ── Create a pill span element ────────────────────────────────────
  function createPillElement(token: string, category: "element" | "image"): HTMLSpanElement {
    const pill = document.createElement("span");
    pill.setAttribute("data-mention-token", token);
    pill.setAttribute("contenteditable", "false");
    pill.textContent = token;

    const style = PILL_STYLES[category];
    pill.style.cssText = `
      display: inline-block;
      background: ${style.bg};
      border: ${style.border};
      color: ${style.text};
      border-radius: 4px;
      padding: 0 4px;
      margin: 0 1px;
      font-size: 10px;
      font-weight: 600;
      line-height: 18px;
      vertical-align: baseline;
      cursor: default;
      user-select: none;
      white-space: nowrap;
    `;

    return pill;
  }

  // ── Insert a mention pill at the current cursor position ──────────
  const insertMention = useCallback(
    (mention: MentionOption) => {
      const el = editorRef.current;
      if (!el) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      isUpdatingRef.current = true;

      // Delete the @trigger text
      const range = selection.getRangeAt(0);

      if (mentionStartRef.current) {
        // Create a range from the @ character to current cursor
        const deleteRange = document.createRange();
        try {
          deleteRange.setStart(
            mentionStartRef.current.node,
            mentionStartRef.current.offset
          );
          deleteRange.setEnd(range.startContainer, range.startOffset);
          deleteRange.deleteContents();
        } catch {
          // If the nodes have been modified, fall back
        }
      }

      // Insert the pill
      const pill = createPillElement(mention.token, mention.category);
      const spaceAfter = document.createTextNode("\u00A0"); // nbsp for cursor placement

      const insertRange = selection.getRangeAt(0);
      insertRange.insertNode(spaceAfter);
      insertRange.insertNode(pill);

      // Move cursor after the space
      const newRange = document.createRange();
      newRange.setStartAfter(spaceAfter);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);

      // Sync back to plain text
      const newText = serializeContentToPlainText(el);
      onChange(newText);

      // Close popover
      setShowPopover(false);
      setPopoverFilter("");
      mentionStartRef.current = null;

      // Small delay to let React re-render before clearing the flag
      requestAnimationFrame(() => {
        isUpdatingRef.current = false;
      });
    },
    [onChange]
  );

  // ── Handle input events from contentEditable ──────────────────────
  const handleInput = useCallback(() => {
    if (isUpdatingRef.current) return;
    const el = editorRef.current;
    if (!el) return;

    const plainText = serializeContentToPlainText(el);
    onChange(plainText);

    // Check if we should show the mention popover
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return;

    const text = textNode.textContent || "";
    const cursorPos = range.startOffset;

    // Find the last @ before cursor in this text node
    const textBeforeCursor = text.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    if (atIndex >= 0) {
      const textAfterAt = textBeforeCursor.slice(atIndex + 1);
      // Only show popover if the text after @ looks like a partial mention
      // (no spaces, reasonable length)
      if (textAfterAt.length <= 15 && !/\s/.test(textAfterAt)) {
        mentionStartRef.current = { node: textNode, offset: atIndex };
        setPopoverFilter(textAfterAt);
        setShowPopover(true);
        setSelectedIndex(0);
        return;
      }
    }

    // Close popover if conditions aren't met
    if (showPopover) {
      setShowPopover(false);
      setPopoverFilter("");
      mentionStartRef.current = null;
    }
  }, [onChange, showPopover]);

  // ── Keyboard navigation in the popover ────────────────────────────
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!showPopover || filteredMentions.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) =>
            i < filteredMentions.length - 1 ? i + 1 : 0
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) =>
            i > 0 ? i - 1 : filteredMentions.length - 1
          );
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          insertMention(filteredMentions[selectedIndex]);
          break;
        case "Escape":
          e.preventDefault();
          setShowPopover(false);
          setPopoverFilter("");
          mentionStartRef.current = null;
          break;
      }
    },
    [showPopover, filteredMentions, selectedIndex, insertMention]
  );

  // ── Close popover on outside click ────────────────────────────────
  useEffect(() => {
    if (!showPopover) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        editorRef.current &&
        !editorRef.current.contains(e.target as Node)
      ) {
        setShowPopover(false);
        setPopoverFilter("");
        mentionStartRef.current = null;
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPopover]);

  // ── Render ────────────────────────────────────────────────────────
  const isEmpty = !value || value.length === 0;

  return (
    <div className="px-4 relative">
      {/* The editable area */}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        className={`w-full bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg p-2.5 text-[11px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--focus-ring)] min-h-[5rem] max-h-[10rem] overflow-y-auto whitespace-pre-wrap break-words nodrag transition-colors node-scrollbar ${
          disabled ? "opacity-50 cursor-not-allowed" : ""
        }`}
        style={{ lineHeight: "1.6" }}
        role="textbox"
        aria-multiline="true"
        aria-placeholder={placeholder}
      />

      {/* Placeholder overlay */}
      {isEmpty && !disabled && (
        <div
          className="absolute left-[calc(1rem+10px)] top-[10px] text-[11px] text-[var(--text-placeholder)] pointer-events-none select-none"
          aria-hidden="true"
        >
          {placeholder || "Type @ to reference media..."}
        </div>
      )}

      {/* Hint text */}
      <p className="text-[9px] text-[var(--text-placeholder)] mt-1 px-0.5">
        Type <span className="font-mono text-[var(--text-muted)]">@</span> to reference relevant media.
      </p>

      {/* Mention popover */}
      {showPopover && filteredMentions.length > 0 && (
        <div
          ref={popoverRef}
          className="absolute left-4 right-4 z-50 mt-1 bg-[var(--node-bg)] border border-[var(--node-inner-border)] rounded-lg shadow-xl overflow-hidden"
          style={{ bottom: "auto" }}
        >
          <div className="py-1">
            {filteredMentions.map((mention, index) => {
              const style = PILL_STYLES[mention.category];
              return (
                <button
                  key={mention.token}
                  type="button"
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors nodrag ${
                    index === selectedIndex
                      ? "bg-[var(--node-inner-bg-hover)]"
                      : "hover:bg-[var(--node-inner-bg)]"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault(); // Prevent blur on the editor
                    insertMention(mention);
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  {/* Category badge */}
                  <span
                    className="inline-flex items-center justify-center w-5 h-5 rounded text-[9px] font-bold"
                    style={{
                      background: style.bg,
                      color: style.text,
                      border: style.border,
                    }}
                  >
                    {mention.category === "element" ? "E" : "I"}
                  </span>

                  {/* Label */}
                  <span
                    className="text-[11px] font-medium"
                    style={{ color: style.text }}
                  >
                    {mention.token}
                  </span>

                  {/* URL preview */}
                  <span className="text-[8px] text-[var(--text-placeholder)] truncate flex-1 text-right font-mono">
                    {mention.url.length > 30
                      ? "…" + mention.url.slice(-25)
                      : mention.url}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Footer hint */}
          <div className="flex items-center gap-2 px-3 py-1 border-t border-[var(--node-inner-border)]">
            <span className="text-[8px] text-[var(--text-placeholder)]">
              ↑↓ navigate · Enter select · Esc dismiss
            </span>
          </div>
        </div>
      )}

      {/* Empty state: no media uploaded */}
      {showPopover && availableMentions.length === 0 && (
        <div
          ref={popoverRef}
          className="absolute left-4 right-4 z-50 mt-1 bg-[var(--node-bg)] border border-[var(--node-inner-border)] rounded-lg shadow-xl overflow-hidden"
        >
          <div className="px-3 py-2.5 text-center">
            <p className="text-[10px] text-[var(--text-muted)]">
              No media uploaded yet
            </p>
            <p className="text-[8px] text-[var(--text-placeholder)] mt-0.5">
              Add images to Reference Images or Frontal Image first
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
