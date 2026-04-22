# Phase 2: Prioritised Learning List

## CRITICAL — Interview Disqualifiers

### 1. [CRITICAL] Secrets Committed to Source/Config Files

**What I got wrong:** Database URL with credentials in `.mcp.json`, all API keys in `.env.local`, Vercel OIDC token in plaintext — all potentially in git history.
**Correct mental model:** Secrets are *never* stored in files that are version-controlled or shared. They live in environment variables injected at runtime, managed by a secrets manager (Vault, Vercel env, AWS Secrets Manager). If a secret has *ever* been in git, it's compromised and must be rotated.
**Why a senior would catch this:** This is the first thing a security-conscious reviewer checks. It's a non-negotiable disqualifier. No amount of good architecture makes up for leaked credentials.
**What to study:** 12-Factor App Factor III (Config). OWASP secrets management guidelines. `git log --all -p -- .mcp.json` to check if it's in history.

### 2. [CRITICAL] MCP Tools Expose Internal IDs to Users

**What I got wrong:** Every MCP tool requires UUIDs (workflowId, executionId, nodeId) that a human user would never know.
**Correct mental model:** MCP is a *UX layer*. It accepts human-friendly identifiers (names, labels, "my last workflow") and resolves them to internal IDs. The server does the lookup, not the user.
**Why a senior would catch this:** This was *literally the feedback you received*. It shows you think about MCP from the developer's perspective, not the user's. A CTO would ask: "Did you ever actually use this as an end user?"
**What to study:** Study the GitHub MCP server — it accepts repo names, not database IDs. Study how Slack's API accepts channel names alongside channel IDs.

### 3. [CRITICAL] No Idempotency on Mutation Endpoints

**What I got wrong:** `POST /execute` creates a new Run every time. Network retries cause duplicate executions and double credit charges.
**Correct mental model:** Any endpoint that creates a resource or charges money must support an `Idempotency-Key` header. Same key = same response, no re-execution. This is the single most common senior API design interview question.
**Why a senior would catch this:** Because they've been on-call when a retry storm caused 47 duplicate charges at 2 AM. This isn't theoretical — it's operational experience.
**What to study:** Stripe's idempotency implementation. The IETF Idempotency-Key draft spec. Understand: key storage, TTL, response caching, concurrent requests with same key.

### 4. [CRITICAL] No Shared Service Layer — Logic Duplicated Across Transports

**What I got wrong:** tRPC routers and MCP tools both contain Prisma queries and business logic, duplicated with different validation and error handling.
**Correct mental model:** Hexagonal architecture — business logic in a service layer, transport adapters (tRPC, MCP, REST) are thin wrappers that delegate. Adding a new transport means zero business logic duplication.
**Why a senior would catch this:** "How would you add a CLI to this system?" → "I'd duplicate the queries a third time" = junior. "I'd write a CLI adapter that calls the same service" = senior.
**What to study:** Hexagonal Architecture (Alistair Cockburn). Ports and Adapters pattern. Clean Architecture by Robert Martin.

### 5. [CRITICAL] Tool Descriptions Cause LLM Hallucination

**What I got wrong:** Tool descriptions mention implementation details (Clerk, Trigger.dev, Run records) that confuse the LLM and cause it to hallucinate parameter values.
**Correct mental model:** Tool descriptions are *prompts* for the LLM. They should describe *when to use* the tool, *what inputs are needed* in user terms, and *what the output means*. Never mention internal systems.
**Why a senior would catch this:** Because they'd test the MCP server with an actual LLM and watch it hallucinate a userId on the first call.
**What to study:** Anthropic's tool use documentation. The concept of "tool descriptions as prompts." Test your tools with Claude and observe where it struggles.

---

## IMPORTANT — Production & Architecture Gaps

### 6. [IMPORTANT] Credit System Has a Race Condition

**What I got wrong:** Check balance → execute → deduct. Between check and deduct, concurrent executions can overspend.
**Correct mental model:** Reserve → execute → settle. Create a pending negative ledger entry before execution, adjust after completion, release on failure. This is the authorization/capture pattern from payment processing.
**Why a senior would catch this:** Because the code *comments* describe this pattern but the *implementation* doesn't do it. That gap between intention and execution is a red flag.
**What to study:** Stripe's authorization vs capture model. Pessimistic vs optimistic concurrency. SELECT FOR UPDATE with reservation rows.

### 7. [IMPORTANT] `any` Type Pollution Defeats TypeScript

**What I got wrong:** `nodes: any[]` in the orchestrator, `z.array(z.any())` in tRPC, `as any` casts throughout. TypeScript provides zero safety on critical paths.
**Correct mental model:** Types are *contracts*. Every `any` is a broken contract. The orchestrator payload should have a typed interface. Task triggers should use generic type parameters. Auth contexts should use discriminated unions.
**Why a senior would catch this:** They'd search for `any` in the codebase and count occurrences. High counts signal someone who treats TypeScript as "JavaScript with extra steps" rather than a type system.
**What to study:** The `unknown` type (safe alternative to `any`). Discriminated unions for polymorphic data. Generic type parameters on SDK calls.

### 8. [IMPORTANT] Zero Test Coverage on Critical Paths

**What I got wrong:** One test file (webhook signing) out of 50+ source files. Zero tests on the orchestrator, MCP tools, tRPC procedures, registry, and credit system.
**Correct mental model:** Test the *riskiest* code first, not the easiest. The orchestrator has 704 lines of DAG execution, input wiring, credit deduction, and error recovery — with zero tests. A single regression in edge wiring silently breaks every workflow.
**Why a senior would catch this:** "What's your test strategy?" is asked in every senior interview. "I have one test file" ends the conversation.
**What to study:** Testing pyramid (unit → integration → e2e). How to test Trigger.dev tasks with mocks. How to test tRPC procedures with `createCaller`.

### 9. [IMPORTANT] No MCP Resources Layer

**What I got wrong:** No resources registered. The LLM has no way to discover available node types, handle names, or workflow metadata without calling tools.
**Correct mental model:** Resources provide *context* before action. A "node-types" resource listing all available nodes with their inputs/outputs would eliminate most LLM hallucination about valid nodeType values and handle names.
**Why a senior would catch this:** Because they'd ask "how does the LLM know what node types are available?" and the answer is "it doesn't — it guesses."
**What to study:** MCP resources specification. Think about *what information reduces hallucination* — that's what resources are for.

### 10. [IMPORTANT] Error Messages Don't Guide Recovery

**What I got wrong:** MCP errors say *what failed* ("Workflow not found") but not *what to do next*.
**Correct mental model:** Every error should include a *recovery instruction*: "Workflow not found. Use list_workflows to see available workflows." This is the difference between an LLM that self-corrects and one that loops.
**Why a senior would catch this:** They'd test the error flow end-to-end and watch the LLM get stuck.
**What to study:** The concept of "actionable errors." Study how AWS CLI errors include "Did you mean...?" suggestions.

---

## POLISH — Code Quality

### 11. [POLISH] Sequential DB Inserts in Loops

**What I got wrong:** `workflow.ts` lines 230-238 create NodeRun records one at a time in a for loop — O(n) round trips.
**Correct mental model:** `createMany` or a single transaction with batch insert. 20 nodes = 20 DB round trips vs 1.
**What to study:** Prisma `createMany`, database round-trip optimization, N+1 query patterns.

### 12. [POLISH] Two Separate Prisma Client Patterns

**What I got wrong:** `lib/db.ts` uses a Proxy-based lazy singleton. `lib/mcp/utils/db.ts` uses a simple module-level singleton. Different code, same purpose.
**Correct mental model:** One composition root, one client factory, consumed everywhere.
**What to study:** Composition root pattern. Dependency injection in TypeScript.

### 13. [POLISH] manage_node/manage_edge Overloading

**What I got wrong:** One tool with an `action` enum and conditional required parameters.
**Correct mental model:** Three tools with clear, non-conditional parameters each. LLMs handle simple tools better than polymorphic ones.
**What to study:** Command segregation in API/tool design. CQRS principles applied to tool definitions.

### 14. [POLISH] HTTP 403 Used for Insufficient Credits

**What I got wrong:** `FORBIDDEN` for "not enough credits" — conflates authorization with business logic.
**Correct mental model:** 402 Payment Required or 422 Unprocessable Entity. 403 means "you don't have permission," not "you don't have funds."
**What to study:** HTTP status code semantics. RFC 9110 sections on 4xx codes.

### 15. [POLISH] Upload Endpoint Has No Auth or Rate Limiting

**What I got wrong:** `/api/upload` accepts any multipart request with no auth check and no rate limit. Anyone who finds the URL can burn Transloadit credits.
**Correct mental model:** Every mutation endpoint needs auth + rate limiting. Period.
**What to study:** Next.js middleware patterns for protecting API routes. Token bucket rate limiting.

---

# Phase 3: 5-Day Learning Curriculum (10-12 hrs/day)

## Day 1: Security & Secrets + MCP Mental Model Reset

### Morning (4 hrs) — Security Foundations
**Concepts:**
- **Secret management** (depth: understand rotation, envelope encryption, vault patterns)
- **12-Factor App** — read Factors III (Config), VI (Processes), XI (Logs) in full
- **OWASP Top 10** — focus on A07:2021 (Identification and Authentication Failures)
- Audit your git history: `git log --all -p -- .mcp.json .env.local` — understand what's exposed

**Codebase re-examination:**
- Trace every place `process.env` is accessed — map which are secrets vs config
- Check `.gitignore` — is `.env.local` listed? Is `.mcp.json`? Was it always?
- Find every hardcoded credential, magic string, or key that isn't from env vars

**🎯 Interview concept:** "How do you handle secrets in a multi-environment deployment?" You must be able to explain: env var injection, never in code, rotation strategy, what happens when a secret leaks.

### Afternoon (4 hrs) — MCP Mental Model
**Concepts:**
- Read the **full MCP specification** — focus on resources, prompts, and tools as *three distinct layers*
- Study the **Anthropic filesystem MCP server** — notice how it uses paths, not IDs
- Study the **GitHub MCP server** — notice how it accepts repo names, branch names
- Understand: MCP server = *UX layer between human and system*

**Codebase re-examination:**
- List every MCP tool parameter that requires an internal ID
- For each one, write down what a *human* would say instead
- Think about what *resources* would eliminate the need for trial-and-error

**🎯 Proof of understanding:** Explain out loud, without notes: "What is the difference between MCP tools, resources, and prompts? When would you use each? Give an example from my own system."

### Evening (3 hrs) — Tool Description Rewriting (conceptual)
- Write natural-language descriptions for each of your 6 tools from the *model's perspective*
- For each tool, write down: "When should the model call this?" and "What does the user get back?"
- Compare your current descriptions to what you wrote — notice the gap

---

## Day 2: API Design Patterns + Service Architecture

### Morning (4 hrs) — RESTful Design & Idempotency
**Concepts:**
- **Idempotency keys** — study Stripe's implementation in detail. Understand: where the key is stored (DB row), what happens on duplicate (return cached response), TTL (24h), concurrent requests with same key (409 Conflict)
- **HTTP status codes** — memorize: 400 (bad input), 401 (not authenticated), 402 (payment required), 403 (not authorized), 404 (not found), 409 (conflict), 422 (unprocessable), 429 (rate limited)
- **Error response design** — understand: user-safe vs internal errors, request IDs for correlation, structured error objects

**Codebase re-examination:**
- Trace every error path in your tRPC procedures — which ones could leak internals?
- Trace every `TRPCError` code usage — is each one semantically correct?
- Think about what happens if a client retries your execute mutation

**🎯 Interview concept:** "Walk me through what happens when a client retries a POST to your execute endpoint after a timeout." You must explain: duplicate detection, idempotency keys, credit safety.

### Afternoon (4 hrs) — Hexagonal Architecture
**Concepts:**
- **Ports and Adapters** — understand: the "ports" are your service interfaces, the "adapters" are tRPC/MCP/REST
- **Service layer pattern** — a class/module with methods like `createWorkflow()`, `executeWorkflow()`, `getStatus()` that contain ALL business logic
- **Dependency injection** — how to make services testable by injecting the DB client

**Codebase re-examination:**
- List every Prisma query in your MCP tools — these should be in a service
- List every Prisma query in your tRPC routers — same service
- Identify the shared business logic: validation, credit checks, node filtering
- Draw the dependency graph: MCP → ??? → Prisma. What's in the middle?

**🎯 Proof of understanding:** Draw a diagram (whiteboard/paper) showing: HTTP → tRPC adapter → WorkflowService → PrismaClient, and MCP → MCP adapter → WorkflowService → PrismaClient. Explain why this is better than what you have.

### Evening (3 hrs) — Rate Limiting & Auth Boundaries
- Study: token bucket algorithm, sliding window rate limiting
- Understand: auth (who) → authz (what) → rate limit (how often) — three separate concerns
- Map every endpoint in your system: which ones have auth? Which have rate limits? Which have neither?

---

## Day 3: TypeScript Mastery + Testing Strategy

### Morning (4 hrs) — Eliminating `any`
**Concepts:**
- **`unknown` vs `any`** — `unknown` forces you to narrow before use, `any` skips all checks
- **Discriminated unions** — how to model "this could be a Clerk auth context OR an API key context" without `as any`
- **Generic type parameters** — `tasks.trigger<typeof myTask>()` vs `tasks.trigger<any>()`
- **Branded types** — `type WorkflowId = string & { __brand: 'WorkflowId' }` prevents mixing IDs

**Codebase re-examination:**
- Search for every `any` in the codebase: `grep -rn ': any' --include='*.ts'`
- For each one, write down what the *actual* type should be
- Focus on the orchestrator payload — what is the correct type for `nodes`?

**🎯 Interview concept:** "How do you maintain type safety across service boundaries?" Explain: shared type definitions, runtime Zod validation at boundaries, generic task triggers, no `any` at public interfaces.

### Afternoon (4 hrs) — Testing Architecture
**Concepts:**
- **Testing pyramid** — many unit tests, fewer integration tests, minimal e2e tests
- **Testing Trigger.dev tasks** — mock the SDK, test business logic in isolation
- **Testing tRPC procedures** — use `createCaller` with a mock context
- **Testing MCP tools** — the tool handler is just a function, call it directly

**Codebase re-examination:**
- Identify the 5 most critical code paths with zero tests
- For each one, write down (on paper) what you would test and what you would mock
- The orchestrator topo sort is pure logic — no mocks needed, only input/output assertions

**🎯 Proof of understanding:** Explain out loud: "How would I test the orchestrator's topological sort without running Trigger.dev?" Answer: extract the topo sort into a pure function, pass in nodes/edges, assert layers are correct.

### Evening (3 hrs) — Zod Patterns Deep Dive
- **Parse, don't validate** — read Alexis King's article in full
- Understand why `z.any()` defeats the purpose of Zod
- Study `.transform()`, `.refine()`, `.pipe()` for complex validation
- Study how your node registry generates Zod schemas — this is actually well-designed

---

## Day 4: Production Operations + Credit System

### Morning (4 hrs) — Production Error Handling
**Concepts:**
- **Error boundary pattern** — catch unexpected errors at the top, return generic message + requestId
- **Structured logging** — every log should have: timestamp, requestId, userId, operation, duration
- **Observability** — traces, metrics, logs (the three pillars). Understand how your Trigger.dev logger.trace maps to distributed tracing
- **Graceful degradation** — what happens when fal.ai is down? When Neon is slow? When Transloadit times out?

**Codebase re-examination:**
- Trace an execution from tRPC → orchestrator → task → webhook — map every error path
- For each error, ask: "Does the user see a helpful message or a stack trace?"
- For each external dependency (fal.ai, Neon, Transloadit, Trigger.dev), ask: "What happens if this is down?"

**🎯 Interview concept:** "How do you handle partial failures in a multi-node workflow?" You can explain your PARTIAL status pattern — this is a genuine strength.

### Afternoon (4 hrs) — Financial Transaction Patterns
**Concepts:**
- **Reserve → Execute → Settle** pattern — understand authorization vs capture
- **Double-entry bookkeeping** — every credit change should have a balancing entry
- **Optimistic vs pessimistic concurrency** — your SELECT FOR UPDATE is pessimistic (good). Understand when to use each.
- **Eventual consistency** — what happens if credit deduction fails but the node succeeded?

**Codebase re-examination:**
- Trace the credit flow: estimateWorkflowCost → getBalance check → execute → deductCredits
- Identify the window between check and deduction — this is your race condition
- Think about: what if the orchestrator crashes after node completion but before deductCredits?

**🎯 Proof of understanding:** Draw the timeline of a concurrent double-execution attack on your current system. Show where credits are checked, where they're deducted, and where the race window exists.

### Evening (3 hrs) — API Versioning Strategy
- Study how Stripe versions their API (date-based versioning, version headers)
- Study how GitHub API uses URL versioning (/v3/, /v4/)
- Understand: what breaks when you add/remove/rename a field with no versioning
- Think about: what's your migration strategy from v1 to v2?

---

## Day 5: Integration & Mock Interview Prep

### Morning (4 hrs) — End-to-End Understanding
**Concepts:**
- **System design interview format** — requirements → high-level design → deep dive → trade-offs
- Practice explaining your system: "NextFlow is a visual workflow builder for AI media pipelines. It uses a DAG orchestrator that topologically sorts nodes into parallel execution layers, dispatches them to Trigger.dev for async processing, and streams real-time status updates via metadata."

**Exercises:**
- Draw the full system architecture from memory (React → tRPC → Prisma → Trigger.dev → fal.ai → webhook → Trigger.dev → Prisma → React)
- For each component, explain: what it does, why you chose it, what you'd change
- Prepare answers for: "What would you change if you rebuilt this?" (Service layer, typed payloads, idempotency, MCP resources)

### Afternoon (4 hrs) — Mock Interview Questions
Practice answering these out loud (time yourself, 5 min each):

1. "Walk me through a workflow execution end-to-end"
2. "How do you handle concurrent workflow executions for the same user?"
3. "What happens if fal.ai is down for 30 minutes during an execution?"
4. "How would you add a new AI provider (e.g., Replicate) to the system?"
5. "How does your MCP server handle a user who doesn't know their workflow ID?"
6. "What's your test strategy for the orchestrator?"
7. "How do you prevent double-charging on retried execution requests?"
8. "How would you add GraphQL as a third API surface alongside tRPC and MCP?"
9. "What's the difference between MCP tools, resources, and prompts?"
10. "Show me your type safety story from client to task execution"

**🎯 For each question, note where your answer exposes a gap — that's what to reinforce.**

### Evening (3 hrs) — Final Synthesis
- Re-read this audit with fresh eyes
- For every CRITICAL finding, verify you can explain: what the problem is, why it matters, what the correct pattern is, and how you would approach solving it (conceptually, not code)
- Prepare your "honest self-assessment" narrative: "I built a working system with strong orchestration design, but I have gaps in API security patterns, MCP UX thinking, and service architecture. Here's what I've learned and how I'd improve it."

---

## Summary: What Will Come Up in an AI-First Company Interview

| Topic | Likelihood | Your Current Level | Target |
|-------|-----------|-------------------|--------|
| MCP design philosophy | 100% | Surface-level | Deep |
| API idempotency | 90% | Absent | Implementable |
| Service architecture | 90% | Not present | Can whiteboard |
| Type safety across boundaries | 80% | Weak (any pollution) | Can articulate |
| Test strategy | 80% | Near zero | Can describe pyramid |
| Secret management | 70% | Dangerously wrong | Can explain 12-Factor |
| Error handling philosophy | 70% | Inconsistent | Can explain layers |
| Credit/financial patterns | 60% | Has race condition | Can explain reserve pattern |
| DAG execution | 50% | **Strong** | Maintain |
| Webhook security | 30% | **Strong** | Maintain |
