export const APP_UI = {
  name: "NextFlow",
  docsUrl: "https://github.com/kavya468/NextFlow/tree/main/docs",
  title: "NextFlow — Workflow Studio",
  description: "Connect text, image, audio, and video tools in reusable visual workflows.",
  publishCategories: [
    { value: "image", label: "Image" },
    { value: "video", label: "Video" },
    { value: "audio", label: "Audio" },
    { value: "text", label: "Text" },
  ],
  templateDuplicateLabels: "Duplicate labels detected",
  frontalImageReady: "Frontal image ready",
  dashboard: {
    title: "NextFlow Studio",
    workflowActions: (name: string) => `Actions for ${name}`,
    description: "Build creative workflows with text, image, audio, and video tools. Connect nodes, run your workflow, and review the results in one place.",
  },
  demo: {
    href: "/demo",
    linkLabel: "Watch the demo · 24 sec",
    title: "Your ideas, connected.",
    description: "A short look inside NextFlow: start with a brief, connect your tools, and follow what passes between them.",
    videoLabel: "NextFlow product walkthrough",
    src: "/media/nextflow-demo.mp4",
    poster: "/media/nextflow-demo.jpg",
    captions: "/media/nextflow-demo.vtt",
    captionsLabel: "English",
    width: 1920,
    height: 1080,
    preload: "none",
    studioLabel: "Open the studio",
    downloadLabel: "Download the video",
    note: "This film shows a saved example graph and its port mappings. It does not show a completed paid-provider run.",
    transcriptLabel: "Read the video description",
    transcript: [
      "An idea is just the first node. A Text node holds a brief for a tiny paper city at blue hour, with warm windows and folded rooftops.",
      "The real editor shows the brief connected to Seedream 4.5 for an image, then Seedance 1.5 Pro for motion.",
      "An enlarged diagram follows the connections: Text Output feeds Prompt; Image feeds Start Image URL. The connections describe inputs for a future run, not generated results.",
      "NextFlow brings text, image, audio, and video into one workspace. Designed and built by Kavya. The film has instrumental music and no narration.",
    ],
    creator: "Designed and built by Kavya.",
    creatorUrl: "https://github.com/kavya468",
    music: {
      label: "Music:",
      title: "Happy Beats & Business Moves Vol. 12",
      url: "https://ende.app/en/song/12881-happy-beats-business-moves-vol-12",
      artist: "by Sascha Ende",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      changes: "Excerpted, volume adjusted, and faded.",
    },
  },
} as const;

/** Shared editor copy and interaction settings. Visual tokens live in globals.css. */
export const EDITOR_UI = {
  save: {
    debounceMs: 1500,
    status: { saved: "Saved", saving: "Saving…", unsaved: "Unsaved changes", error: "Save paused", conflict: "Save conflict" },
    conflict: "This workflow changed in another session. Your draft is still here. Export a copy before replacing it with the saved version.",
    error: "The save could not be confirmed. Your draft is still here. Retry the same save or export a copy.",
    retry: "Retry save",
    renameError: "The new title was not saved. Copy it before reloading the saved version.",
    reloadTitle: "Reload saved title",
    draftTitle: "Draft workflow title",
    export: "Export draft",
    reload: "Reload saved version",
    reloadConfirm: "Replace this local draft with the saved version? Export your draft first if you want to keep it.",
    reloadError: "Could not reload the saved workflow. Your local draft is unchanged.",
    leaveConfirm: "This workflow has unsaved changes. Leave this editor and discard the local draft?",
    untitled: "Untitled",
  },
  compactViewport: "(max-width: 767px)",
  historyOverlayViewport: "(max-width: 1023px)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
  motion: { zoom: 300, fit: 500, afterLayout: 50 },
  fitPadding: 0.2,
  edge: { strokeOpacity: 0.7, glowBlurPx: 4, glowAlphaHex: "40" },
  ids: { palette: "editor-node-palette", history: "editor-history", historyToggle: "editor-history-toggle", controlDock: "editor-control-dock" },
  labels: {
    dashboard: "Back to dashboard",
    rename: "Rename workflow",
    workflowName: "Workflow name",
    history: "Workflow history",
    loadTemplate: "Load template",
    exportWorkflow: "Export workflow JSON",
    importWorkflow: "Import workflow JSON",
    closeHistory: "Close history",
    expandPalette: "Expand node palette",
    collapsePalette: "Collapse node palette",
    palette: "Node palette",
    addNote: "Add sticky note",
    docs: "API documentation",
    settings: "Settings",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    fitView: "Fit view",
    autoArrange: "Auto-arrange all nodes",
    undo: "Undo",
    redo: "Redo",
    canvasControls: "Canvas view controls",
    executionControls: "Workflow execution controls",
    deleteConnection: "Delete connection",
  },
} as const;

export function editorEdgeGlow(color: string): string {
  return `drop-shadow(0 0 ${EDITOR_UI.edge.glowBlurPx}px ${color}${EDITOR_UI.edge.glowAlphaHex})`;
}

export function editorMotionDuration(duration: number): number {
  return window.matchMedia(EDITOR_UI.reducedMotion).matches ? 0 : duration;
}

/** Read only when fitting, after layout; reserve the actual wrapped control dock. */
export function editorFitPadding() {
  const dock = document.getElementById(EDITOR_UI.ids.controlDock);
  const canvas = dock?.closest(".editor-canvas");
  if (!dock || !canvas) return EDITOR_UI.fitPadding;
  const canvasRect = canvas.getBoundingClientRect();
  const dockRect = dock.getBoundingClientRect();
  const gap = Number.parseFloat(getComputedStyle(dock).rowGap) || 0;
  const defaultBottom = (canvasRect.height - canvasRect.height / (1 + EDITOR_UI.fitPadding)) / 2;
  const bottom = Math.max(defaultBottom, canvasRect.bottom - dockRect.top + gap);
  return { x: EDITOR_UI.fitPadding, top: EDITOR_UI.fitPadding, bottom: `${Math.ceil(bottom)}px` as const };
}

/** Database run states are authoritative; Trigger completion only asks for a refresh. */
export const RUN_UI = {
  recovery: {
    label: "Check recovery",
    pending: "Checking recovery…",
    error: "Recovery could not be checked. Your saved run and reserved credits are unchanged.",
    outcomes: {
      settled: "The saved result and credit settlement are confirmed.",
      dispatch: "The existing start request was checked. No new reservation was created.",
      resuming: "Confirmed outputs were kept. Remaining steps have been queued on the same run.",
      active: "The worker is still active. Recovery will wait for it to stop.",
      unresolved: "Some outcomes are still unconfirmed. Their credits remain held; no work was repeated. Check again after the provider finishes.",
      unavailable: "The worker service is unavailable. The hold is unchanged; check again when the connection is restored.",
      manual_review: "This run needs manual review because its saved execution details cannot safely identify the provider result.",
    },
  },
  activeStatuses: ["PENDING", "RUNNING", "DISPATCH_UNKNOWN", "CANCEL_REQUESTED"],
  terminalStatuses: ["SUCCESS", "FAILED", "PARTIAL", "CANCELLED"],
  pollIntervalMs: 3000,
  reviewAfterMs: 60 * 60 * 1000,
  nodeStatusClearDelayMs: 4000,
  creditBalance: (balance: string) => `Credit balance: ${balance} credits. View credit history.`,
  labels: {
    balanceLoading: "Loading credit balance. View credit history.",
    balanceUnavailable: "Credit balance unavailable. View credit history.",
    reservationTitle: "Credit reservation",
    maximumReservation: "Maximum held",
    availableBalance: "Available balance",
    afterReservation: "Available after reservation",
    noReservation: "No hold",
    confirmReservation: "Reserve & run",
    insufficientReservation: "Not enough available credits",
    starting: "Starting…",
    running: "Running…",
    pending: "Waiting to start…",
    dispatchUnknown: "Start unconfirmed",
    retryDispatch: "Retry start",
    retryingDispatch: "Retrying start…",
    retryRequest: "Retry request",
    checking: "Confirming result…",
    cancel: "Cancel",
    cancelling: "Requesting cancellation…",
    cancelRequested: "Cancellation requested",
    needsReview: "Needs review",
    legacyBilling: "Legacy run",
    chargePending: "Charge pending",
  },
  messages: {
    reservation: "Review the maximum credits held before this workflow starts.",
    settlement: "The final charge is capped at the reservation. Unused credits return after results are confirmed; unresolved runs keep their hold until review.",
    zeroChargeReservation: "A provider step can require a hold even if its final charge is zero. A confirmed zero charge returns that hold in full.",
    reservationUnavailable: "The reservation or balance could not be loaded. Close this dialog and try again before running.",
    dispatchUnknown: "The start could not be confirmed. Retry start checks the same run without creating a second reservation.",
    requestUnknown: "The request could not be confirmed. Retry request checks the same attempt; your original inputs are preserved.",
    cancellationRequested: "Cancellation requested. Current tasks will finish before unused reserved credits are returned.",
    checking: "The worker has stopped. Waiting for the saved result and credit settlement.",
    statusUnavailable: "Status updates are unavailable. This run is still being checked; do not start a replacement run.",
    liveUnavailable: "Live updates are unavailable. Saved run status will continue to refresh.",
    needsReview: "This run has not reached a confirmed final state. Its age does not establish failure.",
    legacyBilling: "This older run has no settled charge record. Node usage is not a confirmed charge.",
    partial: "Some steps failed. Completed outputs are preserved below.",
    cancelled: "This run was cancelled. Completed outputs are preserved below.",
    failed: "The workflow failed. Any completed outputs are preserved below.",
  },
  status: {
    BLOCKED: { color: "bg-[var(--status-warning)]", label: "Blocked by a dependency", pulse: false },
    SUCCESS: { color: "bg-[var(--status-success)]", label: "Success", pulse: false },
    FAILED: { color: "bg-[var(--status-error)]", label: "Failed", pulse: false },
    PARTIAL: { color: "bg-[var(--status-warning)]", label: "Partial", pulse: false },
    CANCELLED: { color: "bg-[var(--status-unknown)]", label: "Cancelled", pulse: false },
    RUNNING: { color: "bg-[var(--status-running)]", label: "Running", pulse: true },
    PENDING: { color: "bg-[var(--status-pending)]", label: "Pending", pulse: true },
    DISPATCH_UNKNOWN: { color: "bg-[var(--status-warning)]", label: "Start unconfirmed", pulse: false },
    CANCEL_REQUESTED: { color: "bg-[var(--status-warning)]", label: "Cancellation requested", pulse: true },
  } satisfies Record<string, { color: string; label: string; pulse: boolean }>,
} as const;

export function isActiveRunStatus(status: string): boolean {
  return (RUN_UI.activeStatuses as readonly string[]).includes(status);
}

export function isTerminalRunStatus(status: string): boolean {
  return (RUN_UI.terminalStatuses as readonly string[]).includes(status);
}

export function dispatchRunStatus(status: string): string {
  return status === "triggered" ? "PENDING" : status.toUpperCase();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isKnownRequestRejection(error: unknown): boolean {
  if (!isRecord(error) || !isRecord(error.data)) return false;
  return ["BAD_REQUEST", "UNAUTHORIZED", "PAYMENT_REQUIRED", "FORBIDDEN", "NOT_FOUND", "PRECONDITION_FAILED", "UNPROCESSABLE_CONTENT", "TOO_MANY_REQUESTS"].includes(String(error.data.code));
}

export function runNeedsReview(run: { status: string; createdAt: Date | string; dispatchError?: string | null }, now: number): boolean {
  return isActiveRunStatus(run.status) && (!!run.dispatchError || now - new Date(run.createdAt).getTime() > RUN_UI.reviewAfterMs);
}

export function runCreditLabel(run: { accountingVersion?: number; reservedCredits?: number; chargedCredits?: number | null; settledAt?: Date | string | null }): string {
  if (run.accountingVersion !== 1) return RUN_UI.labels.legacyBilling;
  if (run.settledAt) return run.chargedCredits == null ? RUN_UI.labels.chargePending : `${run.chargedCredits.toLocaleString()} cr charged`;
  return `${(run.reservedCredits ?? 0).toLocaleString()} cr held`;
}
