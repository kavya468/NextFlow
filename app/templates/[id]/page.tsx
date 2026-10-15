"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Flame, Users, Play, Loader2, Upload, X, Image as ImageIcon, Film, Music, CheckCircle, RefreshCw, Zap, Pencil, Copy, Layers } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { useRealtimeRun } from "@trigger.dev/react-hooks";
import { APP_UI, EDITOR_UI, RUN_UI, dispatchRunStatus, isKnownRequestRejection, isRecord, isTerminalRunStatus } from "@/lib/ui-config";

const CATEGORY_COLORS: Record<string, string> = {
  image: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  video: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  audio: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  text: "bg-sky-500/15 text-sky-400 border-sky-500/20",
};

const PLACEHOLDER_GRADIENTS = [
  "from-violet-900/30 via-indigo-900/20 to-[#141414]",
  "from-rose-900/30 via-pink-900/20 to-[#141414]",
  "from-amber-900/30 via-orange-900/20 to-[#141414]",
  "from-sky-900/30 via-cyan-900/20 to-[#141414]",
];

function formatUsageCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return count.toString();
}

export default function TemplateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const utils = trpc.useUtils();
  const { data: template, isLoading, error } = trpc.workflow.templateDetail.useQuery({ id });
  const executeMutation = trpc.workflow.executeTemplate.useMutation();
  const retryDispatchMutation = trpc.workflow.retryDispatch.useMutation();

  const [mode, setMode] = useState<"quick-run" | "edit">("quick-run");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);
  const [uploadingFields, setUploadingFields] = useState<Record<string, boolean>>({});
  const [dragOverField, setDragOverField] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── Clone State ─────────────────────────────────────────────────────────
  const cloneMutation = trpc.workflow.cloneTemplate.useMutation();
  const [isCloning, setIsCloning] = useState(false);

  // ── Inline Execution State ─────────────────────────────────────────────
  const [runState, setRunState] = useState<"idle" | "running" | "completed" | "failed" | "partial" | "cancelled">("idle");
  const [runOutput, setRunOutput] = useState<Record<string, Record<string, unknown>> | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [triggerId, setTriggerId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const activeRunRef = useRef<string | null>(null);
  const terminalHandledRef = useRef(false);
  const startingRef = useRef(false);
  const pendingRequestRef = useRef<{ workflowId: string; values: Record<string, string>; idempotencyKey: string } | null>(null);
  const [requestUnconfirmed, setRequestUnconfirmed] = useState(false);
  const [runStatus, setRunStatus] = useState("PENDING");
  const [awaitingSettlement, setAwaitingSettlement] = useState(false);
  const { data: savedRun, error: statusError } = trpc.workflow.status.useQuery(
    { runId: currentRunId ?? "" },
    {
      enabled: !!currentRunId && runState === "running",
      refetchInterval: query => isTerminalRunStatus(query.state.data?.status ?? "") ? false : RUN_UI.pollIntervalMs,
      refetchIntervalInBackground: true,
    },
  );
  const { data: tokenData } = trpc.workflow.triggerToken.useQuery(
    { runId: currentRunId ?? "" },
    { enabled: !!currentRunId && !!triggerId && !accessToken && runState === "running" },
  );
  const realtimeToken = accessToken ?? (tokenData?.triggerId === triggerId ? tokenData.publicAccessToken : null);

  // ── Compute leaf node IDs (nodes with no outgoing edges) ──────────────
  const leafNodeIds = useMemo(() => {
    if (!template) return new Set<string>();
    const edges = Array.isArray(template.edges) ? (template.edges as Array<{ source: string }>) : [];
    const nodes = Array.isArray(template.nodes) ? (template.nodes as Array<{ id: string }>) : [];
    const sourcesSet = new Set(edges.map((e) => e.source));
    return new Set(nodes.filter((n) => !sourcesSet.has(n.id)).map((n) => n.id));
  }, [template]);

  // ── Human-readable names for output nodes ──────────────────────────────
  const nodeNameMap = useMemo(() => {
    if (!template) return new Map<string, string>();
    const nodes = Array.isArray(template.nodes)
      ? (template.nodes as Array<{ id: string; type?: string; data?: Record<string, unknown> }>)
      : [];
    const map = new Map<string, string>();
    for (const node of nodes) {
      // Priority: node.data.label > node.type (prettified) > node ID
      const label =
        (node.data?.label as string) ||
        node.type?.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ||
        node.id.slice(0, 8);
      map.set(node.id, label);
    }
    return map;
  }, [template]);

  // Initialize form values from exposed inputs defaults
  if (template?.exposedInputs && !initialized) {
    const defaults: Record<string, string> = {};
    for (const input of template.exposedInputs) {
      defaults[input.label] = String(input.defaultValue ?? "");
    }
    setFormValues(defaults);
    setInitialized(true);
  }

  const handleValueChange = (label: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [label]: value }));
  };

  // ── File Upload Handler ────────────────────────────────────────────────
  const handleFileUpload = useCallback(async (label: string, file: File) => {
    setUploadingFields((prev) => ({ ...prev, [label]: true }));

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }

      const { url } = await res.json();
      handleValueChange(label, url);
      toast.success(`${file.name} uploaded`, {
        description: "File ready for execution",
      });
    } catch (err: any) {
      toast.error("Upload failed", {
        description: err.message || "Try a smaller file or paste a URL instead",
      });
    } finally {
      setUploadingFields((prev) => ({ ...prev, [label]: false }));
    }
  }, []);

  const handleDrop = useCallback((label: string, e: React.DragEvent) => {
    e.preventDefault();
    setDragOverField(null);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(label, file);
  }, [handleFileUpload]);

  const MEDIA_ACCEPT: Record<string, string> = {
    image: "image/*",
    video: "video/*",
    audio: "audio/*",
  };

  const MEDIA_ICONS: Record<string, typeof ImageIcon> = {
    image: ImageIcon,
    video: Film,
    audio: Music,
  };

  const retainOutputs = useCallback((outputs: Record<string, Record<string, unknown>>) => {
    const leafOutputs = Object.fromEntries(Object.entries(outputs).filter(([nodeId]) => leafNodeIds.size === 0 || leafNodeIds.has(nodeId)));
    const visible = Object.keys(leafOutputs).length ? leafOutputs : outputs;
    if (Object.keys(visible).length) setRunOutput(previous => ({ ...previous, ...visible }));
  }, [leafNodeIds]);

  const applySavedRun = useCallback((run: {
    id: string; status: string; triggerId?: string | null;
    nodeRuns: Array<{ nodeId: string; status: string; outputs: unknown; error?: string | null }>;
  }) => {
    if (run.id !== activeRunRef.current || terminalHandledRef.current) return;
    setRunStatus(run.status);
    if (run.triggerId) setTriggerId(run.triggerId);
    const outputs: Record<string, Record<string, unknown>> = {};
    for (const node of run.nodeRuns) {
      if (node.status === "SUCCESS" && isRecord(node.outputs)) outputs[node.nodeId] = node.outputs;
    }
    retainOutputs(outputs);
    if (!isTerminalRunStatus(run.status)) return;
    terminalHandledRef.current = true;
    setAwaitingSettlement(false);
    setRunState(run.status === "SUCCESS" ? "completed" : run.status === "PARTIAL" ? "partial" : run.status === "CANCELLED" ? "cancelled" : "failed");
    if (run.status !== "SUCCESS") {
      const nodeError = run.nodeRuns.find(node => node.error)?.error;
      const summary = run.status === "PARTIAL" ? RUN_UI.messages.partial : run.status === "CANCELLED" ? RUN_UI.messages.cancelled : RUN_UI.messages.failed;
      setRunError(previous => nodeError || previous || summary);
    } else setRunError(null);
    setTriggerId(null);
    setAccessToken(null);
    void utils.credits.getBalance.invalidate();
    void utils.workflow.history.invalidate();
  }, [retainOutputs, utils.credits.getBalance, utils.workflow.history]);

  useEffect(() => {
    if (savedRun) applySavedRun(savedRun);
  }, [savedRun, applySavedRun]);

  const refreshSavedRun = useCallback(async () => {
    const runId = activeRunRef.current;
    if (!runId || terminalHandledRef.current) return;
    setAwaitingSettlement(true);
    try {
      applySavedRun(await utils.client.workflow.status.query({ runId }));
    } catch {
      // Polling continues; an unavailable status endpoint is not workflow failure.
    }
  }, [applySavedRun, utils.client.workflow.status]);

  const acceptRun = (result: { runId: string; status: string; triggerId?: string; publicAccessToken?: string }) => {
    activeRunRef.current = result.runId;
    terminalHandledRef.current = false;
    pendingRequestRef.current = null;
    setRequestUnconfirmed(false);
    setCurrentRunId(result.runId);
    setTriggerId(result.triggerId ?? null);
    setAccessToken(result.publicAccessToken ?? null);
    setRunStatus(dispatchRunStatus(result.status));
    setAwaitingSettlement(false);
    setRunState("running");
    void utils.credits.getBalance.invalidate();
    if (result.status === "dispatch_unknown") toast.info(RUN_UI.messages.dispatchUnknown);
  };

  const handleExecute = async () => {
    if (!template || runState === "running" || startingRef.current) return;
    startingRef.current = true;
    setRunState("running");
    setRunError(null);
    setAwaitingSettlement(false);
    if (!pendingRequestRef.current) {
      activeRunRef.current = null;
      setCurrentRunId(null);
      setTriggerId(null);
      setAccessToken(null);
      setRunOutput(null);
      setSelectedOutputId(null);
      pendingRequestRef.current = { workflowId: template.id, values: { ...formValues }, idempotencyKey: crypto.randomUUID() };
    }
    try {
      acceptRun(await executeMutation.mutateAsync(pendingRequestRef.current));
    } catch (error: unknown) {
      if (isKnownRequestRejection(error)) pendingRequestRef.current = null;
      const unconfirmed = !!pendingRequestRef.current;
      setRequestUnconfirmed(unconfirmed);
      setRunState("idle");
      setRunError(unconfirmed ? RUN_UI.messages.requestUnknown : error instanceof Error ? error.message : "Could not start workflow");
    } finally {
      startingRef.current = false;
    }
  };

  const retryDispatch = async () => {
    if (!currentRunId || retryDispatchMutation.isPending) return;
    try {
      acceptRun(await retryDispatchMutation.mutateAsync({ runId: currentRunId }));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : RUN_UI.messages.dispatchUnknown);
    }
  };

  const { run: realtimeRun, error: realtimeError } = useRealtimeRun(triggerId ?? "", {
    accessToken: realtimeToken ?? "",
    enabled: !!triggerId && !!realtimeToken && runState === "running",
    onComplete: completedRun => {
      if (completedRun.id === triggerId) void refreshSavedRun();
    },
  });

  useEffect(() => {
    if (!realtimeRun || realtimeRun.id !== triggerId || terminalHandledRef.current) return;
    const meta = realtimeRun.metadata as Record<string, unknown> | undefined;
    if (isRecord(meta?.nodeOutputs)) {
      retainOutputs(Object.fromEntries(Object.entries(meta.nodeOutputs).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))));
    }
    if (typeof meta?.error === "string") setRunError(meta.error);
    if (realtimeRun.finishedAt || realtimeRun.status === "COMPLETED" || isTerminalRunStatus(String(meta?.runStatus ?? ""))) void refreshSavedRun();
  }, [realtimeRun, triggerId, retainOutputs, refreshSavedRun]);

  useEffect(() => {
    if (runState !== "idle" && outputRef.current) {
      outputRef.current.scrollIntoView({ behavior: window.matchMedia(EDITOR_UI.reducedMotion).matches ? "instant" : "smooth", block: "nearest" });
    }
  }, [runState]);

  const monitoringLabel = runStatus === "DISPATCH_UNKNOWN" ? RUN_UI.labels.dispatchUnknown
    : runStatus === "CANCEL_REQUESTED" ? RUN_UI.labels.cancelRequested
    : awaitingSettlement ? RUN_UI.labels.checking
    : !currentRunId ? RUN_UI.labels.starting
    : runStatus === "PENDING" ? RUN_UI.labels.pending : RUN_UI.labels.running;
  const monitoringMessage = statusError ? RUN_UI.messages.statusUnavailable
    : runStatus === "DISPATCH_UNKNOWN" ? RUN_UI.messages.dispatchUnknown
    : runStatus === "CANCEL_REQUESTED" ? RUN_UI.messages.cancellationRequested
    : awaitingSettlement ? RUN_UI.messages.checking
    : realtimeError ? RUN_UI.messages.liveUnavailable : "Saved run status refreshes automatically.";

  // ── Clone & Edit handler ──────────────────────────────────────────────
  const handleCloneAndEdit = async () => {
    if (!template) return;

    // Owner bypass — go directly to the canvas, no clone needed
    if (template.isOwner) {
      router.push(`/workflow/${template.id}`);
      return;
    }

    setIsCloning(true);
    try {
      const result = await cloneMutation.mutateAsync({ workflowId: template.id });
      toast.success("Workflow cloned!", { description: `Saved as "${result.name}"` });
      router.push(`/workflow/${result.id}`);
    } catch (err: any) {
      toast.error("Clone failed", { description: err.message });
    } finally {
      setIsCloning(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-[var(--text-muted)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading template…</span>
        </div>
      </div>
    );
  }

  // Error / Not Found
  if (error || !template) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center gap-4">
        <p className="text-[var(--text-secondary)]">Template not found</p>
        <Link
          href="/templates"
          className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
        >
          ← Back to Gallery
        </Link>
      </div>
    );
  }

  const hash = template.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const gradient = PLACEHOLDER_GRADIENTS[hash % PLACEHOLDER_GRADIENTS.length];
  const categoryStyle = template.category
    ? CATEGORY_COLORS[template.category] ?? CATEGORY_COLORS.text
    : CATEGORY_COLORS.text;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Top Bar */}
      <div className="border-b border-[var(--separator)] bg-[#0a0a0a]/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link
            href="/templates"
            className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Gallery
          </Link>
          {template.isOwner && (
            <span className="text-[10px] font-medium text-emerald-400/70 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
              Your Template
            </span>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Left Column — Preview & Info */}
          <div className="lg:col-span-3 space-y-6">
            {/* Preview Image */}
            <div className="relative rounded-xl overflow-hidden border border-[var(--node-border)]">
              {template.thumbnail ? (
                <img
                  src={template.thumbnail}
                  alt={template.name}
                  className="w-full h-64 lg:h-80 object-cover"
                />
              ) : (
                <div className={`w-full h-64 lg:h-80 bg-gradient-to-br ${gradient}`}>
                  <svg className="absolute inset-0 w-full h-full opacity-60" viewBox="0 0 400 300" fill="none">
                    <line x1="80" y1="100" x2="200" y2="150" stroke="rgba(113,113,122,0.25)" strokeWidth="1.5" />
                    <line x1="200" y1="150" x2="310" y2="110" stroke="rgba(113,113,122,0.25)" strokeWidth="1.5" />
                    <line x1="200" y1="150" x2="300" y2="220" stroke="rgba(113,113,122,0.25)" strokeWidth="1.5" />
                    <line x1="80" y1="100" x2="100" y2="210" stroke="rgba(113,113,122,0.15)" strokeWidth="1.5" />
                    <circle cx="80" cy="100" r="10" fill="rgba(139,92,246,0.35)" stroke="rgba(139,92,246,0.5)" strokeWidth="1.5" />
                    <circle cx="200" cy="150" r="12" fill="rgba(59,130,246,0.3)" stroke="rgba(59,130,246,0.45)" strokeWidth="1.5" />
                    <circle cx="310" cy="110" r="8" fill="rgba(234,179,8,0.3)" stroke="rgba(234,179,8,0.45)" strokeWidth="1.5" />
                    <circle cx="300" cy="220" r="9" fill="rgba(236,72,153,0.3)" stroke="rgba(236,72,153,0.45)" strokeWidth="1.5" />
                    <circle cx="100" cy="210" r="7" fill="rgba(113,113,122,0.3)" stroke="rgba(113,113,122,0.4)" strokeWidth="1.5" />
                    <circle cx="80" cy="100" r="3.5" fill="rgba(139,92,246,0.6)" />
                    <circle cx="200" cy="150" r="4" fill="rgba(59,130,246,0.5)" />
                    <circle cx="310" cy="110" r="3" fill="rgba(234,179,8,0.5)" />
                    <circle cx="300" cy="220" r="3.5" fill="rgba(236,72,153,0.5)" />
                  </svg>
                </div>
              )}
            </div>

            {/* Template Info */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <h1 className="text-2xl font-medium text-[var(--text-primary)] tracking-tight">
                    {template.name}
                  </h1>
                  {template.description && (
                    <p className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed">
                      {template.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Stats Row */}
              <div className="flex items-center gap-4 flex-wrap">
                {template.category && (
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-lg border ${categoryStyle}`}>
                    {template.category.charAt(0).toUpperCase() + template.category.slice(1)}
                  </span>
                )}
                {template.usageCount > 0 && (
                  <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <Flame className="w-3.5 h-3.5 text-orange-400/70" />
                    {formatUsageCount(template.usageCount)} uses
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  <Users className="w-3.5 h-3.5" />
                  By {template.user.id.slice(0, 12)}…
                </span>
                {template.publishedAt && (
                  <span className="text-xs text-[var(--text-muted)]">
                    Published {new Date(template.publishedAt).toLocaleDateString()}
                  </span>
                )}
              </div>

              {/* What's Inside — node breakdown */}
              {template.totalNodes > 0 && (
                <div className="bg-[#141414] border border-[var(--node-border)] rounded-xl p-4">
                  <h3 className="text-xs font-medium text-[var(--text-secondary)] mb-3 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    What's Inside
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(template.nodeBreakdown).map(([cat, count]) => (
                      <span
                        key={cat}
                        className="text-[10px] px-2 py-1 rounded-md bg-zinc-800 text-[var(--text-muted)] border border-zinc-700/50"
                      >
                        {count}× {cat}
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] mt-2">
                    {template.totalNodes} node{template.totalNodes !== 1 ? "s" : ""} total
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column — Mode Selector + Form / Edit CTA */}
          <div className="lg:col-span-2">
            <div className="bg-[#141414] border border-[var(--node-border)] rounded-xl p-5 sticky top-20">
              {/* Mode Selector */}
              <div className="flex bg-[#0f0f0f] border border-[var(--node-border)] rounded-lg p-0.5 mb-4">
                <button
                  onClick={() => setMode("quick-run")}
                  className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-md transition-all ${
                    mode === "quick-run"
                      ? "bg-violet-600/20 text-violet-400 border border-violet-500/30"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  Quick Run
                </button>
                <button
                  onClick={() => setMode("edit")}
                  className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-md transition-all ${
                    mode === "edit"
                      ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit Workflow
                </button>
              </div>

              {/* ── Edit Workflow Mode ──────────────────────────────────── */}
              {mode === "edit" && (
                <div className="text-center py-8 space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto">
                    <Pencil className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm text-[var(--text-primary)] font-medium">
                      {template.isOwner ? "Edit your workflow" : "Edit this workflow"}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xs mx-auto">
                      {template.isOwner
                        ? "Open the canvas editor to modify nodes, change models, and customize the pipeline."
                        : "A copy will be saved to your account. You can modify the nodes, change models, and customize the pipeline before running."}
                    </p>
                  </div>
                  <button
                    onClick={handleCloneAndEdit}
                    disabled={isCloning}
                    className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
                  >
                    {isCloning ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Cloning…</>
                    ) : template.isOwner ? (
                      <><Pencil className="w-4 h-4" /> Open Editor</>
                    ) : (
                      <><Copy className="w-4 h-4" /> Clone &amp; Edit</>
                    )}
                  </button>
                </div>
              )}

              {/* ── Quick Run Mode ─────────────────────────────────────── */}
              {mode === "quick-run" && (
                <>
              <h2 className="text-sm font-medium text-[var(--text-primary)] mb-4">
                Customize Inputs
              </h2>

              {template.exposedInputWarnings && template.exposedInputWarnings.length > 0 && (
                <div className="mb-4 p-3 bg-amber-500/15 border border-amber-500/20 rounded-lg">
                  <p className="text-xs font-medium text-amber-400 mb-1">{APP_UI.templateDuplicateLabels}</p>
                  {template.exposedInputWarnings.map((w, i) => (
                    <p key={i} className="text-[10px] text-amber-400/80 leading-relaxed">{w}</p>
                  ))}
                </div>
              )}

              {template.exposedInputs.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] mb-5">
                  This template has no customizable inputs. Click "Run" to execute with defaults.
                </p>
              ) : (
                <div className="space-y-4 mb-5">
                  {template.exposedInputs.map((input) => (
                    <div key={input.nodeId}>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                        {input.label}
                        <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)]">
                          ({input.nodeType})
                        </span>
                      </label>

                      {["image", "video", "audio"].includes(input.nodeType) ? (
                        <div className="space-y-2">
                          {/* Uploaded file preview */}
                          {formValues[input.label] && !uploadingFields[input.label] ? (
                            <div className="relative rounded-lg overflow-hidden border border-[var(--node-inner-border)] bg-[var(--node-inner-bg)]">
                              {input.nodeType === "image" && (
                                <img
                                  src={formValues[input.label]}
                                  alt="Preview"
                                  className="w-full h-28 object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              )}
                              {input.nodeType === "video" && (
                                <video
                                  src={formValues[input.label]}
                                  className="w-full h-28 object-cover"
                                  controls
                                  muted
                                />
                              )}
                              {input.nodeType === "audio" && (
                                <div className="p-3">
                                  <audio
                                    src={formValues[input.label]}
                                    controls
                                    className="w-full h-8"
                                    style={{ filter: "invert(1)" }}
                                  />
                                </div>
                              )}
                              {/* Remove button */}
                              <button
                                type="button"
                                onClick={() => handleValueChange(input.label, "")}
                                className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-md bg-black/60 backdrop-blur-sm text-white/80 hover:text-white hover:bg-black/80 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                              {/* URL display */}
                              <div className="px-3 py-2 border-t border-[var(--node-inner-border)]">
                                <p className="text-[10px] text-[var(--text-muted)] truncate">
                                  {formValues[input.label]}
                                </p>
                              </div>
                            </div>
                          ) : (
                            /* Drop zone / Upload area */
                            <div
                              onDragOver={(e) => { e.preventDefault(); setDragOverField(input.label); }}
                              onDragLeave={() => setDragOverField(null)}
                              onDrop={(e) => handleDrop(input.label, e)}
                              onClick={() => !uploadingFields[input.label] && fileInputRefs.current[input.label]?.click()}
                              className={`relative flex flex-col items-center justify-center gap-2 py-6 px-4 rounded-lg border-2 border-dashed cursor-pointer transition-all ${
                                dragOverField === input.label
                                  ? "border-violet-500 bg-violet-500/10"
                                  : "border-[var(--node-inner-border)] bg-[var(--node-inner-bg)] hover:border-zinc-500 hover:bg-zinc-800/30"
                              } ${uploadingFields[input.label] ? "pointer-events-none opacity-60" : ""}`}
                            >
                              <input
                                ref={(el) => { fileInputRefs.current[input.label] = el; }}
                                type="file"
                                accept={MEDIA_ACCEPT[input.nodeType] || "*/*"}
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleFileUpload(input.label, file);
                                  e.target.value = "";
                                }}
                              />

                              {uploadingFields[input.label] ? (
                                <>
                                  <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
                                  <p className="text-[11px] text-violet-400 font-medium">Uploading…</p>
                                </>
                              ) : (
                                <>
                                  {(() => {
                                    const Icon = MEDIA_ICONS[input.nodeType] || Upload;
                                    return <Icon className="w-5 h-5 text-[var(--text-muted)]" />;
                                  })()}
                                  <div className="text-center">
                                    <p className="text-[11px] text-[var(--text-secondary)]">
                                      <span className="text-violet-400 font-medium">Click to upload</span> or drag and drop
                                    </p>
                                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                                      {input.nodeType === "image" ? "PNG, JPG, WebP up to 50MB" :
                                       input.nodeType === "video" ? "MP4, MOV, WebM up to 50MB" :
                                       "MP3, WAV, M4A up to 50MB"}
                                    </p>
                                  </div>
                                </>
                              )}
                            </div>
                          )}

                          {/* Fallback: paste URL */}
                          {!formValues[input.label] && !uploadingFields[input.label] && (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-px bg-[var(--separator)]" />
                              <span className="text-[10px] text-[var(--text-muted)]">or paste URL</span>
                              <div className="flex-1 h-px bg-[var(--separator)]" />
                            </div>
                          )}
                          {!formValues[input.label] && !uploadingFields[input.label] && (
                            <input
                              type="text"
                              value={formValues[input.label] ?? ""}
                              onChange={(e) => handleValueChange(input.label, e.target.value)}
                              placeholder={`Paste ${input.nodeType} URL…`}
                              className="w-full bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] focus:outline-none focus:border-zinc-500 transition-colors"
                            />
                          )}
                        </div>
                      ) : input.inputType === "select" ? (
                        <select
                          value={formValues[input.label] ?? ""}
                          onChange={(e) => handleValueChange(input.label, e.target.value)}
                          className="w-full bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-zinc-500 transition-colors appearance-none"
                        >
                          <option value="" disabled>Select {input.label}...</option>
                          {input.options?.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : input.inputType === "textarea" || input.nodeType === "text" ? (
                        <textarea
                          value={formValues[input.label] ?? ""}
                          onChange={(e) => handleValueChange(input.label, e.target.value)}
                          placeholder={input.description}
                          rows={3}
                          className="w-full bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] focus:outline-none focus:border-zinc-500 transition-colors resize-none"
                        />
                      ) : input.inputType === "boolean" ? (
                        <label className="flex items-center gap-2 cursor-pointer mt-1">
                          <input
                            type="checkbox"
                            checked={formValues[input.label] === "true" || formValues[input.label] === true as unknown as string}
                            onChange={(e) => handleValueChange(input.label, e.target.checked ? "true" : "false")}
                            className="w-4 h-4 rounded border-[var(--node-inner-border)] bg-[var(--node-inner-bg)] text-violet-500 focus:ring-violet-500/20"
                          />
                          <span className="text-xs text-[var(--text-primary)]">Enable</span>
                        </label>
                      ) : (
                        <input
                          type={input.inputType === "number" ? "number" : "text"}
                          value={formValues[input.label] ?? ""}
                          onChange={(e) => handleValueChange(input.label, e.target.value)}
                          placeholder={input.description}
                          min={input.min}
                          max={input.max}
                          className="w-full bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] focus:outline-none focus:border-zinc-500 transition-colors"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Estimated Cost */}
              {template.estimatedCredits > 0 && (
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-3 px-1">
                  <span>Estimated cost</span>
                  <span className="font-medium text-[var(--text-secondary)]">
                    ~{template.estimatedCredits.toLocaleString()} credits
                  </span>
                </div>
              )}

              {/* Run Button */}
              <button
                onClick={handleExecute}
                disabled={executeMutation.isPending || runState === "running"}
                className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-600/50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
              >
                {runState === "running" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {monitoringLabel}
                  </>
                ) : requestUnconfirmed ? RUN_UI.labels.retryRequest : runState !== "idle" ? (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Run Again
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Run Template
                  </>
                )}
              </button>

              {/* ── Inline Output Section ──────────────────────────────── */}
              {runState === "running" && runStatus === "DISPATCH_UNKNOWN" && (
                <button type="button" onClick={retryDispatch} disabled={retryDispatchMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 border border-[var(--rf-controls-border)] bg-[var(--rf-controls-bg)] text-[var(--text-primary)] text-sm font-medium px-4 py-2.5 rounded-xl mt-3 hover:bg-[var(--toolbar-btn-hover)]">
                  {retryDispatchMutation.isPending ? RUN_UI.labels.retryingDispatch : RUN_UI.labels.retryDispatch}
                </button>
              )}
              <div ref={outputRef}>
                {/* Running state */}
                {runState === "running" && (
                  <div className="mt-4 p-4 bg-violet-500/10 border border-violet-500/20 rounded-xl" role="status" aria-live="polite">
                    <div className="flex items-center gap-2 text-violet-400 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{monitoringLabel}</span>
                    </div>
                    <p className="text-[10px] text-violet-400/60 mt-1">{monitoringMessage}</p>
                  </div>
                )}

                {/* Completed — show outputs */}
                {runOutput && (() => {
                  const outputEntries = Object.entries(runOutput);
                  const hasMultiple = outputEntries.length > 1;
                  // Auto-select first output if none chosen
                  const activeId = selectedOutputId ?? (hasMultiple ? null : outputEntries[0]?.[0] ?? null);
                  // null = show all
                  const visibleEntries = activeId
                    ? outputEntries.filter(([id]) => id === activeId)
                    : outputEntries;

                  return (
                    <div className="mt-4 space-y-3">
                      <h3 className="text-xs font-medium text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Output
                        {hasMultiple && (
                          <span className="text-[10px] font-normal text-emerald-400/60 ml-1">
                            ({outputEntries.length} nodes)
                          </span>
                        )}
                      </h3>

                      {/* Tab selector — only shown for multiple outputs */}
                      {hasMultiple && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => setSelectedOutputId(null)}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all border ${
                              activeId === null
                                ? "bg-violet-500/20 text-violet-300 border-violet-500/30"
                                : "bg-transparent text-[var(--text-muted)] border-transparent hover:bg-zinc-800/50 hover:text-[var(--text-secondary)]"
                            }`}
                          >
                            All Outputs
                          </button>
                          {outputEntries.map(([nodeId]) => {
                            const name = nodeNameMap.get(nodeId) || nodeId.slice(0, 8);
                            const isActive = activeId === nodeId;
                            return (
                              <button
                                key={nodeId}
                                onClick={() => setSelectedOutputId(nodeId)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all border ${
                                  isActive
                                    ? "bg-violet-500/20 text-violet-300 border-violet-500/30"
                                    : "bg-transparent text-[var(--text-muted)] border-transparent hover:bg-zinc-800/50 hover:text-[var(--text-secondary)]"
                                }`}
                              >
                                {name}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Output cards */}
                      {visibleEntries.map(([nodeId, output]) => {
                        const outputData = output as Record<string, unknown>;
                        const nodeName = nodeNameMap.get(nodeId) || nodeId.slice(0, 8);
                        return (
                          <div
                            key={nodeId}
                            className="bg-[var(--node-inner-bg)] border border-[var(--node-inner-border)] rounded-lg overflow-hidden"
                          >
                            {/* Node name label (when showing all) */}
                            {!activeId && hasMultiple && (
                              <div className="px-3 py-1.5 border-b border-[var(--node-inner-border)] bg-zinc-900/40">
                                <span className="text-[10px] font-medium text-[var(--text-secondary)]">
                                  {nodeName}
                                </span>
                              </div>
                            )}

                            {/* Image output */}
                            {typeof outputData.url === "string" &&
                              /\.(png|jpg|jpeg|webp|gif)/i.test(outputData.url) && (
                                <img
                                  src={outputData.url}
                                  alt="Output"
                                  className="w-full rounded-t-lg"
                                />
                              )}

                            {/* Video output */}
                            {typeof outputData.url === "string" &&
                              /\.(mp4|webm|mov)/i.test(outputData.url) && (
                                <video
                                  src={outputData.url}
                                  controls
                                  className="w-full rounded-t-lg"
                                />
                              )}

                            {/* Audio output */}
                            {typeof outputData.url === "string" &&
                              /\.(mp3|wav|m4a)/i.test(outputData.url) && (
                                <div className="p-3">
                                  <audio
                                    src={outputData.url}
                                    controls
                                    className="w-full"
                                    style={{ filter: "invert(1)" }}
                                  />
                                </div>
                              )}

                            {/* Text output */}
                            {typeof outputData.text === "string" && (
                              <div className="p-3">
                                <p className="text-xs text-[var(--text-primary)] whitespace-pre-wrap">
                                  {outputData.text}
                                </p>
                              </div>
                            )}

                            {/* Download link for any URL output */}
                            {typeof outputData.url === "string" && (
                              <div className="px-3 py-2 border-t border-[var(--node-inner-border)] flex items-center justify-between">
                                <span className="text-[10px] text-[var(--text-muted)] truncate max-w-[70%]">
                                  {outputData.url}
                                </span>
                                <a
                                  href={outputData.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors"
                                >
                                  Open ↗
                                </a>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Completed but no outputs captured */}
                {runState === "completed" && !runOutput && (
                  <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                    <div className="flex items-center gap-2 text-emerald-400 text-sm">
                      <CheckCircle className="w-4 h-4" />
                      <span>Workflow completed</span>
                    </div>
                    <p className="text-[10px] text-emerald-400/60 mt-1">No output data was captured</p>
                  </div>
                )}

                {/* Failed state */}
                {runError && runState !== "running" && (
                  <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <p className="text-xs text-red-400 font-medium">{requestUnconfirmed ? RUN_UI.labels.dispatchUnknown : runState === "partial" ? "Partially completed" : runState === "cancelled" ? "Cancelled" : runState === "failed" ? "Execution failed" : "Could not start"}</p>
                    <p className="text-[10px] text-red-400/70 mt-1">{runError}</p>
                    <button
                      onClick={handleExecute}
                      className="text-[10px] text-red-400/60 underline mt-2 hover:text-red-400/80 transition-colors"
                    >
                      {requestUnconfirmed ? RUN_UI.labels.retryRequest : "Run again"}
                    </button>
                  </div>
                )}
              </div>
              </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
