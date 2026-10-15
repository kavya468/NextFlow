"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  MoreVertical,
  ExternalLink,
  Pencil,
  Copy,
  Trash2,
  Globe,
  GlobeLock,
} from "lucide-react";
import { APP_UI, EDITOR_UI } from "@/lib/ui-config";
import { timeAgo } from "@/lib/timeAgo";
import { trpc } from "@/lib/trpc/client";
import { PublishDialog } from "@/components/PublishDialog";
import { toast } from "sonner";


interface WorkflowCardProps {
  workflow: {
    id: string;
    revision: number;
    name: string;
    updatedAt: string | Date;
    nodes: unknown[] | null;
    visibility?: string;
    description?: string | null;
  };
  tint: string;
}

export function WorkflowCard({ workflow, tint }: WorkflowCardProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [name, setName] = useState(workflow.name);
  const [revision, setRevision] = useState(workflow.revision);
  const [renameError, setRenameError] = useState(false);
  const renamePendingRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showDeleteToast, setShowDeleteToast] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [currentVisibility, setCurrentVisibility] = useState(workflow.visibility ?? "private");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const renameMutation = trpc.workflow.rename.useMutation();
  const duplicateMutation = trpc.workflow.duplicate.useMutation();
  const unpublishMutation = trpc.workflow.unpublish.useMutation();
  const deleteMutation = trpc.workflow.delete.useMutation();

  const nodeCount = Array.isArray(workflow.nodes)
    ? workflow.nodes.length
    : 0;

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // Focus rename input
  useEffect(() => {
    if (isRenaming) {
      setTimeout(() => renameRef.current?.select(), 0);
    }
  }, [isRenaming]);

  const handleRename = async () => {
    if (renamePendingRef.current) return;
    setIsRenaming(false);
    const trimmed = name.trim() || "Untitled";
    setName(trimmed);
    if (trimmed === workflow.name) return;

    renamePendingRef.current = true;
    setIsLoading(true);
    try {
      const result = await renameMutation.mutateAsync({ id: workflow.id, expectedRevision: revision, name: trimmed });
      setRevision(result.workflow.revision);
      setRenameError(false);
      router.refresh();
    } catch (error) {
      setRenameError(true);
      toast.error(error instanceof Error ? error.message : EDITOR_UI.save.renameError);
    } finally {
      renamePendingRef.current = false;
      setIsLoading(false);
    }
  };

  const handleDuplicate = async () => {
    setMenuOpen(false);
    setIsLoading(true);
    try {
      await duplicateMutation.mutateAsync({ id: workflow.id });
      router.refresh();
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    setIsLoading(true);
    try {
      await deleteMutation.mutateAsync({ id: workflow.id });
      setShowDeleteToast(true);
      setTimeout(() => {
        setShowDeleteToast(false);
        router.refresh();
      }, 2000);
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Delete Toast */}
      {showDeleteToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[200] bg-red-900/80 text-red-200 text-xs font-medium px-4 py-2 rounded-full border border-red-700/50 shadow-lg animate-fade-in flex items-center gap-2">
          <Trash2 className="w-3.5 h-3.5" />
          Workflow deleted
        </div>
      )}
      <div className="group block relative">
        {/* Thumbnail */}
        <Link href={`/workflow/${workflow.id}`}>
          <div
            className={`relative bg-gradient-to-br ${tint} border border-[var(--node-border)] rounded-xl h-44 overflow-hidden hover:border-[var(--node-border-hover)] transition-all group-hover:border-[var(--node-border-hover)] ${isLoading ? "opacity-50 pointer-events-none" : ""}`}
          >
            {/* Mini node-graph decoration */}
            <svg
              className="absolute inset-0 w-full h-full"
              viewBox="0 0 200 160"
              fill="none"
            >
              <line x1="55" y1="55" x2="100" y2="80" stroke="rgba(113,113,122,0.25)" strokeWidth="1" />
              <line x1="100" y1="80" x2="145" y2="60" stroke="rgba(113,113,122,0.25)" strokeWidth="1" />
              <line x1="100" y1="80" x2="140" y2="110" stroke="rgba(113,113,122,0.25)" strokeWidth="1" />
              <line x1="55" y1="55" x2="60" y2="105" stroke="rgba(113,113,122,0.15)" strokeWidth="1" />
              <circle cx="55" cy="55" r="6" fill="rgba(139,92,246,0.35)" stroke="rgba(139,92,246,0.5)" strokeWidth="1" />
              <circle cx="100" cy="80" r="7" fill="rgba(59,130,246,0.3)" stroke="rgba(59,130,246,0.45)" strokeWidth="1" />
              <circle cx="145" cy="60" r="5" fill="rgba(234,179,8,0.3)" stroke="rgba(234,179,8,0.45)" strokeWidth="1" />
              <circle cx="140" cy="110" r="5.5" fill="rgba(236,72,153,0.3)" stroke="rgba(236,72,153,0.45)" strokeWidth="1" />
              <circle cx="60" cy="105" r="4" fill="rgba(113,113,122,0.3)" stroke="rgba(113,113,122,0.4)" strokeWidth="1" />
              <circle cx="55" cy="55" r="2" fill="rgba(139,92,246,0.6)" />
              <circle cx="100" cy="80" r="2.5" fill="rgba(59,130,246,0.5)" />
              <circle cx="145" cy="60" r="1.8" fill="rgba(234,179,8,0.5)" />
              <circle cx="140" cy="110" r="2" fill="rgba(236,72,153,0.5)" />
            </svg>

            {/* Node count badge */}
            {nodeCount > 0 && (
              <div className="absolute bottom-2.5 right-2.5 bg-[var(--badge-bg)] backdrop-blur-sm text-[var(--badge-text)] text-[10px] font-medium px-2 py-0.5 rounded-md border border-[var(--badge-border)]">
                {nodeCount} Node{nodeCount !== 1 ? "s" : ""}
              </div>
            )}

            {/* Published badge */}
            {currentVisibility === "published" && (
              <div className="absolute top-2.5 left-2.5 flex items-center gap-1 bg-emerald-500/15 backdrop-blur-sm text-emerald-400 text-[10px] font-medium px-2 py-0.5 rounded-md border border-emerald-500/20">
                <Globe className="w-3 h-3" />
                Published
              </div>
            )}
          </div>
        </Link>

        {/* 3-dot menu button */}
        <div ref={menuRef} className="absolute top-2 right-2 z-10">
          <button
            type="button"
            aria-label={APP_UI.dashboard.workflowActions(workflow.name)}
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-[var(--button-bg)] backdrop-blur-sm border border-[var(--button-border)] text-[var(--button-text)] hover:text-[var(--text-primary)] hover:bg-[var(--button-bg)] transition-all opacity-0 group-hover:opacity-100"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>

          {/* Dropdown Menu */}
          {menuOpen && (
            <div className="absolute right-0 top-9 w-44 bg-[var(--popover-bg)] border border-[var(--separator)] rounded-xl shadow-2xl shadow-[var(--overlay-bg)] py-1.5 z-50 animate-fade-in">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  router.push(`/workflow/${workflow.id}`);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] transition-colors rounded-lg mx-0"
              >
                <ExternalLink className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                Open
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setIsRenaming(true);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] transition-colors rounded-lg"
              >
                <Pencil className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                Rename
              </button>
              <button
                onClick={handleDuplicate}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] transition-colors rounded-lg"
              >
                <Copy className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                Duplicate
              </button>
              {currentVisibility === "published" ? (
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    try {
                      await unpublishMutation.mutateAsync({ id: workflow.id });
                      setCurrentVisibility("private");
                      toast.success("Removed from gallery");
                      router.refresh();
                    } catch {
                      toast.error("Failed to unpublish");
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)] transition-colors rounded-lg"
                >
                  <GlobeLock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  Unpublish
                </button>
              ) : (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setShowPublishDialog(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-violet-400 hover:bg-violet-500/10 hover:text-violet-300 transition-colors rounded-lg"
                >
                  <Globe className="w-3.5 h-3.5" />
                  Publish to Gallery
                </button>
              )}
              <div className="border-t border-[var(--separator)] my-1" />
              <button
                onClick={handleDelete}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors rounded-lg"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </div>
          )}
        </div>

        {/* Title (inline-editable on Rename) */}
        {isRenaming ? (
          <input
            ref={renameRef}
            aria-label={EDITOR_UI.save.draftTitle}
            name="workflowName"
            autoComplete="off"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") {
                setName(workflow.name);
                setIsRenaming(false);
              }
            }}
            className="mt-2.5 w-full bg-transparent text-sm font-medium text-[var(--text-primary)] outline-none border-b border-[var(--separator)] pb-0.5"
            autoFocus
          />
        ) : (
          <p className="text-sm font-medium text-[var(--text-primary)] mt-2.5 truncate">
            {name}
          </p>
        )}
        {renameError && <div className="editor-rename-recovery" role="status">
          <p>{EDITOR_UI.save.renameError}</p>
          <button type="button" onClick={() => { setName(workflow.name); setRenameError(false); router.refresh(); }}>{EDITOR_UI.save.reloadTitle}</button>
        </div>}
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-xs text-[var(--text-secondary)]" suppressHydrationWarning>
            Edited {timeAgo(workflow.updatedAt)}
          </p>
          {currentVisibility === "published" && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400/70">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 animate-pulse" />
              Public
            </span>
          )}
        </div>
      </div>

      {/* Publish Dialog */}
      <PublishDialog
        open={showPublishDialog}
        onOpenChange={(open) => {
          setShowPublishDialog(open);
          if (!open) {
            // Refresh to pick up visibility change
            router.refresh();
            setCurrentVisibility("published");
          }
        }}
        workflowId={workflow.id}
        workflowName={name}
        currentDescription={workflow.description}
      />
    </>
  );
}
