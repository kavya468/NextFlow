// ============================================================================
// lib/nodes/types.ts — The DNA Schema for Every Node in the System
// ============================================================================
//
// This file defines the strict TypeScript interfaces that represent a node's
// complete "DNA". Every node in the platform — from a simple Text passthrough
// to a complex Seedream 4.5 image generator — is described by a single
// NodeConfig object. The NodeRegistry reads these configs and auto-generates
// Zod schemas, React Flow components, sidebar entries, and orchestrator
// dispatch logic from them.
//
// DESIGN PRINCIPLES:
//   1. One config file = one node type. No React components per node.
//   2. Every user-facing input MUST have a corresponding React Flow Handle.
//   3. The orchestrator MUST be node-type-agnostic — it reads from the registry.
//   4. Advanced settings collapse by default but handles remain functional.
// ============================================================================

// ---------------------------------------------------------------------------
// Handle color mapping — determines the visual color of React Flow handles
// based on the data type flowing through them.
// ---------------------------------------------------------------------------
export type HandleColor =
  | "blue"    // image / video / file URLs
  | "yellow"  // text / string data
  | "pink"    // audio data
  | "orange"  // number data
  | "green"   // boolean data
  | "purple"; // any / mixed data

// ---------------------------------------------------------------------------
// Data types that flow through handles and determine Zod schema generation.
// ---------------------------------------------------------------------------
export type IOType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "number"
  | "boolean"
  | "select"
  | "file";

// ---------------------------------------------------------------------------
// Node categories — used for sidebar grouping and filtering.
// ---------------------------------------------------------------------------
export type NodeCategory =
  | "input"     // Text, Image Upload, Video Upload
  | "ai"        // LLM, Image Gen, Video Gen, Audio Gen
  | "media"     // Crop, Extract, Merge, Lipsync
  | "logic"     // LLMs, prompts, and control/transform nodes
  | "utility";  // Future: conditional, loop, etc.

// ---------------------------------------------------------------------------
// InputDefinition — describes a single input port on a node.
//
// Every InputDefinition generates:
//   1. A React Flow target Handle on the left side of the node
//   2. A UI control (text input, number slider, select dropdown, etc.)
//   3. A field in the auto-generated Zod input schema
//   4. When the handle is connected, the UI control becomes disabled
//      and shows "● linked" status — this is Connector-Setting Parity.
// ---------------------------------------------------------------------------
export interface InputDefinition {
  /** Unique key used as the React Flow handle ID and data field name */
  key: string;

  /** Data type — determines handle color, Zod type, and UI control */
  type: IOType;

  /** Human-readable label shown next to the handle */
  label: string;

  /** Whether this input is required for execution */
  required: boolean;

  /** Default value when not connected and not user-specified */
  default?: unknown;

  /** Placeholder text for text/number inputs */
  placeholder?: string;

  /** Description tooltip shown on hover */
  description?: string;

  /** Handle color override (auto-derived from type if not specified) */
  handleColor?: HandleColor;

  /**
   * If true, this input is hidden in a collapsible "Advanced" accordion.
   * The React Flow handle is ALWAYS visible — only the UI control collapses.
   */
  isAdvanced: boolean;

  /**
   * Validation constraints used for both Zod schema generation and UI hints.
   * - min/max: for number inputs (also sets slider range)
   * - step: for number input step increments
   * - maxLength: for text inputs
   * - options: for select dropdowns (array of {label, value})
   * - accept: for file inputs (e.g., "image/*")
   */
  validation?: {
    min?: number;
    max?: number;
    step?: number;
    maxLength?: number;
    options?: Array<{ label: string; value: string }>;
    accept?: string;
  };

  /**
   * If true, no generic React Flow Handle is rendered for this input.
   * Useful when the UI control (like ElementsEditor) renders its own dynamic handles.
   */
  hideHandle?: boolean;

  /**
   * UI rendering hint — overrides the default control derived from `type`.
   * - "textarea": renders a multi-line text area instead of single-line input
   * - "mention-textarea": renders a rich textarea with @Element/@Image mention pills
   * - "elements-editor": renders a compound element list (frontal + reference images per element)
   * - "slider": renders a range slider instead of number input
   * - "hidden": renders no UI control (handle-only, for programmatic inputs)
   */
  uiVariant?: "textarea" | "mention-textarea" | "elements-editor" | "dialogue-editor" | "slider" | "hidden";

  /**
   * When true, this input accepts multiple connections (e.g., "images" array).
   * The handle will aggregate all incoming values into an array.
   */
  multi?: boolean;

  /**
   * Configuration for @mention support (used with uiVariant: "mention-textarea").
   * Maps sibling input keys to mention categories so users can reference uploaded
   * media inline in their prompt (e.g., "@Element1", "@Image1").
   */
  mentionSources?: {
    /**
     * Key of the sibling input holding the elements array.
     * Each element is { frontal_image_url, reference_image_urls[] } and
     * generates @Element1, @Element2, etc.
     */
    elementsKey?: string;
    /** Sibling input keys whose values become @Image1, @Image2, etc. */
    imageKeys: string[];
  };

  /**
   * Conditional visibility — show this input only when a sibling field matches
   * a specific value. Used to hide inputs that are irrelevant for the current
   * mode (e.g., hide image_urls when mode !== "edit").
   */
  showIf?: {
    /** The sibling input key to check */
    field: string;
    /** The value that field must equal for this input to be visible */
    equals: string;
  };
}

// ---------------------------------------------------------------------------
// OutputDefinition — describes a single output port on a node.
//
// Every OutputDefinition generates:
//   1. A React Flow source Handle on the right side of the node
//   2. A field in the auto-generated Zod output schema
//   3. An optional result preview (image thumbnail, text snippet, audio player)
// ---------------------------------------------------------------------------
export interface OutputDefinition {
  /** Unique key used as the React Flow handle ID */
  key: string;

  /** Data type — determines handle color and result preview behavior */
  type: IOType;

  /** Human-readable label shown next to the handle */
  label: string;

  /** Handle color override (auto-derived from type if not specified) */
  handleColor?: HandleColor;
}

// ---------------------------------------------------------------------------
// ProviderEndpoint — a single API endpoint within a provider.
// Nodes can have multiple endpoints (e.g., text-to-image vs image-edit)
// selected based on which inputs are present.
// ---------------------------------------------------------------------------
export interface ProviderEndpoint {
  /** Unique endpoint identifier */
  id: string;

  /** Human-readable name (e.g., "Text to Image", "Image Edit") */
  name: string;

  /** Trigger.dev task ID that handles this endpoint */
  taskId: string;

  /**
   * Maps node input keys → task payload keys.
   * Example: { "prompt": "userMessage", "image_url": "imageUrl" }
   * If not specified, input keys are passed through as-is.
   */
  inputMapping?: Record<string, string>;

  /**
   * Maps task output keys → node output keys.
   * Example: { "url": "image_url" }
   * If not specified, output keys are passed through as-is.
   */
  outputMapping?: Record<string, string>;

  /**
   * Condition function that determines if this endpoint should be used.
   * Receives the merged inputs and returns true if this endpoint matches.
   * If omitted, the endpoint is used as the default/fallback.
   */
  condition?: (inputs: Record<string, unknown>) => boolean;
}

// ---------------------------------------------------------------------------
// ProviderConfig — a single provider (e.g., "fal", "openrouter", "internal").
// The orchestrator tries providers in order until one succeeds.
// ---------------------------------------------------------------------------
export interface ProviderConfig {
  /** Provider identifier (e.g., "fal", "openrouter", "ffmpeg") */
  id: string;

  /** Human-readable provider name */
  name: string;

  /** Available endpoints for this provider */
  endpoints: ProviderEndpoint[];

  /** Timeout in milliseconds for this provider */
  timeout: number;

  /** Number of retries per-provider before falling back to the next */
  retryCount: number;
}

// ---------------------------------------------------------------------------
// CreditsFunctions — cost estimation and calculation for a node.
// The credits system calls estimate() before execution and calculate() after.
// ---------------------------------------------------------------------------
export interface CreditsFunctions {
  /**
   * Pre-execution cost estimate, shown to user before running.
   * @param inputs - The merged input values
   * @returns Estimated credit cost (1,000,000 credits = $1.00)
   */
  estimate: (inputs: Record<string, unknown>) => number;

  /**
   * Post-execution actual cost calculation, recorded in the ledger.
   * @param inputs - The merged input values
   * @param response - The raw provider response
   * @returns Actual credit cost
   */
  calculate: (inputs: Record<string, unknown>, response: unknown) => number;
}

// ---------------------------------------------------------------------------
// NodeUI — visual/layout metadata for the node component.
// ---------------------------------------------------------------------------
export interface NodeUI {
  /** Accent color for the node header icon (Tailwind color class) */
  color: string;

  /** Node width in pixels */
  width: number;

  /** Section group names for organizing inputs visually */
  sectionGroups?: string[];

  /** Whether to show an output preview area (image/text/audio) */
  showOutputPreview?: boolean;

  /** The output key whose result should be displayed in the preview */
  previewOutputKey?: string;
}

// ---------------------------------------------------------------------------
// NodeConfig — THE COMPLETE DNA OF A NODE.
//
// This is the single source of truth. From this one object, the system
// automatically generates:
//   - A React Flow node component (via GenericNode.tsx)
//   - A sidebar palette entry (via registry.getPaletteEntries())
//   - Zod input/output validation schemas (via registry.getInputSchema())
//   - Orchestrator dispatch logic (via registry.getEndpoint())
//   - Credit cost estimation (via config.credits.estimate())
//   - TypeScript types (via z.infer<> on generated schemas)
// ---------------------------------------------------------------------------
export interface NodeConfig {
  /** Unique node type identifier (e.g., "crop", "seedream-4.5") */
  id: string;

  /** Human-readable display name (e.g., "Crop Image", "Seedream 4.5") */
  name: string;

  /** Short description for tooltips and sidebar */
  description: string;

  /** Category for sidebar grouping */
  category: NodeCategory;

  /** Lucide icon name (e.g., "Crop", "Image", "Bot") */
  icon: string;

  /** Semantic version (e.g., "1.0.0") */
  version: string;

  /** Input port definitions — generates handles + UI controls + Zod fields */
  inputs: InputDefinition[];

  /** Output port definitions — generates handles + Zod fields */
  outputs: OutputDefinition[];

  /** Ordered list of providers (fallback chain) */
  providers: ProviderConfig[];

  /** Credit cost functions */
  credits: CreditsFunctions;

  /** Visual/layout metadata */
  ui: NodeUI;

  /**
   * If true, this node is a passthrough (Text, Image, Video upload).
   * Passthrough nodes resolve immediately without dispatching to Trigger.dev.
   * Their outputs are simply their input values mapped to output keys.
   */
  isPassthrough?: boolean;

  /**
   * For passthrough nodes: maps input keys to output keys.
   * Example: { "text": "text_output" } means input "text" becomes output "text_output"
   */
  passthroughMapping?: Record<string, string>;

  /**
   * If true, the auto-generated Zod input schema uses `.passthrough()` to
   * allow dynamic keys (e.g., `dialogue_text_0`, `dialogue_text_1`) to survive
   * runtime validation in the orchestrator. Used by nodes that render dynamic
   * handles from compound editors like DialogueEditor.
   */
  allowDynamicHandles?: boolean;
}

// ---------------------------------------------------------------------------
// Utility type — extracts the type string union from a NodeConfig's inputs
// ---------------------------------------------------------------------------
export type NodeInputKeys<C extends NodeConfig> = C["inputs"][number]["key"];
export type NodeOutputKeys<C extends NodeConfig> = C["outputs"][number]["key"];

// ---------------------------------------------------------------------------
// Handle color defaults — derived from IOType when not explicitly set
// ---------------------------------------------------------------------------
export const DEFAULT_HANDLE_COLORS: Record<IOType, HandleColor> = {
  text: "yellow",
  image: "blue",
  video: "blue",
  audio: "pink",
  number: "orange",
  boolean: "green",
  select: "yellow",
  file: "blue",
};

// ---------------------------------------------------------------------------
// Handle color → Tailwind class mapping for the GenericNode renderer
// ---------------------------------------------------------------------------
export const HANDLE_COLOR_CLASSES: Record<HandleColor, {
  bg: string;
  ring: string;
  ringHover: string;
}> = {
  blue: {
    bg: "!bg-blue-500",
    ring: "!ring-blue-500/40",
    ringHover: "hover:!ring-blue-500/70",
  },
  yellow: {
    bg: "!bg-yellow-500",
    ring: "!ring-yellow-500/40",
    ringHover: "hover:!ring-yellow-500/70",
  },
  pink: {
    bg: "!bg-pink-500",
    ring: "!ring-pink-500/40",
    ringHover: "hover:!ring-pink-500/70",
  },
  orange: {
    bg: "!bg-orange-400",
    ring: "!ring-orange-400/40",
    ringHover: "hover:!ring-orange-400/70",
  },
  green: {
    bg: "!bg-emerald-500",
    ring: "!ring-emerald-500/40",
    ringHover: "hover:!ring-emerald-500/70",
  },
  purple: {
    bg: "!bg-violet-500",
    ring: "!ring-violet-500/40",
    ringHover: "hover:!ring-violet-500/70",
  },
};
