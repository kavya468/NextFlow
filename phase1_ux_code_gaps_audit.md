# Phase 1: Deep Codebase Audit — UX, Code Quality, Conceptual Gaps

## C. User Experience Failures

### C1. Credentials Committed to Source Control — CRITICAL SECURITY FAILURE

**What you did:** Your `.env.local` contains every secret in plaintext — database passwords, API keys (FAL_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, CLERK_SECRET_KEY, UNKEY_ROOT_KEY), and a full Vercel OIDC JWT token. Your `.mcp.json` contains the raw `DATABASE_URL` with username and password embedded.

**What the correct mental model is:** Secrets NEVER go in files that could be committed or shared. `.env.local` should be in `.gitignore` (check if it is — if it ever wasn't, the secrets are in git history forever). But `.mcp.json` is likely committed and contains your full database connection string with credentials. Anyone who clones your repo has full database access.

The correct pattern: `.mcp.json` should reference env vars (`$DATABASE_URL`), not contain the raw value. Secrets should be rotated immediately if they've ever been in version control.

**Why it matters:** If an interviewer opens your repo and sees credentials in committed files, the interview is over. This is the #1 disqualifying security failure. It's not about being careful — it's about whether you understand the *principle* of secret management.

**What to study:** The 12-Factor App methodology, specifically Factor III (Config). Understand: secrets in env vars, never in code; secret rotation; git-crypt or vault for sensitive config.

### C2. Raw IDs and JSON Dumped to Users

**What you did:** `toMcpResult` in `errors.ts` does `JSON.stringify(data, null, 2)` and returns it as a text block. When a user creates a workflow, they get back:

```json
{
  "id": "a1b2c3d4-e5f6-...",
  "name": "My Workflow",
  "createdAt": "2026-04-18T..."
}
```

**What the correct mental model is:** The LLM receives this and has to parse JSON from a text string. While this *works*, it's not the ideal MCP pattern. More importantly, execution status returns raw nodeRun objects with internal IDs, status codes, and null fields. A human-friendly response would be: "Workflow 'My Workflow' created successfully. You can now add nodes to it." The LLM can then present this naturally to the user instead of dumping JSON.

**Why it matters:** The MCP → LLM → User chain means your response will be *paraphrased* by the LLM. If you give it structured, human-meaningful text, the paraphrase is accurate. If you give it raw JSON with internal fields, the LLM may misinterpret field semantics.

### C3. Missing Defaults and Fallbacks

**What you did:** `list_workflows` defaults `limit=20, offset=0`. This is correct. `create_workflow` auto-resolves `userId` via env var or latest workflow. This is a good improvement.

**What's still missing:**
- `execute_workflow` requires an exact `workflowId` with no fallback. If a user says "run my workflow," the LLM has no way to know which one without first calling `list_workflows`. A `workflowName` alternative would eliminate that round-trip.
- `manage_node` position defaults to `{x: 100, y: 100}` — every new node lands on the same spot. An auto-layout or sequential offset would be better UX.
- No tool provides `examples` in its schema descriptions. LLMs perform significantly better when they see example values in parameter descriptions.

### C4. Onboarding — What Confuses Someone on Day 1

A new user connecting your MCP server to Claude Desktop would:

1. Need to know the compiled JS path (`dist/mcp/server.js`) — they need to have built the project first
2. Need to paste a raw DATABASE_URL into their MCP config — they need DB access
3. Have no resource listing to understand what node types exist or what they can build
4. Try to create a workflow and potentially get asked for a userId they don't have
5. Need to know valid `nodeType` values (like "seedream-4.5", "llm", "crop") from memory — there's no discovery mechanism

**What the correct mental model is:** A well-designed MCP server is *self-documenting*. It should have resources that list available node types, describe what each does, and show valid handle names. A new user should be able to say "what can I build?" and get a useful answer without reading source code.

---

## D. Code Quality & Architecture

### D1. Separation of Concerns — Partially Achieved

**What you did well:** You have a clear layered architecture:
- `lib/mcp/tools/` — MCP transport layer
- `server/trpc/routers/` — tRPC transport layer
- `lib/nodes/registry.ts` — business logic (node resolution, validation)
- `lib/credits/credit-service.ts` — domain service
- `prisma/schema.prisma` — data access

**What you did wrong:** Your MCP tools talk directly to Prisma. `create-workflow.ts` calls `db.workflow.create()`. Your tRPC router also calls `ctx.prisma.workflow.create()`. You have *two separate code paths* doing the same thing with different validation, different error handling, and different response shapes. This violates DRY and makes bugs inevitable — fix a validation rule in tRPC, forget to update MCP, and now you have inconsistent behavior.

**What the correct mental model is:** Both the MCP server and tRPC server should call the *same* service layer. The transport layer (MCP/tRPC) handles auth and serialization. The service layer handles business logic. The data layer handles persistence. Your MCP server should call the same functions your tRPC router calls, not duplicate the Prisma queries.

**Why it matters in an interview:** "How do you avoid duplicating logic between your REST API and your MCP server?" If your answer is "they both call Prisma directly," that's a junior answer. The senior answer is "they both call a shared service layer."

### D2. Global Mutable State

**What you did:** `lib/mcp/utils/db.ts` has a module-level `let client: PrismaClient | undefined` singleton. `lib/db.ts` has a *different* singleton pattern using `globalThis` plus a Proxy. The node registry in `registry.ts` is a module-level singleton with mutable Maps.

**What the correct mental model is:** Module-level singletons are acceptable for DB clients and registries in Node.js — it's a standard pattern. The Proxy pattern in `db.ts` is clever (lazy initialization) but adds indirection that makes debugging harder. Having *two different* Prisma initialization patterns (one for MCP, one for Next.js) is the real problem — it means you might end up with two separate connection pools in the same process, or different configurations between them.

### D3. Type Safety — Significant `any` Pollution

Every `any` in your codebase is a place where TypeScript can't protect you:

- **`orchestrator.ts` line 55:** `nodes: any[]` — the entire orchestrator runs on untyped node data. If a node has a missing `type` field, you find out at runtime, not compile time.
- **`workflow.ts` lines 60-61, 89, 115, 208-209:** `nodes as any`, `z.array(z.any())` — tRPC accepts literally anything for nodes/edges.
- **`public-api.ts` line 14:** `{ userId: ctx.apiUserId } as any` — forcing a type mismatch instead of making the auth context compatible.
- **`execute-workflow.ts` line 70:** `tasks.trigger<any>` — you lose all type checking on the task payload.

**What the correct mental model is:** Every `any` is a *contract you're choosing not to enforce*. The TypeScript compiler can verify that your orchestrator payload matches your task's expected input — but only if you type both sides. When you write `tasks.trigger<any>()`, you're telling TypeScript "I know better" — but you don't, because if the payload shape changes, nothing catches it.

**Why it matters:** In a senior interview, if asked "how do you ensure type safety across service boundaries?", pointing to `any` is the wrong answer. The correct answer involves shared types, runtime validation at boundaries (which you do have with Zod), and generic type parameters on SDK calls.

### D4. Test Coverage — Near Zero

**What exists:** One test file: `webhook-signing.test.ts` (143 lines). It's well-written — proper setup/teardown, edge cases, roundtrip verification. This is genuinely good test design.

**What's missing:** Zero tests for:
- The orchestrator (704 lines of complex DAG execution logic — the most critical code in the system)
- Any MCP tool
- Any tRPC procedure
- The node registry (schema generation, endpoint resolution, passthrough resolution)
- Credit calculation and deduction
- The upload route
- Any node config validation

**What the correct mental model is:** The orchestrator is your *most complex and most critical* code path. It handles topological sorting, parallel execution, input wiring, Zod validation, credit deduction, and error recovery. It has exactly zero tests. If you change the edge-wiring logic and break downstream input resolution, nothing catches it until a user's workflow fails in production.

**Why it matters:** "What's your test strategy?" is a guaranteed interview question. "I have one test file" is not a viable answer. You need to articulate: unit tests for pure logic (registry, topo sort), integration tests for the orchestrator with mock tasks, and contract tests for the MCP tools.

### D5. Async Hazards

**What you did:** In `orchestrator.ts`, you use `await` correctly throughout. The `batch.triggerAndWait` pattern is properly awaited. Error handling catches both individual node failures and batch infrastructure failures. This is solid.

**What's concerning:** In `workflow.ts` lines 230-238, you create NodeRun records in a sequential loop with `await` inside a `for` loop. This is `O(n)` sequential DB calls. With 20 nodes, that's 20 round-trips to Neon Postgres. The correct pattern is `createMany` or a single transaction with batch insert.

---

## E. Conceptual Gaps

### E1. MCP is a UX Layer, Not a DB Wrapper

- **What you did:** Built MCP tools as thin wrappers around Prisma queries
- **Correct mental model:** MCP is a *user experience abstraction*. It should accept human-friendly inputs, resolve them to internal IDs, execute business logic through a service layer, and return human-meaningful responses. It's closer to a CLI than a database API.
- **Why it matters:** This is the exact feedback you received. The gap isn't in your code — it's in how you *think about* what an MCP server is for.
- **What to study:** Compare your MCP server to the Anthropic filesystem MCP server or the GitHub MCP server. Notice how they accept paths and repo names, not internal IDs.

### E2. Defense in Depth vs Single-Layer Validation

- **What you did:** Validate inputs at the tRPC level OR the task level, not consistently at both
- **Correct mental model:** Every trust boundary needs its own validation. The tRPC layer validates what the *client* sends. The orchestrator validates the *merged* inputs (you do this — good). The task validates what the *orchestrator* sends. Each layer trusts nothing from the layer above. This is "defense in depth."
- **Why it matters:** Your tasks duplicate Zod schemas from the registry. If the registry schema changes but the task schema doesn't, you get silent mismatches.
- **What to study:** The concept of trust boundaries in system design. Draw a diagram of your system and mark every point where data crosses a trust boundary.

### E3. Credit System — No Reservation Pattern

- **What you did:** Check balance before execution, deduct after completion. Between check and deduction, the user could trigger another workflow and overspend.
- **Correct mental model:** The correct pattern is *reserve → execute → settle*. Before execution, you create a negative ledger entry (reservation). After completion, you adjust it to the actual cost. If execution fails, you release the reservation. This prevents double-spend in concurrent scenarios.
- **Why it matters:** You actually reference this pattern in your comments ("Block-on-estimate at tRPC level") but didn't implement it. An interviewer will ask "what happens if two workflows execute simultaneously?" and your current answer has a race condition.
- **What to study:** Two-phase commit patterns for financial transactions. Stripe's authorization/capture model. The concept of optimistic vs pessimistic concurrency control.

### E4. The `as any` Pattern Reveals Type System Misunderstanding

- **What you did:** Used `as any` to force incompatible types to compile: `{ userId: ctx.apiUserId } as any` in public-api.ts
- **Correct mental model:** `as any` means "I know these types don't match, but I'm going to pretend they do." The correct fix is to make the types *actually compatible* — either by creating a shared auth interface that both Clerk auth and API key auth satisfy, or by using a discriminated union.
- **Why it matters:** In an interview, if you can't explain your type architecture without saying "I cast it to any," it signals you don't understand TypeScript's type system deeply enough for a senior role.
- **What to study:** Discriminated unions, branded types, and the difference between `as` (assertion) and proper type narrowing.

### E5. You Understand DAG Execution — This is a Strength

- **What you did well:** Kahn's algorithm for topological sort, parallel layer execution, cycle detection, partial failure handling (PARTIAL status when some nodes succeed and others fail), single-node failure not crashing the batch. The `emitNodeStatus` real-time metadata pattern is also well-designed.
- **Why it matters:** This is genuinely senior-level thinking. The orchestrator is the strongest code in the codebase. If asked about it in an interview, you can explain it confidently. The gap is not in the algorithm — it's in the *infrastructure around it* (typing, testing, error recovery).

### E6. Webhook Security — Well Implemented

- **What you did well:** HMAC-SHA256 signing of webhook URLs, timing-safe comparison to prevent timing attacks, proper URL encoding. The test coverage for this module is thorough. This shows you understand webhook security.

### E7. The Two-Client Problem

- **What you did:** Two separate Prisma client initialization patterns — `lib/db.ts` (Proxy-based, for Next.js) and `lib/mcp/utils/db.ts` (simple singleton, for MCP server). Different code, same database.
- **Correct mental model:** If these ever run in the same process (e.g., during testing), you'll have two connection pools competing. If they have different configurations (one has logging, one doesn't), debugging becomes confusing. A single shared client factory that both consumers import is the standard pattern.
- **What to study:** The concept of *composition root* — the single place in your application where dependencies are configured and wired together.

### E8. You Don't Have a Service Layer

- **What you did:** tRPC routers contain business logic (validation, credit checks, workflow creation). MCP tools contain the same business logic (workflow creation, node management). There's no shared service layer between them.
- **Correct mental model:** The *hexagonal architecture* pattern: your core business logic lives in a service layer with no knowledge of HTTP, tRPC, or MCP. Transport adapters (tRPC router, MCP tools, REST endpoints) call the service layer. This means adding a new transport (CLI, WebSocket, GraphQL) requires zero business logic duplication.
- **Why it matters:** If asked "how would you add a GraphQL API to this system?", the correct answer is "I'd write a thin GraphQL resolver that calls the same service layer." Your current answer would be "I'd duplicate the Prisma queries a third time."
- **What to study:** Hexagonal architecture (ports and adapters). Clean Architecture by Robert Martin. The difference between a *router* (transport) and a *service* (domain).
