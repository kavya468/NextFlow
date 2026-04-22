# NextFlow Security & Architecture Audit: Zod Validation Deep-Dive

This report details a comprehensive audit of all `zod` validation schemas across the NextFlow codebase. It maps exactly where validation occurs, the precise constraints invoked, and the architectural principles enforced at each boundary. NextFlow employs a rigorous "Defense in Depth" validation strategy across three main layers: the API, the Node Contracts, and the Execution Engine.

---

## 1. The API Layer (tRPC & OpenAPI)
The API layer acts as the outermost shield, preventing malformed requests from ever reaching the database or triggering execution logic. All files mapped from `server/trpc/routers/`.

### `workflowRouter` (`server/trpc/routers/workflow.ts`)
- **`save`**: Uses `SaveWorkflowSchema`
  - Constraints: `name: z.string().max(100).optional()`
  - Impact: Prevents malicious or erroneous input from creating massive workflow names that could break UI layouts or cause database anomalies.
- **`update`**: 
  - Constraints: `{ id: z.string(), name: z.string().optional(), nodes: z.array(z.any()).optional(), edges: z.array(z.any()).optional() }`
  - Impact: Enforces lightweight partial updates while ensuring arrays are truly arrays.
- **`execute`**: Uses `ExecuteWorkflowSchema`
  - Constraints: `nodes: z.array(NodeSchema).min(1, "At least one node is required")`
  - Impact: Prevents execution of empty graphs, which would otherwise create pointless DB records and trigger empty job runs.
- **`rename`**: 
  - Constraints: `{ id: z.string(), name: z.string().min(1) }`
  - Impact: Guarantees that users cannot rename a workflow to an empty string.

### `creditsRouter` (`server/trpc/routers/credits.ts`)
- **`getHistory`**: 
  - Constraints: `{ limit: z.number().min(1).max(100).default(20), cursor: z.string().optional() }`
  - Impact: Strict pagination bounds. Prevents Denial of Service (DoS) and data scraping by capping the return payload to 100 records maximum per request.

### `apiKeysRouter` (`server/trpc/routers/apiKeys.ts`)
- **`create` / `revoke`**:
  - Constraints: `{ name: z.string(), description: z.string().optional() }` and `{ keyId: z.string() }`
  - Impact: Enforces strictly typed and predictable payloads for sensitive Unkey API interactions.

### `publicApiRouter` (`server/trpc/routers/public-api.ts`)
- **OpenAPI Inputs & Outputs**:
  - Constraints: Heavily utilizes `.output()` schemas to enforce strict JSON shapes for public API consumers.
  - Impact: Guarantees API contracts. If the internal DB logic changes, the `.output()` schemas prevent accidental leakages of internal backend fields to the public REST endpoints.

---

## 2. The Node System (The Black-Box Contracts)
The Hackathon strictly demands a "Node as a Black Box" architecture. This means nodes do not trust their incoming data implicitly via React Flow UI constraints. 

### Dynamic Zod Generation (`lib/nodes/registry.ts`)
Rather than hardcoding rigid Zod schemas for every single node type, `NodeRegistry` dynamically compiles Zod schemas from static JSON definitions in `lib/nodes/configs/`.

When `registry.getInputSchema(nodeType)` is evaluated:
- **`text|image|video`**: Becomes `z.string()`. If `maxLength` is config-defined, `.max()` is enforced.
- **`number`**: Uses `z.coerce.number()`. If bounds exist, `.min()` and `.max()` are gracefully applied.
- **`boolean`**: Uses `z.coerce.boolean()`.
- **`select`**: Generates a strict `z.enum([...values])` based on the `options` key, preventing spoofed string assignments.
- **`multi`**: Wraps the schema inside `z.array()`.

### Example Configurations Imposing Hard Limits (`lib/nodes/configs/`):
1. **Seedream 4.5 (`seedream.config.ts`)**:
   - `guidance_scale`: Evaluates to `z.coerce.number().min(1).max(20)`
   - `num_inference_steps`: Evaluates to `z.coerce.number().min(1).max(50)`
2. **Kling O1 Video (`kling.config.ts`)**:
   - `mode`: Evaluates to `z.enum(["reference", "edit"])`
3. **OpenRouter LLM (`openrouter.config.ts`)**:
   - `model`: Evaluates to `z.enum(["google/gemini-2.5-pro", "anthropic/claude-3-opus", "meta-llama/llama-3-8b-instruct"])`

### React Flow Connection Mapping
Because workflow variables dynamically route between nodes via wires, React Flow handles check `isTypeCompatible()`, treating "Text" as the universal wire. However, before node execution starts, the registry's dynamically built `.partial().safeParse()` intercepts the payload. By using `z.coerce`, text wired into a number port seamlessly parses into the required numeric bounds natively dropping arbitrarily bad data, and throwing explicit workflow errors if Enum or strict schema injections fail execution validation.

---

## 3. The Orchestrator & Execution Engine
The `src/trigger/` task orchestrators represent the final network-level boundary. Here, Zod protects against both malformed incoming job payloads, and malformed outputs from external provider webhooks (e.g., fal.ai, OpenRouter).

### Input Sanity Checks (Protecting Ext. Providers)
- **`ffmpeg-merge-videos.task.ts` (`taskInputSchema`)**:
  - Uses `z.preprocess()` to cleverly normalize disparate single-string comma-separated URLs down into arrays, followed strictly by `z.array(z.string().url()).min(2, "At least two video URLs are required")`. 
  - *Why it matters*: Stops the internal server node from attempting to spawn a headless FFmpeg instance with fewer than 2 videos to merge, averting hard server crashes.
- **`openrouter.task.ts` (`openRouterInputSchema`)**:
  - `user_message: z.string().trim().min(1, "User Message is required")`.
  - *Why it matters*: Validations explicitly prevent triggering wasteful, non-refundable billable API payloads.
- **`elevenlabs.task.ts` (`taskInputSchema`)**:
  - `stability: z.number().min(0).max(1).optional()`.
  - *Why it matters*: Ensures parameters remain within bounds for ElevenLabs.

### Output & Webhook Validation (Protecting NextFlow's integrity)
When external APIs like fal.ai finish their asynchronous generation and respond via `waitpoint` webhooks, Zod acts as the defensive perimeter.
- **`elevenlabs.task.ts`**:
  - `falWebhookSuccessSchema`: Implements `payload: z.object({ audio: z.object({ url: z.string().url() }) })`.
  - `falWebhookErrorSchema`: Implements `status: z.literal("ERROR")` combined with an `error` string.
  - *Why it matters*: Remote callbacks are fundamentally untrusted payload injections. If fal.ai deprecates their system, or changes their JSON schema, this Strict Zod Schema prevents bad data—or `undefined` URLs—from being successfully persisted as standard text to the NextFlow SQL database as a successful execution output.
