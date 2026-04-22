# Day 2 Execution Plan — HTTP MCP Pivot

> **Sprint**: Day 2 of 5.
> **Key decision**: Pivot from stdio MCP to **HTTP MCP** via Next.js API route.
> **Why**: stdio requires exposing `DATABASE_URL`, `UNKEY_ROOT_KEY`, and `TRIGGER_SECRET_KEY` to the end user. HTTP keeps all secrets server-side — the user only needs their API key.

---

## Architecture (After)

```
Claude Desktop / Cursor / Any MCP Client
    │
    POST https://nextflow.app/api/mcp
    Header: Authorization: Bearer nf_xxxx
    │
    ▼
┌──────────────────────────────────────────┐
│          Next.js App (Vercel)            │
│                                          │
│  app/api/mcp/route.ts     ← MCP HTTP    │
│  app/api/v1/...           ← REST API    │
│  server/trpc/...          ← tRPC (UI)   │
│           │                              │
│           ▼                              │
│  lib/services/            ← SHARED      │
│  lib/db.ts                ← ONE client  │
│  lib/credits/             ← ONE ledger  │
└──────────────────────────────────────────┘
```

Three transports, one service layer, one deployment, one DB client.

---

## What Gets Deleted

| Item | Why |
|---|---|
| `lib/mcp/server.ts` | Replaced by `app/api/mcp/route.ts` |
| `lib/mcp/utils/db.ts` | Was a duplicate Prisma client. Now uses `lib/db.ts` |
| `lib/mcp/utils/errors.ts` | Replaced by `lib/services/errors.ts` |
| `lib/mcp/tools/*.ts` (all 6) | Logic moves to service layer; tool registration moves to API route |
| `dist/mcp/` build output | No separate compilation needed |
| `MCP_DEFAULT_USER_ID` env var | Replaced by API key auth |
| `.mcp.json` stdio config | Replaced by HTTP URL config |

---

## Build 1: Service Layer + HTTP MCP Route

### 1a. Install `@vercel/mcp-adapter`

```bash
npm install @vercel/mcp-adapter
```

### 1b. Create `lib/services/errors.ts`

Typed domain errors with recovery hints:

```ts
export class WorkflowNotFoundError extends Error {
  constructor(identifier: string) {
    super(`No workflow found matching "${identifier}". Use list_workflows to see available workflows.`);
  }
}

export class InsufficientCreditsError extends Error {
  constructor(needed: number, have: number) {
    super(`Insufficient credits. Need ${needed.toLocaleString()}, have ${have.toLocaleString()}. Add credits in the NextFlow dashboard.`);
  }
}

export class NodeNotFoundError extends Error {
  constructor(label: string, workflowName: string) {
    super(`No node labeled "${label}" in workflow "${workflowName}". Use list_workflows to see node labels.`);
  }
}
```

### 1c. Create `lib/services/workflow-service.ts`

Extracts shared logic from tRPC + MCP. Key functions:

- `createWorkflow(userId, name, description?)` — creates workflow + ensures User row exists
- `listWorkflows(userId, limit?, offset?)` — returns workflows with exposedInputs
- `getWorkflowByName(userId, name)` — NEW, enables name-based resolution
- `executeWorkflow(userId, workflowId, opts?)` — with credit check + input validation + Trigger.dev fire
- `getExecutionStatus(userId, runId)` — with ownership check

> [!IMPORTANT]
> `executeWorkflow()` MUST include credit pre-check and node input validation. The current MCP execute tool has neither — this is the critical gap being fixed.

### 1d. Create `lib/services/node-service.ts` and `lib/services/edge-service.ts`

- `addNode()`, `updateNode()`, `deleteNode()` — with `SELECT FOR UPDATE` transaction
- `addEdge()`, `deleteEdge()` — with `SELECT FOR UPDATE` transaction

### 1e. Create `app/api/mcp/route.ts`

The HTTP MCP endpoint using `@vercel/mcp-adapter`:

```ts
import { createMcpHandler, experimental_withMcpAuth } from "@vercel/mcp-adapter";
import { Unkey } from "@unkey/api";
import { z } from "zod";
import * as workflowService from "@/lib/services/workflow-service";
import * as nodeService from "@/lib/services/node-service";
import * as edgeService from "@/lib/services/edge-service";

const unkey = new Unkey({ rootKey: process.env.UNKEY_ROOT_KEY! });

const handler = createMcpHandler(
  async (server) => {
    // Register all tools here — they call the service layer
    server.tool(
      "list_workflows",
      "Show your saved workflows with names, descriptions, and available inputs.",
      { limit: z.number().optional(), offset: z.number().optional() },
      async ({ limit, offset }, extra) => {
        const userId = extra.authInfo?.token; // userId from Unkey
        const result = await workflowService.listWorkflows(userId, limit, offset);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
    );
    // ... other tools
  },
  {},
  { basePath: "/api/mcp" }
);

// Wrap with Unkey API key auth
const authenticatedHandler = experimental_withMcpAuth(
  handler,
  async (req, bearerToken) => {
    if (!bearerToken) throw new Error("API key required. Get one from the NextFlow dashboard.");
    
    const response = await unkey.keys.verifyKey({ key: bearerToken });
    if (!response.data.valid || !response.data.identity?.externalId) {
      throw new Error("Invalid API key. Generate a new one from the NextFlow dashboard.");
    }
    
    return {
      token: response.data.identity.externalId, // This IS the Clerk userId
      clientId: response.data.identity.externalId,
    };
  },
  { required: true }
);

export { authenticatedHandler as GET, authenticatedHandler as POST, authenticatedHandler as DELETE };
```

### 1f. Wire tRPC to service layer

Refactor `workflow.list`, `workflow.execute`, etc. to call the service layer instead of inline Prisma queries.

### Done when

- [ ] `npm install @vercel/mcp-adapter` successful
- [ ] `lib/services/errors.ts` — typed errors with recovery hints
- [ ] `lib/services/workflow-service.ts` — 5 functions with credit check + validation
- [ ] `lib/services/node-service.ts` — 3 functions with FOR UPDATE
- [ ] `lib/services/edge-service.ts` — 2 functions with FOR UPDATE
- [ ] `app/api/mcp/route.ts` — HTTP MCP endpoint with Unkey auth
- [ ] `POST /api/mcp` returns valid MCP responses
- [ ] Auth rejects invalid/missing API keys with clear error
- [ ] Credit check fires on execute (was missing in stdio version)
- [ ] `lib/mcp/` directory deleted (all 6 tool files + server + utils)

---

## Build 2: MCP Tool UX Rewrites

Now that tools are registered inline in the API route, rewrite them:

### 2a. Rewrite descriptions (zero internal system names)

| Tool | New description |
|---|---|
| `create_workflow` | "Create a new workflow with a name and optional description. Returns the workflow name for use in other tools." |
| `list_workflows` | "Show your saved workflows with their names, descriptions, and available input parameters." |
| `execute_workflow` | "Run a workflow by name. Optionally override inputs (use list_workflows to see available inputs). Returns an execution ID." |
| `get_execution_status` | "Check whether a workflow run has finished and get its results. Use 'latest' to check the most recent run." |
| `add_node` | "Add a new node to a workflow. Use list_node_types resource to see available node types." |
| `update_node` | "Update a node's configuration by its label." |
| `delete_node` | "Remove a node from a workflow by its label." |
| `add_edge` | "Connect two nodes by their labels. Specify which output connects to which input." |
| `delete_edge` | "Remove a connection between two nodes." |

### 2b. Accept names instead of UUIDs

| Tool | Old param | New param |
|---|---|---|
| `execute_workflow` | `workflowId` | `workflowName` (+ optional `workflowId` fallback) |
| `add_node` | `workflowId` | `workflowName` |
| `update_node` | `nodeId` | `nodeLabel` |
| `delete_node` | `nodeId` | `nodeLabel` |
| `get_execution_status` | `executionId` | Also accept `"latest"` |
| `create_workflow` | `userId` param | **Removed** — userId comes from API key |

### 2c. No more polymorphic tools

`manage_node` (add/update/delete with `action` enum) → 3 separate tools
`manage_edge` (add/update/delete with `action` enum) → 2 separate tools

### Done when

- [ ] Zero tool descriptions mention Clerk, Trigger.dev, Run, Prisma, or any internal system
- [ ] `execute_workflow` accepts `workflowName`
- [ ] `create_workflow` has no `userId` parameter
- [ ] 9 atomic tools registered (was 6 polymorphic)
- [ ] Every error includes a recovery hint ("try X next")

---

## Build 3: MCP Resources Layer

### Resource 1: `nextflow://node-types` (static catalog)

Source: `nodeRegistry.getAll()`. Shows available node types, their inputs, outputs, and costs.

### Resource 2: `nextflow://my-workflows` (dynamic, per-user)

Source: `workflowService.listWorkflows(userId)` + `getExposedInputs()`. Shows the user's workflows with overridable inputs.

### Done when

- [ ] `list_resources` returns both resources
- [ ] `read_resource("nextflow://node-types")` returns node catalog
- [ ] `read_resource("nextflow://my-workflows")` returns user's workflows

---

## User-Facing MCP Config (End State)

```json
{
  "mcpServers": {
    "nextflow": {
      "url": "https://nextflow.app/api/mcp",
      "headers": {
        "Authorization": "Bearer nf_your_api_key_here"
      }
    }
  }
}
```

One URL. One secret. No local install. No exposed admin credentials.

---

## What's Deferred (Days 3-5)

| Item | Day | Rationale |
|------|-----|-----------|
| Idempotency keys | 3 | Needs DB schema change |
| `any` type elimination | 3 | Pure refactor |
| Test coverage | 4 | Test working code |
| Credit reservation pattern | 4 | After UX is solid |
| Rate limiting (beyond Unkey's built-in) | 5 | Security hardening |
