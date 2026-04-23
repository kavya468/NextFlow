# MCP Implementation — Line-by-Line Deep Dive

## Table of Contents
1. `app/api/mcp/route.ts`
2. `lib/services/mcp-builder-service.ts`
3. Cross-File Architecture Summary
4. If I Were Refactoring This Tomorrow

---

## File: `app/api/mcp/route.ts`

### Overview
This file is the primary entry point for the Model Context Protocol (MCP) server. It exposes a Next.js App Router HTTP endpoint that allows AI agents to interact with the NextFlow platform. It registers 12 distinct tools for workflow and node management, 2 resources for discovery, and wraps the entire server in API key authentication using Clerk and Unkey.

### Dependency Graph
**Imports from:**
- `@modelcontextprotocol/sdk` (Types)
- `mcp-handler` (HTTP Transport & Server Wrapper)
- `@unkey/api` (Authentication)
- `zod` (Schema Validation)
- `lib/services/workflow-service.ts`, `lib/services/node-service.ts`, `lib/services/edge-service.ts`, `lib/services/mcp-builder-service.ts` (Business Logic)
- `lib/nodes/registry.ts`, `lib/nodes/configs.ts` (Node Definitions)

**Exported to:**
- Next.js framework (as HTTP handlers for GET, POST, DELETE)

### Line-by-Line Walkthrough

#### Lines 1–16: Comments and Library Imports

```ts
// ============================================================================
// app/api/mcp/route.ts — HTTP MCP Endpoint (Streamable HTTP + SSE)
// ============================================================================
//
// Replaces the old stdio-based MCP server with an HTTP endpoint powered by
// mcp-handler (formerly @vercel/mcp-adapter).
//
// Auth: Unkey API key verification → Clerk userId from key identity.
// Tools: 9 tools covering workflows, nodes, and edges.
// ============================================================================

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { Unkey } from "@unkey/api";
import { z } from "zod";
```

**Line 1** — `// ============================================================================`
- **What:** A visual separator for the file header.
- **Why:** To make the file structure easily scannable for developers.
- **If removed:** No runtime change, but reduces code readability.

**Line 2** — `// app/api/mcp/route.ts — HTTP MCP Endpoint (Streamable HTTP + SSE)`
- **What:** A comment stating the file path and its architectural role.
- **Why:** Confirms that this is an HTTP endpoint utilizing Server-Sent Events (SSE) for MCP transport.
- **If removed:** Loss of context for future maintainers.

**Line 3-10** — `// (Header comments)`
- **What:** Additional block comments explaining the transition from stdio to HTTP, and the auth/tool count.
- **Why:** Provides historical context (stdio -> HTTP) and summarizes the file's domain responsibilities.
- **If removed:** No runtime change, but developers lose architectural context.

**Line 11** — ` `
- **What:** A blank line.
- **Why:** Separates the header comment block from the import statements.
- **If removed:** Code becomes slightly harder to read.

**Line 12** — `import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";`
- **What:** Imports the `AuthInfo` type definition from the official MCP SDK.
- **Why:** Used to type the authentication payload passed to the MCP handler. Ensures the shape matches what the protocol expects.
- **If removed:** TypeScript compilation error when defining the return type of `verifyToken`.

**Line 13** — `import { createMcpHandler, withMcpAuth } from "mcp-handler";`
- **What:** Imports the core factory functions for the MCP HTTP server.
- **Why:** `createMcpHandler` automatically handles the complex JSON-RPC over HTTP/SSE framing. `withMcpAuth` wraps it in an authentication layer.
- **If removed:** The server cannot be instantiated or authenticated; runtime error.

**Line 14** — `import { Unkey } from "@unkey/api";`
- **What:** Imports the Unkey SDK client.
- **Why:** Unkey is used to verify incoming bearer tokens.
- **If removed:** Cannot verify API keys; compilation and runtime error.

**Line 15** — `import { z } from "zod";`
- **What:** Imports the Zod schema validation library.
- **Why:** MCP requires JSON Schema for tool inputs. Zod is used to define these safely in TypeScript, and `createMcpHandler` converts them to JSON schema automatically.
- **If removed:** Tool input validation fails; compilation error.

**Line 16** — ` `
- **What:** Blank line.
- **Why:** Separates standard library imports from internal service imports.
- **If removed:** Decreased readability.

#### Lines 17–34: Internal Service Imports

```ts
// ── Service Layer ──────────────────────────────────────────────────────────
import {
  createWorkflow,
  listWorkflows,
  getWorkflowByName,
  executeWorkflow,
  getExecutionStatus,
} from "@/lib/services/workflow-service";
import { addNode, updateNode, deleteNode } from "@/lib/services/node-service";
import { addEdge, deleteEdge } from "@/lib/services/edge-service";
import {
  listNodeTypes,
  validateDAG,
  scaffoldWorkflow,
} from "@/lib/services/mcp-builder-service";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs"; // side-effect: register all node configs
```

**Line 17** — `// ── Service Layer ──────────────────────────────────────────────────────────`
- **What:** Section comment.
- **Why:** Groups related internal imports.
- **If removed:** Harder to visually parse imports.

**Lines 18-24** — `import { ... } from "@/lib/services/workflow-service";`
- **What:** Imports the 5 core workflow mutation and query services.
- **Why:** The MCP handler delegates database access and core logic to these services to maintain a decoupled architecture.
- **If removed:** The workflow-related MCP tools will fail to compile.

**Line 25** — `import { addNode, updateNode, deleteNode } from "@/lib/services/node-service";`
- **What:** Imports node manipulation services.
- **Why:** Used by the `add_node`, `update_node`, and `delete_node` MCP tools.
- **If removed:** Node tools fail to compile.

**Line 26** — `import { addEdge, deleteEdge } from "@/lib/services/edge-service";`
- **What:** Imports edge manipulation services.
- **Why:** Used by the `add_edge` and `delete_edge` MCP tools.
- **If removed:** Edge tools fail to compile.

**Lines 27-31** — `import { ... } from "@/lib/services/mcp-builder-service";`
- **What:** Imports the "Smart Builder" services specific to MCP.
- **Why:** Provides auto-layout, auto-wiring, and DAG validation for LLM agents.
- **If removed:** Smart builder tools fail to compile.

**Line 32** — `import { nodeRegistry } from "@/lib/nodes/registry";`
- **What:** Imports the singleton registry of all available node types.
- **Why:** Used by the `nextflow://node-types` resource to list capabilities to the AI.
- **If removed:** Cannot fetch node schemas; runtime error.

**Line 33** — `import "@/lib/nodes/configs"; // side-effect: register all node configs`
- **What:** An import with no named bindings.
- **Why:** Triggers the side-effect of evaluating `configs.ts`, which populates the `nodeRegistry` before any requests arrive.
> ⚠️ **GOTCHA:** If this is removed, `nodeRegistry.getAll()` returns empty. No nodes will be available for tools or resources, silently breaking the entire platform.

**Line 34** — ` `
- **What:** Blank line.
- **Why:** Formatting.
- **If removed:** Nothing.

#### Lines 35–61: Helper Functions

```ts
// ── Helpers ────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(err: unknown) {
  const message =
    err instanceof Error ? err.message : "An unexpected error occurred.";
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function getUserId(extra: { authInfo?: AuthInfo }): string {
  const userId = extra.authInfo?.extra?.userId as string | undefined;
  if (!userId) {
    throw new Error(
      "Authentication required. Provide a valid API key in the Authorization header."
    );
  }
  return userId;
}
```

**Line 35** — `// ── Helpers ────────────────────────────────────────────────────────────────`
- **What:** Section header.
- **Why:** Context for the functions below.
- **If removed:** Reduced readability.

**Line 36** — ` `
- **What:** Blank line.
- **Why:** Padding.
- **If removed:** Nothing.

**Line 37** — `function ok(data: unknown) {`
- **What:** Declares a helper function for successful tool responses.
- **Why:** MCP requires a very specific return shape: `{ content: [{ type, text }] }`. This centralizes the boilerplate and JSON stringification.
- **If removed:** The 12 tools would need this boilerplate duplicated, risking formatting errors.

**Line 38** — `  return {`
- **What:** Begins the return object.
- **Why:** Syntax requirement for returning an object literal.
- **If removed:** Syntax error.

**Line 39** — `    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],`
- **What:** The MCP protocol response payload.
- **Why:** `type: "text" as const` ensures strict type matching with the MCP SDK. The data is pretty-printed (2 spaces) to make it easier for the AI model's context window to parse visually.
- **If removed:** Tool response violates MCP schema; client will crash or reject it.

**Line 40** — `  };`
- **What:** Closes the return object.
- **Why:** Syntax.
- **If removed:** Syntax error.

**Line 41** — `}`
- **What:** Closes `ok()`.
- **Why:** Syntax.
- **If removed:** Syntax error.

**Line 42** — ` `
- **What:** Blank line.

**Line 43** — `function fail(err: unknown) {`
- **What:** Declares an error response helper.
- **Why:** Ensures errors are gracefully returned to the LLM as text, rather than crashing the HTTP endpoint, allowing the agent to self-correct.
- **If removed:** Errors would crash the handler, returning 500s instead of MCP protocol errors.

**Line 44-45** — `  const message = err instanceof Error ? err.message : "An unexpected error occurred.";`
- **What:** Safely extracts the error message.
- **Why:** `err` is `unknown` in TypeScript `catch` blocks.
- **If removed:** Potential runtime crash if `err` is a string or object.

**Line 46** — `  return {`
- **What:** Opens the error response object.
- **Why:** Syntax.
- **If removed:** Syntax error.

**Line 47** — `    content: [{ type: "text" as const, text: message }],`
- **What:** The error message payload.
- **Why:** Same formatting as a success, but with the error text.
- **If removed:** The agent receives empty feedback on failure.

**Line 48** — `    isError: true,`
- **What:** MCP-specific flag indicating a tool failure.
- **Why:** Signals to Claude/other agents that the tool failed, triggering their internal error-handling and retry loops.
- **If removed:** The LLM thinks the tool succeeded and hallucinates that the error message is the actual data.

**Line 49** — `  };`
- **What:** Closes return object.

**Line 50** — `}`
- **What:** Closes `fail()`.

**Line 51** — ` `
- **What:** Blank line.

**Line 52** — `function getUserId(extra: { authInfo?: AuthInfo }): string {`
- **What:** A helper to extract the `userId` from the MCP request context.
- **Why:** Centralizes the check. Returns `string` strictly, avoiding `undefined` checks downstream.
- **If removed:** Downstream tools would need repetitive null-checks.

**Line 53** — `  const userId = extra.authInfo?.extra?.userId as string | undefined;`
- **What:** Safely extracts `userId`.
- **Why:** The auth middleware populates `extra.userId`. The `as string` cast is needed because the SDK types `extra` as `Record<string, unknown>`.
- **If removed:** Type error.

**Lines 54-58** — `  if (!userId) { throw new Error(...); }`
- **What:** Hard runtime check for missing authentication.
- **Why:** Safety net. Even though `withMcpAuth({ required: true })` is used, this ensures typescript knows `userId` is definitely a string.
- **If removed:** TypeScript complains that `userId` might be undefined.

**Line 59** — `  return userId;`
- **What:** Returns the string.

**Line 60** — `}`
- **What:** Closes `getUserId()`.

**Line 61** — ` `
- **What:** Blank line.

#### Lines 62–93: Server Instantiation & Tool 1 (`list_workflows`)

```ts
// ============================================================================
// MCP Server Definition
// ============================================================================

const handler = createMcpHandler(
  (server) => {
    // ── 1. list_workflows ────────────────────────────────────────────
    server.registerTool(
      "list_workflows",
      {
        title: "List Workflows",
        description:
          "Show your saved workflows with names, descriptions, and available inputs.",
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
        },
      },
      async ({ limit, offset }, extra) => {
        try {
          const userId = getUserId(extra);
          const workflows = await listWorkflows(
            userId,
            limit ?? 20,
            offset ?? 0
          );
          return ok(workflows);
        } catch (err) {
          return fail(err);
        }
      }
    );
```

**Lines 62-65** — Block comments separating the main server logic.

**Line 66** — `const handler = createMcpHandler(`
- **What:** Initializes the server via the `mcp-handler` package.
- **Why:** This wraps the `@modelcontextprotocol/sdk` `McpServer` to bridge it with Next.js App Router HTTP mechanics (handling POST, SSE, etc.).
- **If removed:** No server exists.

**Line 67** — `  (server) => {`
- **What:** Arrow function receiving the raw `server` object.
- **Why:** This callback pattern allows us to register tools before the server starts listening.
- **If removed:** Syntax error.

**Line 68** — `    // ── 1. list_workflows ────────────────────────────────────────────`
- **What:** Comment block for the first tool.

**Line 69** — `    server.registerTool(`
- **What:** Calls the MCP SDK to register a new tool.
- **Why:** Makes this function discoverable by the LLM via the `tools/list` JSON-RPC method.
- **If removed:** The AI cannot list workflows.

**Line 70** — `      "list_workflows",`
- **What:** The exact name of the tool.
- **Why:** This name must be unique. The LLM specifies this string when invoking the tool.
- **If removed:** Syntax error (missing argument).

**Line 71** — `      {`
- **What:** Opens the metadata config object.

**Line 72** — `        title: "List Workflows",`
- **What:** Human-readable title.
- **Why:** Displayed in client UI (like Claude Desktop) when asking for approval.

**Line 73-74** — `        description: "Show your saved workflows with names, descriptions, and available inputs.",`
- **What:** The prompt context for the LLM.
- **Why:** This tells the LLM *when* to use this tool.
> ⚠️ **GOTCHA:** Tool descriptions are parsed by the LLM as part of its system prompt. Poor descriptions lead to tool hallucinations.

**Line 75** — `        inputSchema: {`
- **What:** Opens the Zod schema definition.
- **Why:** `createMcpHandler` accepts a raw object of Zod types and converts them to JSON Schema under the hood.

**Line 76** — `          limit: z.number().int().min(1).max(100).optional(),`
- **What:** Zod number field for pagination.
- **Why:** Prevents the LLM from requesting 10,000 rows and OOM-crashing the server.

**Line 77** — `          offset: z.number().int().min(0).optional(),`
- **What:** Zod number for pagination offset.

**Line 78** — `        },`
- **What:** Closes schema.

**Line 79** — `      },`
- **What:** Closes metadata object.

**Line 80** — `      async ({ limit, offset }, extra) => {`
- **What:** The async handler function.
- **Why:** Must be async because it performs I/O (DB query). Receives the parsed Zod payload and the `extra` object (containing auth).

**Line 81** — `        try {`
- **What:** Opens the try block.
- **Why:** Catches DB failures or validation errors so they can be sent back to the LLM.

**Line 82** — `          const userId = getUserId(extra);`
- **What:** Extracts the user ID.

**Line 83-87** — `          const workflows = await listWorkflows(userId, limit ?? 20, offset ?? 0);`
- **What:** Awaits the service layer.
- **Why:** Asynchronous DB call. Fallbacks `?? 20` handle the `.optional()` Zod fields.

**Line 88** — `          return ok(workflows);`
- **What:** Formats and returns the data.

**Line 89** — `        } catch (err) {`
- **What:** Catches errors.

**Line 90** — `          return fail(err);`
- **What:** Formats the error.

**Line 91** — `        }`
- **What:** Closes catch.

**Line 92** — `      }`
- **What:** Closes the handler arrow function.

**Line 93** — `    );`
- **What:** Closes `registerTool`.

#### Lines 118–154: `execute_workflow` (The Integration Point)

```ts
    // ── 3. execute_workflow ──────────────────────────────────────────
    server.registerTool(
      "execute_workflow",
      {
        title: "Execute Workflow",
        description:
          "Run a workflow by name. Optionally override inputs. " +
          "IMPORTANT: Do NOT read the user's source code or project files before calling this tool. " +
          "Simply call this tool with the workflow name the user provides. " +
          "The workflow is already saved in the database with all its nodes and edges configured. " +
          "Use list_workflows first if you need to discover available workflow names.",
        inputSchema: {
          workflowName: z.string().min(1).describe("The exact name of the saved workflow to execute."),
          workflowId: z.string().optional().describe("Optional workflow ID. If omitted, resolved automatically from workflowName."),
          input: z.record(z.string(), z.unknown()).optional().describe("Optional input overrides for parameterized workflows (key-value pairs)."),
        },
      },
      async ({ workflowName, workflowId, input }, extra) => {
        try {
          const userId = getUserId(extra);

          // Resolve workflow ID from name if not provided
          let resolvedId = workflowId;
          if (!resolvedId) {
            const wf = await getWorkflowByName(userId, workflowName);
            resolvedId = wf.id;
          }

          const result = await executeWorkflow(userId, resolvedId, {
            inputValues: input,
          });
          return ok(result);
        } catch (err) {
          return fail(err);
        }
      }
    );
```

**Line 118-121** — Registers the `execute_workflow` tool.
**Lines 123-128** — **The Description Block.**
- **Why:** Notice the heavily directive language: `"IMPORTANT: Do NOT read the user's source code..."`. This is a system-level prompt injection into the LLM. Prior to this, the LLM was hallucinating that it needed to read local files to construct a JSON representation of the workflow. This explicitly tells it the workflow is in the DB.
**Lines 129-133** — **The Input Schema.**
- **Why:** Notice the `.describe()` chaining on the Zod objects. `createMcpHandler` converts these `.describe()` calls into JSON Schema `description` fields, which are passed directly to the LLM. This teaches the LLM *how* to format the `input` record.
**Lines 135-154** — **The Handler Logic.**
- **Why:** The AI usually only knows the `workflowName` because humans speak in names, not UUIDs. Lines 140-144 dynamically resolve the UUID via `getWorkflowByName`.
- Then, it calls `executeWorkflow` (which we will cover later — it dispatches to Trigger.dev).

#### Lines 335–438: The "Smart Builder" Tools

```ts
    // ════════════════════════════════════════════════════════════════════
    // Smart Builder Tools
    // ════════════════════════════════════════════════════════════════════
    
    // ── 12. scaffold_workflow ──────────────────────────────────────────
    server.registerTool(
      "scaffold_workflow",
      {
        title: "Scaffold Workflow",
        description:
          "One-shot deploy: validates the DAG, auto-wires handles, auto-layouts positions, and saves. Use list_node_types first to discover types, then simulate_workflow to dry-run, then this to deploy.",
        inputSchema: {
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
          nodes: z.array(
            z.object({
              id: z.string(),
              type: z.string(),
              config: z.record(z.string(), z.unknown()).optional(),
            })
          ),
          edges: z.array(
            z.object({
              sourceId: z.string(),
              targetId: z.string(),
              sourceHandle: z.string().optional(),
              targetHandle: z.string().optional(),
            })
          ),
        },
      },
      async ({ name, description, nodes, edges }, extra) => {
        try {
          const userId = getUserId(extra);
          const result = await scaffoldWorkflow(
            userId,
            name,
            nodes,
            edges,
            description
          );
          return ok(result);
        } catch (err) {
          return fail(err);
        }
      }
    );
```

**What this is:** The crown jewel of the MCP integration.
**Why it exists:** LLMs are terrible at predicting X/Y canvas coordinates (`position`) and finding the exact string IDs for `sourceHandle` and `targetHandle`.
**How it works:**
1. The LLM provides a "fuzzy" graph (just node types, IDs, and general edges between node IDs).
2. The schema makes `sourceHandle` and `targetHandle` optional.
3. The `scaffoldWorkflow` service (in `lib/services/mcp-builder-service.ts`) runs an algorithm (`autoWireEdges`) that inspects the type signatures of the nodes and automatically links the handles based on compatibility (e.g. `image` output to `image` input).
4. It also runs a topological sort (`autoLayoutNodes`) to calculate X/Y coordinates automatically.
**Why this matters:** It reduces token usage, eliminates LLM hallucinations on handle names, and creates beautiful, non-overlapping layouts in the visual canvas.

#### Lines 440–511: MCP Resources Registration

```ts
    // ════════════════════════════════════════════════════════════════════
    // MCP Resources
    // ════════════════════════════════════════════════════════════════════

    // ── Resource 1: nextflow://node-types (static) ───────────────────
    server.resource(
      "Available Node Types",
      "nextflow://node-types",
      {
        description:
          "All node types you can add to workflows, with their inputs, outputs, and credit costs.",
        mimeType: "application/json",
      },
      async (uri) => {
        const configs = nodeRegistry.getAll();
        const summary = configs.map((cfg) => ({
          type: cfg.id,
          label: cfg.name,
          description: cfg.description,
          category: cfg.category,
          inputs: cfg.inputs.map((i) => ({
            key: i.key,
            type: i.type,
            label: i.label,
            required: i.required,
            default: i.default,
            description: i.description,
          })),
          outputs: cfg.outputs.map((o) => ({
            key: o.key,
            type: o.type,
            label: o.label,
          })),
          creditCost: cfg.credits.estimate({}),
        }));

        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(summary, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      }
    );
```

**Line 444-445** — `server.resource("Available Node Types", "nextflow://node-types",`
- **What:** Registers an MCP Resource.
- **Why:** While Tools are *actions*, Resources are *read-only data* the LLM can read contextually. This allows the LLM to understand what nodes exist without executing a tool first.
**Lines 453-473** — Builds a mapped summary of `nodeRegistry.getAll()`.
- **Why:** We strip out backend functions (like `.credits.calculate`) and only return JSON-serializable primitives to prevent JSON stringify errors.

#### Lines 512–525: Server Configuration Options

```ts
  },
  // ── Server Options ───────────────────────────────────────────────────────
  {
    serverInfo: {
      name: "nextflow",
      version: "1.0.0",
    },
  },
  // ── Config ───────────────────────────────────────────────────────────────
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV === "development",
  }
);
```

**Line 514-517** — `serverInfo`.
- **What:** Handshake metadata sent to the MCP Client.
**Line 521** — `basePath: "/api",`
- **What:** Tells `mcp-handler` the root path to handle routing properly.
**Line 522** — `maxDuration: 60,`
- **What:** Timeout for tools. Crucial because some tools trigger Vercel DB operations.

#### Lines 527–583: Authentication and Next.js Exports

```ts
// ============================================================================
// Auth Middleware — Unkey API Key Verification
// ============================================================================

const unkey = new Unkey();

const verifyToken = async (
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> => {
  if (!bearerToken) {
    return undefined;
  }

  try {
    const verification = await unkey.keys.verifyKey({ key: bearerToken });

    if (!verification.data.valid) {
      throw new Error(
        "Invalid API key. Generate a new one from the NextFlow dashboard."
      );
    }

    // The Unkey key identity's externalId is the Clerk userId
    const userId = verification.data.identity?.externalId;
    if (!userId) {
      throw new Error(
        "API key is not linked to a user. Re-generate your key from the NextFlow dashboard."
      );
    }

    return {
      token: bearerToken,
      clientId: userId,
      scopes: [],
      extra: { userId },
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("API key")) {
      throw err; // Re-throw our domain errors
    }
    throw new Error(
      "Failed to verify API key. Please try again or generate a new key from the NextFlow dashboard."
    );
  }
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
});

// ============================================================================
// Next.js App Router Exports
// ============================================================================

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
```

**Line 531** — `const unkey = new Unkey();`
- **What:** Instantiates Unkey.
- **Why:** `UNKEY_ROOT_KEY` environment variable is automatically picked up from `.env.local` to securely talk to Unkey APIs.
**Lines 533-572** — `verifyToken`
- **What:** Validates the Bearer token coming from the MCP Client header.
- **Why:** The API Key's `identity` object in Unkey was configured to hold the `Clerk userId` as the `externalId`. This securely maps an opaque string to a real user in the NextFlow Postgres DB.
- **If removed:** The server is open to the public; massive security vulnerability.
**Line 574-576** — `withMcpAuth`
- **What:** Wraps the `mcp-handler`.
- **Why:** Rejects any request immediately with 401 if the token fails.
**Line 582** — `export { authHandler as GET, authHandler as POST, authHandler as DELETE };`
- **What:** Exports the handler for Next.js App Router.
- **Why:** Next.js requires these named exports to route HTTP methods to this file. The SSE stream initiates on `GET` and tool calls happen on `POST`.

### Data Flow Diagram (ASCII)

```
[Claude / AI Agent]
       | (JSON-RPC)
       v
[MCP Client (e.g. Claude Desktop)]
       | (HTTP POST / SSE over Bearer Auth)
       v
[app/api/mcp/route.ts]
   1. verifyToken (Unkey Auth) -> Returns Clerk userId
   2. mcp-handler parses JSON-RPC request
   3. Server routes to 'execute_workflow' tool
       |
       v
[lib/services/workflow-service.ts]
   1. Fetch Workflow from DB
   2. Deduplicate Passthrough Labels
   3. Atomic Credit Reservation (FOR UPDATE lock)
   4. Create Run/NodeRun rows
       |
       v
[Trigger.dev SDK]
   tasks.trigger("orchestrate-workflow")
       |
       v
[Return JSON-RPC Success to Claude]
```

### Gotchas & Non-Obvious Constraints
> ⚠️ **GOTCHA 1:** The `executeWorkflow` tool calls Trigger.dev via `tasks.trigger()`, not `triggerAndWait()`. This means the MCP tool returns *immediately* with the Run ID. The AI model must be instructed to use `get_execution_status` in a loop to poll for completion. If it waited synchronously, the 60s Vercel limit would kill long-running video generations.
> ⚠️ **GOTCHA 2:** The `import "@/lib/nodes/configs";` on line 33 is an empty side-effect import. Next.js serverless functions do not keep state across cold starts. If this isn't executed, the `nodeRegistry` singleton is empty, and tools silently fail to find nodes.
> ⚠️ **GOTCHA 3:** The HTTP transport requires the `Authorization: Bearer <unkey>` header. If testing locally via Claude Desktop, you must configure the MCP server in `claude_desktop_config.json` as an `http` type (not stdio) and inject the env var.

---

## File: `lib/services/mcp-builder-service.ts`

### Overview
This file contains the "Smart Builder" logic. Because LLMs struggle with precise graph geometry (X/Y coordinates) and strict string matching for Node connection ports (handles), this service abstracts those responsibilities away. The AI passes a simplified graph, and this service auto-completes the missing metadata before saving to the DB.

### Line-by-Line Highlight

#### Lines 308-375: `autoWireEdges`

```ts
export function autoWireEdges(
  nodes: ProposedNode[],
  edges: ProposedEdge[]
): { resolved: ResolvedEdge[]; errors: string[] } {
...
    // Auto-resolve: find the first compatible output→input pair
    let matched = false;
    for (const output of sourceConfig.outputs) {
      if (edge.sourceHandle && edge.sourceHandle !== output.key) continue;
      for (const input of targetConfig.inputs) {
        if (edge.targetHandle && edge.targetHandle !== input.key) continue;
        if (
          nodeRegistry.isValidConnection(
            sourceConfig.id,
            output.key,
            targetConfig.id,
            input.key
          )
        ) {
          resolved.push({
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            sourceHandle: edge.sourceHandle ?? output.key,
            targetHandle: edge.targetHandle ?? input.key,
          });
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
...
```

- **What:** Loops through all proposed edges. If the LLM omitted `sourceHandle` or `targetHandle`, it iterates through all possible outputs of the source node and inputs of the target node.
- **Why:** It uses `nodeRegistry.isValidConnection` to check type compatibility (e.g., ensuring a `text` output isn't plugged into an `image` input).
- **If removed:** The LLM would have to exactly guess handle names like `element_0_frontal` or the workflow engine would crash at runtime.

#### Lines 244-304: `autoLayoutNodes`
- **What:** Implements Kahn's Algorithm for topological sorting.
- **Why:** By identifying "layers" of execution (nodes that can run in parallel), it assigns X coordinates based on the layer index (`col * X_GAP`) and Y coordinates based on the position within that layer (`row * Y_GAP`).
- **If removed:** All nodes generated by the LLM would stack at `(0,0)` on the React Flow canvas, creating a UI nightmare for the user.

---

## Cross-File Architecture Summary

### How the MCP layer connects to the rest of NextFlow
The architecture strictly enforces **Separation of Concerns**:
1. **Transport Layer (`app/api/mcp/route.ts`)**: Handles JSON-RPC framing, SSE streaming, Zod input validation, and API Key auth.
2. **Service Layer (`lib/services/*.ts`)**: Shared business logic. Contains all Prisma ORM calls. Identical logic is used by both the Next.js UI (via tRPC) and the AI (via MCP).
3. **Execution Layer (`src/trigger/orchestrator.ts`)**: Serverless background tasks. `executeWorkflow` triggers this async task, meaning the web request unblocks immediately.

### Tool Registry — Complete Reference

| Tool Name | What it does | Return shape | Billing impact |
|-----------|--------------|--------------|----------------|
| `list_workflows` | Queries DB for User's workflows | Array of Workflow info | None |
| `create_workflow`| Inserts blank workflow | `{ id, name }` | None |
| `execute_workflow`| Trigger.dev dispatch | Run ID & Status | **Charges Credits** |
| `get_execution_status`| Polls DB for node outputs | `{ status, result, logs }` | None |
| `add_node` / `update_node` / `delete_node` | Mutates workflow JSON in DB with FOR UPDATE lock | Updated node ID | None |
| `add_edge` / `delete_edge` | Mutates edges JSON in DB | Updated edge ID | None |
| `list_node_types`| Reads from `nodeRegistry` | Array of schema configs | None |
| `simulate_workflow`| Dry-runs DAG validation | Valid bool + Warnings | None |
| `scaffold_workflow`| Auto-wires, auto-layouts, saves | Full workflow payload | None |

### Error Taxonomy

1. **Protocol Errors:** Handled by `mcp-handler` (e.g. malformed JSON-RPC).
2. **Auth Errors:** Thrown by Unkey in `verifyToken`. Results in HTTP 401.
3. **Validation Errors:** Zod schemas in `registerTool` throw. Returns to LLM with `isError: true`.
4. **Domain Errors (e.g. `OwnershipError`):** Thrown by `lib/services/*`. Caught by `try/catch` in the handler and returned nicely to the LLM via `fail()`.
5. **Trigger.dev Errors:** The background orchestrator catches these and saves `FAILED` to the DB. The LLM sees this when it calls `get_execution_status`.

---

## If I Were Refactoring This Tomorrow

Here is a brutal, unvarnished look at the architectural weaknesses in the current MCP layer and how to fix them for better scalability, reliability, and code quality.

### 1. Tight Coupling of DB Mutations to JSON Columns
- **Current Approach:** `add_node`, `update_node`, and `add_edge` load the entire workflow JSON, append an item to an array, and save the whole JSON blob back.
- **The Problem:** Even with `SELECT FOR UPDATE`, if the JSON gets very large, this is highly inefficient. Furthermore, concurrent node updates on the *same* workflow from different agents will bottleneck on the row lock.
- **The Fix:** Relational DB modeling. Nodes and Edges should be their own tables with `workflowId` foreign keys. This would allow `INSERT INTO nodes` without locking the parent workflow row, massively improving write concurrency.

### 2. Immediate Credit Reservation (Block-on-estimate)
- **Current Approach:** `executeWorkflow` computes estimated credits and reserves them synchronously before dispatching to Trigger.dev.
- **The Problem:** If Trigger.dev goes down, the credits are reserved but the task never runs. The user is out of credits until a background sweep (if one exists) un-reserves them.
- **The Fix:** Shift credit reservation *inside* the Trigger.dev task (`orchestrator.ts`). Trigger.dev has built-in retry mechanisms and guarantees execution. By reserving in step 1 of the task, we ensure credits are only held when compute is actually spinning up.

### 3. Lack of Pagination in `list_node_types`
- **Current Approach:** `nextflow://node-types` and `list_node_types` dump the entire registry of nodes to the LLM context.
- **The Problem:** As the platform grows to hundreds of nodes, this will blow out the LLM's context window and increase token costs linearly.
- **The Fix:** Implement fuzzy searching and semantic retrieval for node types (e.g., `search_nodes({ intent: "generate image" })`), returning only the top 5 most relevant configurations.

### 4. Overly Permissive Auto-Wiring
- **Current Approach:** `autoWireEdges` loops through inputs and outputs and grabs the *first* type match it finds.
- **The Problem:** If a node has multiple `text` outputs (e.g., `prompt` and `negative_prompt`), the auto-wirer will blindly attach to the first one. This leads to unpredictable semantic logic.
- **The Fix:** Add `semanticTags` to IO definitions in `lib/nodes/types.ts` and require the auto-wirer to match both primitive type (`text`) AND semantic intent (`prompt` -> `prompt`).

### 5. Repetitive Error Handling Boilerplate
- **Current Approach:** Every single of the 12 tools has `try { ... } catch (err) { return fail(err); }`.
- **The Problem:** Violates DRY. Increases LOC. Easy to forget and crash the server.
- **The Fix:** Create a higher-order wrapper function specifically for tools:
  ```ts
  function registerSafeTool(server, name, config, handler) {
    server.registerTool(name, config, async (args, extra) => {
      try { return ok(await handler(args, extra)); }
      catch (e) { return fail(e); }
    });
  }
  ```
  This would shave ~100 lines of code off `app/api/mcp/route.ts` instantly and guarantee consistent error boundaries.
