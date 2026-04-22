# Phase 1: Deep Codebase Audit — API Design & MCP

## A. API Design & Integration Quality

### A1. RESTful Design — Mixed Quality

**What you did:** Your public API (`public-api.ts`) uses `trpc-to-openapi` to expose REST endpoints. The paths are reasonable: `GET /v1/workflows`, `POST /v1/workflows/{id}/execute`. This is decent.

**What the correct mental model is:** REST is about *resources and state transitions*. Your `POST /v1/workflows/{id}/execute` is actually an RPC-style verb on a resource — a purist would model this as `POST /v1/workflows/{id}/runs` (creating a new Run resource). The distinction matters because "execute" tells you nothing about what resource was created, whereas "runs" tells you a Run was born, and the response should include its URI.

**Why it matters:** In an interview, if asked "is this RESTful?", you need to articulate that your API is *pragmatically RESTful* — resource-oriented paths but with RPC-style actions. Stripe, GitHub, and most real APIs do this. The key is knowing *why* you chose it and what you traded away (HATEOAS, uniform interface purity).

**Good:** You have API versioning (`/v1/`). This is correct. Many candidates miss this entirely.

### A2. HTTP Status Codes — Significant Gap

**What you did:** In `upload/route.ts`, you return `413` for parse failures (correct), `400` for missing file (correct), `500` for config errors (correct). This is actually decent.

**What the correct mental model is:** However, your tRPC error codes have a conceptual problem. In `workflow.ts` line 195, you throw `FORBIDDEN` for insufficient credits. `403 FORBIDDEN` means "you don't have *permission*." Insufficient credits is `402 PAYMENT_REQUIRED`. This reveals you're mapping business logic to HTTP status codes by feel, not by spec. A senior engineer knows that `403` = authz failure, `402` = payment, `409` = conflict, `422` = valid syntax but semantically wrong.

**What to study:** HTTP status code semantics — especially 402, 409, 422, 429. Know when to use each one and why.

### A3. Idempotency — Completely Absent

**What you did:** Your `POST /v1/workflows/{id}/execute` creates a new Run and triggers a Trigger.dev task every time it's called. There is no idempotency key anywhere in the codebase.

**What the correct mental model is:** When a client POSTs and gets a network timeout, they don't know if the server processed the request. They retry. Without idempotency, you now have *two* runs executing, *two* credit deductions, and a confused user. Stripe solves this with an `Idempotency-Key` header — if the same key is sent twice, the second request returns the first response without re-executing. This is table-stakes for any API that creates resources or charges money.

**Why it matters:** This is the single most likely "gotcha" question in a senior API design interview. "How do you handle retries on your payment/execution endpoint?" If your answer doesn't include idempotency keys, it's a red flag.

**What to study:** Stripe's idempotency key implementation. Understand: where to store the key (DB), what to return on duplicate (cached response), TTL (24h typical).

### A4. Rate Limiting — Present but Incomplete

**What you did:** Your API key creation in `apiKeys.ts` supports rate limit configuration via Unkey (`limit` + `duration`). This is good — you're using a managed rate-limiting service.

**What's missing:** There is no rate limiting on the *upload endpoint* (`/api/upload`). Someone could spam your Transloadit assembly creation and burn through your Transloadit credits. There's also no rate limit on the tRPC procedures themselves — an attacker with a valid Clerk session could call `workflow.execute` in a loop.

**What to study:** The difference between *authentication* (who are you), *authorization* (what can you do), and *rate limiting* (how often). All three must be present on every mutation endpoint.

### A5. Error Handling — Leaking Internals

**What you did:** In `upload/route.ts` line 215, you return `error.message` directly to the client. In `public-api.ts`, tRPC errors bubble up with stack traces in development.

**What the correct mental model is:** There are two categories of errors: (1) *user-safe errors* — "Insufficient credits", "File too large", "Workflow not found" — these are intentional messages you *design*. (2) *internal errors* — Prisma connection failed, null pointer, OOM — these must NEVER reach the user. You should have an error boundary that catches unexpected errors and returns a generic `{ error: "Internal server error", requestId: "abc123" }`. The `requestId` lets you correlate with server logs without exposing internals.

**Why it matters:** Leaking error internals is both a security risk (attackers learn your stack) and a UX failure (users see gibberish). In an interview, if you can't articulate the user-safe vs internal error distinction, it signals you haven't operated a production system.

### A6. Request/Response Validation — Strong on Input, Weak on Output

**What you did well:** You have Zod schemas everywhere — `ExecuteWorkflowSchema`, per-node input schemas, task input validation. The orchestrator even does *runtime* Zod validation of merged inputs (line 300-319). This is genuinely good. Most codebases at this stage have zero runtime validation.

**What you missed:** Your tRPC procedures use `z.any()` extensively. In `workflow.ts` line 89: `nodes: z.array(z.any())`. In `save` mutation line 60-61: `nodes as any`, `edges as any`. Every `z.any()` is a hole in your validation — it's saying "I accept literally anything and trust it blindly." The `as any` casts are the TypeScript equivalent of closing your eyes and hoping.

**What to study:** The principle of *parse, don't validate* (Alexis King's article). Every boundary between your system and the outside world should have a parser that transforms unknown input into a known type. `z.any()` is the opposite of this.

---

## B. MCP-Specific Issues

### B1. Tool Descriptions — Developer-Centric, Not LLM-Centric

**What you did:** Your tool descriptions are written for a developer reading docs:
- `create_workflow`: "Create a new empty workflow. Requires a user ID (Clerk) that owns the workflow."
- `execute_workflow`: "Execute a workflow via Trigger.dev. Creates a Run record and fires the orchestrate-workflow task on the deployed Trigger.dev instance."

**What the correct mental model is:** An LLM doesn't know what Clerk is. It doesn't know what Trigger.dev is. It doesn't care about Run records. Tool descriptions should answer: *"When should I use this tool, what does it need, and what will it give me back?"* — from the model's perspective.

Good: "Create a new workflow with a given name and optional description. Returns the workflow ID for use in subsequent operations."

Bad: "Create a new empty workflow. Requires a user ID (Clerk) that owns the workflow." (Mentions implementation details, confuses the LLM about whether userId is actually required)

**Why it matters:** If the LLM reads "Requires a user ID (Clerk)", it will *try to provide one* — and hallucinate a value. The description actively causes hallucination. This was the *exact feedback* you received: "my MCP workflow asks for a user_id that a real user would never have access to."

**What to study:** Anthropic's MCP tool description best practices. The key principle: descriptions should describe *intent and usage*, not *implementation*.

### B2. Internal IDs Exposed to Users — The Core UX Failure

Every tool that requires an internal ID is flagged below:

| Tool | Input | Problem | Resolution Pattern |
|------|-------|---------|-------------------|
| `create_workflow` | `userId` | Users don't know their Clerk ID | Session injection — the server should resolve this from the auth context, never ask for it |
| `execute_workflow` | `workflowId` | Users know workflow *names*, not UUIDs | Lookup by name — accept `workflowName` and resolve to ID server-side |
| `get_execution_status` | `executionId` | Users don't memorize Run UUIDs | Context chain — the `execute_workflow` response provides this; also support "get status of my last execution" |
| `manage_node` | `workflowId` | Same as above | Lookup by name |
| `manage_node` | `nodeId` | For update/delete — users know node *labels*, not generated IDs | Lookup by label within workflow |
| `manage_edge` | `workflowId`, `edgeId` | Same pattern | Lookup by name; edges by source+target node labels |

**What the correct mental model is:** The MCP server is an *intermediary* between a human (via LLM) and your system. Humans think in names, labels, and natural language. Your system thinks in UUIDs. The MCP server's job is to *bridge that gap*. Every internal ID should either be (a) auto-resolved from context/session, or (b) looked up from a human-friendly identifier the LLM can ask for naturally.

**Why it matters:** This is literally the feedback you received. It's not a code bug — it's a *mental model failure*. You built the MCP server as a thin DB wrapper instead of as a *user experience layer*.

### B3. Tool Atomicity — Reasonably Good

**What you did well:** Your tools are mostly atomic — `create_workflow`, `manage_node`, `manage_edge` are separate, composable operations. The LLM can create a workflow, then add nodes, then wire edges. This is correct MCP design.

**What could be better:** `manage_node` overloads add/update/delete into one tool with an `action` enum. An LLM has to understand "when action=add, nodeType is required but nodeId is optional; when action=delete, nodeId is required but nodeType is ignored." This conditional parameter logic is hard for LLMs. Three separate tools (`add_node`, `update_node`, `delete_node`) would eliminate parameter confusion entirely.

**What to study:** The principle of *command segregation* in tool design — each tool should have one clear set of required parameters, not conditional requirements based on a mode flag.

### B4. Error Responses — Partially Helpful

**What you did:** `toMcpError` returns `{ content: [{ type: "text", text: "Error: <message>" }], isError: true }`. This is structurally correct per MCP spec.

**What's missing:** The error messages don't guide recovery. "Workflow not found: abc-123" tells the LLM *what failed* but not *what to do next*. A recovery-friendly error would be: "Workflow not found with ID 'abc-123'. Use list_workflows to find available workflow IDs, or create a new workflow with create_workflow."

**Why it matters:** When an LLM gets an unhelpful error, it guesses at a fix — this is hallucination. When it gets a prescriptive error, it follows the instruction. The difference between "the LLM gets stuck in a loop" and "the LLM self-corrects" is entirely in your error messages.

### B5. No Resources or Prompts Layer

**What you did:** Everything is in tools. Your MCP server has zero `resources` and zero `prompts` registered (confirmed via `list_resources` returning empty).

**What the correct mental model is:** MCP has three layers:
- **Resources**: Static or semi-static data the LLM can *read* to build context (e.g., "list of available node types and their descriptions", "current user's workflow names"). Resources are like GET endpoints — they provide context without side effects.
- **Prompts**: Predefined prompt templates that guide the LLM through complex multi-step workflows (e.g., "build a video pipeline" prompt that tells the LLM the standard node sequence).
- **Tools**: Actions with side effects (create, execute, delete).

You're forcing the LLM to discover everything through trial-and-error with tools, when it should be able to *read* the available node types, their inputs/outputs, and handle names from a resource. This would massively reduce hallucination.

**What to study:** The MCP specification's resources and prompts sections. Think about what information the LLM needs *before* it starts calling tools — that's a resource.

### B6. Concurrency Handling — Genuinely Good

**What you did well:** `manage_node` and `manage_edge` both use `SELECT ... FOR UPDATE` inside Prisma interactive transactions. This prevents lost-update race conditions when multiple MCP calls modify the same workflow concurrently. This is senior-level thinking. Most people miss this entirely.
