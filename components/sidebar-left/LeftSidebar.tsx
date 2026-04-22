"use client";

import { UserButton } from "@clerk/nextjs";
import { PanelLeftClose, Settings, BookOpen } from "lucide-react";
import { useState, useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs"; // side-effect: registers all configs

// ============================================================================
// Lucide icon SVGs — used for sidebar palette items.
//
// We define these inline rather than importing from lucide-react to keep
// the sidebar self-contained and avoid loading the entire icon library.
// Each icon maps to a NodeConfig.icon string from the registry.
// ============================================================================
const ICON_COMPONENTS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  Type: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" x2="15" y1="20" y2="20" />
      <line x1="12" x2="12" y1="4" y2="20" />
    </svg>
  ),
  Image: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  ),
  Video: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.934a.5.5 0 0 0-.777-.416L16 11" />
      <rect width="14" height="14" x="2" y="5" rx="2" ry="2" />
    </svg>
  ),
  Bot: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  ),
  Crop: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </svg>
  ),
  Scissors: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" x2="8.12" y1="4" y2="15.88" />
      <line x1="14.47" x2="20" y1="14.48" y2="20" />
      <line x1="8.12" x2="12" y1="8.12" y2="12" />
    </svg>
  ),
  Sparkles: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  ),
  Music: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  ),
  Mic: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  ),
  Film: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M7 3v18" />
      <path d="M17 3v18" />
      <path d="M3 7h4" />
      <path d="M17 7h4" />
      <path d="M3 12h18" />
      <path d="M3 17h4" />
      <path d="M17 17h4" />
    </svg>
  ),
  Merge: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m8 6 4-4 4 4" />
      <path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22" />
      <path d="m20 22-5-5" />
    </svg>
  ),
  AudioLines: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 10v3" />
      <path d="M6 6v11" />
      <path d="M10 3v18" />
      <path d="M14 8v7" />
      <path d="M18 5v13" />
      <path d="M22 10v3" />
    </svg>
  ),
  Wand2: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z" />
      <path d="m14 7 3 3" />
      <path d="M5 6v4" />
      <path d="M19 14v4" />
      <path d="M10 2v2" />
      <path d="M7 8H3" />
      <path d="M21 16h-4" />
      <path d="M11 3H9" />
    </svg>
  ),
  StickyNote: (props) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z" />
      <path d="M15 3v4a2 2 0 0 0 2 2h4" />
    </svg>
  ),
};

// ---------------------------------------------------------------------------
// Category display names and ordering
// ---------------------------------------------------------------------------
const CATEGORY_LABELS: Record<string, string> = {
  input: "Inputs",
  ai: "AI Models",
  logic: "Logic",
  media: "Media Tools",
  utility: "Utilities",
};

const CATEGORY_ORDER = ["input", "ai", "logic", "media", "utility"];

// ---------------------------------------------------------------------------
// Fallback SVG for icons not found in the map
// ---------------------------------------------------------------------------
function FallbackIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export function LeftSidebar() {
  const [isOpen, setIsOpen] = useState(true);

  // -------------------------------------------------------------------------
  // Read palette entries from the registry, grouped by category.
  // useMemo ensures we only recompute when the registry changes.
  // -------------------------------------------------------------------------
  const paletteByCategory = useMemo(() => {
    return nodeRegistry.getPaletteByCategory();
  }, []);

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onClickAddNode = (nodeType: string) => {
    const nodes = useStore.getState().nodes;
    const setNodes = useStore.getState().setNodes;

    const offset = (nodes.length % 10) * 20;
    const position = { x: 300 + offset, y: 200 + offset };

    const newNode = {
      id: crypto.randomUUID(),
      type: nodeType,
      position,
      data: {},
    };

    useStore.getState().takeSnapshot();
    setNodes(nodes.concat(newNode));
  };

  const onClickAddNote = () => {
    const nodes = useStore.getState().nodes;
    const setNodes = useStore.getState().setNodes;

    const offset = (nodes.length % 10) * 20;
    const position = { x: 300 + offset, y: 200 + offset };

    const newNode = {
      id: crypto.randomUUID(),
      type: "note",
      position,
      data: { text: "New Note..." },
    };

    useStore.getState().takeSnapshot();
    setNodes(nodes.concat(newNode));
  };

  return (
    <div className={`flex flex-col h-full border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] transition-all duration-300 ease-in-out ${isOpen ? 'w-64' : 'w-[72px]'}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 h-[60px]">
        {isOpen ? (
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-5 h-5 rounded-[4px] border border-[var(--border-muted)] grid grid-cols-2 gap-[2px] p-[3px] shrink-0">
              <div className="bg-[var(--text-muted)] rounded-[1px]"></div>
              <div className="bg-[var(--text-muted)] rounded-[1px]"></div>
              <div className="bg-[var(--text-muted)] rounded-[1px]"></div>
              <div className="bg-[var(--text-muted)] rounded-[1px]"></div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="mx-auto grid grid-cols-2 gap-[2px] p-[3px] w-5 h-5 shrink-0"
          >
            <div className="bg-[var(--text-muted)] rounded-[1px]"></div>
            <div className="bg-[var(--text-muted)] rounded-[1px]"></div>
            <div className="bg-[var(--text-muted)] rounded-[1px]"></div>
            <div className="bg-[var(--text-muted)] rounded-[1px]"></div>
          </button>
        )}

        {isOpen && (
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-1.5 rounded-md hover:bg-[var(--sidebar-item-hover)] text-[var(--sidebar-icon)] hover:text-[var(--text-primary)] transition-colors"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ================================================================== */}
      {/* Node Palette — dynamically generated from NodeRegistry              */}
      {/* ================================================================== */}
      <div className="flex-1 overflow-y-auto p-3 hide-scrollbar pt-4">
        {CATEGORY_ORDER.map((category) => {
          const entries = paletteByCategory[category];
          if (!entries || entries.length === 0) return null;

          return (
            <div key={category} className="mb-4">
              {/* Category label */}
              {isOpen && (
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-placeholder)] mb-2 ml-3">
                  {CATEGORY_LABELS[category] || category}
                </h3>
              )}

              <div className="space-y-0.5">
                {entries.map((entry) => {
                  const IconComponent = ICON_COMPONENTS[entry.icon] || FallbackIcon;

                  return (
                    <button
                      key={entry.type}
                      draggable
                      onDragStart={(e) => onDragStart(e, entry.type)}
                      onClick={() => onClickAddNode(entry.type)}
                      className={`flex items-center gap-3 w-full rounded-lg hover:bg-[var(--sidebar-item-hover)] transition-all text-[var(--sidebar-icon)] hover:text-[var(--text-primary)] cursor-grab active:cursor-grabbing group ${
                        !isOpen ? "p-3 justify-center" : "px-3 py-2"
                      }`}
                      title={!isOpen ? entry.label : entry.description}
                    >
                      <IconComponent className="w-[16px] h-[16px] shrink-0 pointer-events-none opacity-70 group-hover:opacity-100 transition-opacity" />
                      {isOpen && (
                        <span className="text-[13px] font-medium tracking-wide pointer-events-none">
                          {entry.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ================================================================== */}
      {/* Sticky Note — visual-only annotation node (not in registry)       */}
      {/* ================================================================== */}
      <div className="px-3 pb-3">
        {isOpen && (
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-placeholder)] mb-2 ml-3">
            Annotate
          </h3>
        )}
        <button
          draggable
          onDragStart={(e) => onDragStart(e, "note")}
          onClick={() => onClickAddNote()}
          className={`flex items-center gap-3 w-full rounded-lg hover:bg-[var(--sidebar-item-hover)] transition-all text-[var(--sidebar-icon)] hover:text-[var(--text-primary)] cursor-grab active:cursor-grabbing group ${
            !isOpen ? "p-3 justify-center" : "px-3 py-2"
          }`}
          title={!isOpen ? "Sticky Note" : "Add a comment or note to the canvas"}
        >
          {(() => {
            const Icon = ICON_COMPONENTS.StickyNote;
            return <Icon className="w-[16px] h-[16px] shrink-0 pointer-events-none opacity-70 group-hover:opacity-100 transition-opacity" />;
          })()}
          {isOpen && (
            <span className="text-[13px] font-medium tracking-wide pointer-events-none">
              Sticky Note
            </span>
          )}
        </button>
      </div>

      {/* Account footer */}
      <div className="p-4 border-t border-[var(--sidebar-border)] flex flex-col gap-3 min-h-[72px]">
        <div className={`flex items-center ${!isOpen ? 'justify-center' : 'justify-between'}`}>
          <div className={`flex items-center gap-3 ${!isOpen ? 'mx-auto' : ''}`}>
            <UserButton />
            {isOpen && <span className="text-sm font-medium text-[var(--text-primary)]">Account</span>}
          </div>
          {isOpen && (
            <div className="flex items-center gap-1">
              <a
                href="https://galaxyai-e8601724.mintlify.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-md hover:bg-[var(--sidebar-item-hover)] text-[var(--sidebar-icon)] hover:text-[var(--text-primary)] transition-colors"
                title="API Docs"
              >
                <BookOpen className="w-4 h-4" />
              </a>
              <Link
                href="/settings/api-keys"
                className="p-1.5 rounded-md hover:bg-[var(--sidebar-item-hover)] text-[var(--sidebar-icon)] hover:text-[var(--text-primary)] transition-colors"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </Link>
            </div>
          )}
        </div>
        {!isOpen && (
          <>
            <a
              href="https://galaxyai-e8601724.mintlify.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md hover:bg-[var(--sidebar-item-hover)] text-[var(--sidebar-icon)] hover:text-[var(--text-primary)] transition-colors mx-auto"
              title="API Docs"
            >
              <BookOpen className="w-4 h-4" />
            </a>
            <Link
              href="/settings/api-keys"
              className="p-1.5 rounded-md hover:bg-[var(--sidebar-item-hover)] text-[var(--sidebar-icon)] hover:text-[var(--text-primary)] transition-colors mx-auto"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
