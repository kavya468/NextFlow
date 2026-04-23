# OpenAPI + Mintlify Implementation — Line-by-Line Deep Dive

## Table of Contents
1. [File: `app/api/v1/[...path]/route.ts` (Next.js REST Handler)](#file-appapiv1pathroutets)
2. [File: `server/trpc/trpc.ts` (tRPC Context & Unkey Auth)](#file-servertrpctrpcts)
3. [File: `server/trpc/routers/public-api.ts` (tRPC OpenAPI Router)](#file-servertrpcrouterspublic-apits)
4. [File: `app/api/v1/openapi.json/route.ts` (Spec Generator)](#file-appapiv1openapijsonroutets)
5. [File: `docs/mint.json` (Mintlify Configuration)](#file-docsmintjson)
6. [File: `docs/api-reference/workflows/execute.mdx` (Mintlify Endpoint Page)](#file-docsapi-referenceworkflowsexecutemdx)
7. [Cross-File Architecture Summary](#cross-file-architecture-summary)
8. [If I Were Refactoring This Tomorrow](#if-i-were-refactoring-this-tomorrow)

---

## File: `app/api/v1/[...path]/route.ts`

### Overview
This Next.js App Router API route is the gateway for all REST traffic intended for the public API. It bridges the gap between traditional REST semantics (GET/POST with URL paths) and tRPC by utilizing `createOpenApiFetchHandler` to parse incoming HTTP requests and map them to their corresponding tRPC procedures based on OpenAPI metadata.

### Dependency Graph
- **Imports from:**
  - `next/server` (Next.js native request handling)
  - `@/server/trpc/routers/public-api` (The tRPC router defining the endpoints)
  - `@/server/trpc/trpc` (Context builder to handle auth)
  - `trpc-to-openapi` (The adapter that converts HTTP to tRPC)
- **Imported by:** N/A (Invoked directly by Next.js routing infrastructure)

### Line-by-Line / Key-by-Key Walkthrough

#### Lines 1–4: Imports

```ts
import { NextRequest } from "next/server";
import { publicApiRouter } from "@/server/trpc/routers/public-api";
import { createOpenApiContext } from "@/server/trpc/trpc";
import { createOpenApiFetchHandler } from "trpc-to-openapi";
```

**Line 1** — `import { NextRequest } from "next/server";`
- **What:** Imports the Next.js wrapper around the native Web Fetch API `Request` object.
- **Why:** Next.js App Router uses `NextRequest` for Route Handlers to provide extra helper methods (like `.nextUrl`).
- **If removed:** TypeScript compilation fails; the route handler signatures become invalid.

**Line 2** — `import { publicApiRouter } from "@/server/trpc/routers/public-api";`
- **What:** Imports the specific tRPC sub-router that exposes our public, OpenAPI-annotated procedures.
- **Why:** We strictly import `publicApiRouter` instead of the root `appRouter`. This prevents internal/private tRPC procedures (like dashboard operations) from being accidentally exposed to REST callers.
- **If removed:** The REST handler wouldn't know which procedures exist to route requests to.

**Line 3** — `import { createOpenApiContext } from "@/server/trpc/trpc";`
- **What:** Imports the context builder specific to REST/OpenAPI requests (handles Unkey API key auth instead of Clerk session auth).
- **Why:** REST callers authenticate with API keys, while Next.js frontend callers authenticate via cookies/sessions. This ensures the correct auth middleware runs.
- **If removed:** The REST handler cannot establish `ctx.apiUserId`, causing all protected endpoints to crash or reject the request.

**Line 4** — `import { createOpenApiFetchHandler } from "trpc-to-openapi";`
- **What:** Imports the adapter function that translates a Web Standard `Request` to a tRPC payload.
- **Why:** `trpc-to-openapi` maps REST paths like `GET /workflows/123` to tRPC payloads like `path: "getWorkflow", input: { id: "123" }`.
- **If removed:** We'd have to write our own manual REST-to-tRPC router/parser, which is error-prone.

#### Lines 6–8: GET Handler

```ts
export async function GET(req: NextRequest) {
  return handleRequest(req);
}
```

**Lines 6–8** — `export async function GET(req: NextRequest) { return handleRequest(req); }`
- **What:** Exports the Next.js `GET` handler, proxying the request to our internal `handleRequest` helper.
- **Why:** Required by Next.js App Router conventions to handle HTTP GET requests.
- **If removed:** `GET /api/v1/workflows` would return `405 Method Not Allowed`.

#### Lines 10–27: POST Handler with Workaround

```ts
export async function POST(req: NextRequest) {
  // Mintlify's API playground sends an empty body when all body fields
  // are optional. trpc-to-openapi then fails with "Unexpected end of
  // JSON input" when trying to parse it. Ensure a valid JSON body exists.
  const cloned = req.clone();
  const raw = await cloned.text();
  const hasBody = raw.trim().length > 0;

  const safeReq = hasBody
    ? req
    : new NextRequest(req.url, {
        method: req.method,
        headers: req.headers,
        body: "{}",
      });

  return handleRequest(safeReq);
}
```

**Lines 10–13** — `export async function POST...` + comments
- **What:** Defines the Next.js POST handler and documents a critical edge-case workaround.
- **Why:** Mintlify's playground sends literally nothing (no body, not even `{}`) if the user doesn't type into optional fields.

**Line 14** — `const cloned = req.clone();`
- **What:** Clones the incoming `NextRequest` stream.
- **Why:** A request body can only be read once. To check if it's empty, we must clone it so the actual handler (`createOpenApiFetchHandler`) can still read the original stream if needed.
- **If removed:** The `await req.text()` would consume the stream. Later, when `trpc-to-openapi` tries to parse the JSON body, it would fail with a stream locked/already read error.

**Lines 15–16** — `const raw = await cloned.text(); const hasBody = raw.trim().length > 0;`
- **What:** Reads the cloned stream as a raw string and checks if it contains anything other than whitespace.
- **Why:** To determine if Mintlify (or another client) sent an empty payload.
- **If removed:** We wouldn't know when to inject the fallback JSON object.

**Lines 18–24** — `const safeReq = hasBody ? req : new NextRequest(...)`
- **What:** Conditionally reconstructs the request. If empty, creates a synthetic request with `body: "{}"`.
- **Why:** `trpc-to-openapi` crashes if it attempts `JSON.parse("")`. Providing `"{}"` allows Zod to gracefully apply default values or validate that optional fields are safely omitted.
- **If removed:** Empty Mintlify playground POSTs fail with HTTP 500 "Unexpected end of JSON input".

**Line 26** — `return handleRequest(safeReq);`
- **What:** Passes the sanitized request to the core handler.

#### Lines 29–37: The Core Handler

```ts
async function handleRequest(req: NextRequest) {
  return createOpenApiFetchHandler({
    endpoint: "/api",
    router: publicApiRouter,
    createContext: () => createOpenApiContext({ req }),
    req,
  });
}
```

**Line 29** — `async function handleRequest(req: NextRequest) {`
- **What:** A helper to DRY up the `GET` and `POST` routing logic.

**Line 30** — `return createOpenApiFetchHandler({`
- **What:** Initializes the `trpc-to-openapi` fetch handler.

**Line 31** — `endpoint: "/api",`
- **What:** Sets the base prefix path that `trpc-to-openapi` strips off incoming URLs before matching against the `path` defined in OpenAPI metadata.
- **Why:** Since our routes are defined with paths like `/v1/workflows`, and the route is mounted at `/api/v1/[...path]`, the actual URL hitting Next.js is `/api/v1/workflows`. By stripping `/api`, the handler matches `/v1/workflows` against the procedure metadata.
- **If removed:** The handler will attempt to match `/api/v1/workflows` against the procedure metadata `/v1/workflows`, fail to find a match, and return 404.

**Line 32** — `router: publicApiRouter,`
- **What:** Injects the router definition.
- **Why:** Gives the handler the schema so it can validate inputs and route to the right resolver.

**Line 33** — `createContext: () => createOpenApiContext({ req }),`
- **What:** Defines the factory function to build the tRPC context (`ctx`) for this request.
- **Why:** This ensures every REST request evaluates the `Authorization` header and fetches the user identity via Unkey.
- **If removed:** `ctx` inside procedures would be empty, crashing auth-protected endpoints.

**Line 34** — `req,`
- **What:** Passes the request object into the handler engine.

### Data Flow Diagram (ASCII)
```
[Mintlify Playground] --(POST /api/v1/workflows/123/execute)--> Next.js POST()
  |
  +-- (Clones req) --> Checks body: Is it empty?
  |                    yes -> Synthetic NextRequest with "{}"
  |                    no  -> Original NextRequest
  v
handleRequest(safeReq)
  v
createOpenApiFetchHandler
  |
  +-- Strips "/api" -> match "/v1/workflows/123/execute"
  |
  +-- Calls createOpenApiContext(req)
  |      +-- Extracts Bearer Token -> Unkey validation -> apiUserId
  |
  +-- Maps to executeWorkflow tRPC procedure
```

### Gotchas & Non-Obvious Constraints
- > ⚠️ **GOTCHA:** The `endpoint: "/api"` must perfectly align with both the file system path (`app/api/v1`) and the OpenAPI metadata paths (`/v1/...`). Any mismatch results in mysterious 404s for perfectly valid requests.
- > ⚠️ **GOTCHA:** `req.clone()` doubles memory consumption for the request payload. For a small API this is fine, but if users upload large files via REST, this would crash the Vercel edge/serverless function.
- > ⚠️ **GOTCHA:** Missing `PUT` or `DELETE` exports. Currently, this file only exports `GET` and `POST`. If you add a tRPC endpoint with `method: "DELETE"`, you must export a `DELETE` function from this file or Next.js will block it.

---

## File: `server/trpc/trpc.ts`

### Overview
This file defines the tRPC initialization, middleware, and context factories. It creates two distinct execution paths: one for the internal web app (`createTRPCContext` via Clerk) and one for the public REST API (`createOpenApiContext` via Unkey).

### Dependency Graph
- **Imports from:**
  - `@trpc/server`, `superjson` (tRPC core tools)
  - `@unkey/api` (API key validation)
  - `trpc-to-openapi` (OpenAPI metadata types)
- **Imported by:** Every single tRPC router (`root.ts`, `public-api.ts`, etc.) and the Next.js REST route handlers.

### Line-by-Line Walkthrough

#### Lines 34–54: OpenAPI Context & Auth

```ts
export const createOpenApiContext = async (opts: { req: NextRequest }) => {
  const authHeader = opts.req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing or invalid Authorization header" });
  }
  
  const token = authHeader.split(" ")[1];
  
  const response = await unkey.keys.verifyKey({ key: token });
  const verification = response.data;

  if (!verification.valid || !verification.identity?.externalId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid API key" });
  }
  
  return {
    apiUserId: verification.identity.externalId,
    prisma,
    req: opts.req,
  };
};
```

**Line 34** — `export const createOpenApiContext = async (opts: { req: NextRequest }) => {`
- **What:** Defines the context generator specific to the REST/OpenAPI pipeline.

**Lines 35–38** — `const authHeader... throw new TRPCError(...)`
- **What:** Extracts the `Authorization` header and asserts it uses the `Bearer` scheme.
- **Why:** The OpenAPI spec generated specifies `bearerAuth`, meaning clients (like Mintlify) will prepend `Bearer ` to the key.
- **If removed:** The system might try to validate `null` or raw strings against Unkey, failing weirdly instead of returning a clean HTTP 401.

**Line 40** — `const token = authHeader.split(" ")[1];`
- **What:** Strips `"Bearer "` to isolate the actual API key string.

**Lines 42–43** — `const response = await unkey.keys.verifyKey({ key: token }); const verification = response.data;`
- **What:** Sends the key to Unkey's edge network for validation.
- **Why:** Unkey handles rate limits, key expiry, revocation, and attribution entirely on its side.
- **If removed:** We would need to query our own database to validate hashes, introducing latency.

**Lines 45–47** — `if (!verification.valid || !verification.identity?.externalId) { throw new TRPCError(...) }`
- **What:** Asserts the key is valid AND has an associated `externalId` (which maps to our internal NextFlow `userId`).
- **Why:** If the key is revoked, expired, or hits a rate limit, Unkey returns `valid: false`. Without an `externalId`, we don't know who owns the key, so we can't deduct credits or scope their workflows.
- **If removed:** A rate-limited key would bypass security and crash downstream when trying to read `apiUserId`. API consumers receive a 401 Unauthorized status with `{ message: "Invalid API key" }`.

**Lines 49–53** — `return { apiUserId: verification.identity.externalId, prisma, req: opts.req };`
- **What:** Returns the contextual payload injected into every tRPC procedure's `ctx` argument.
- **Why:** Procedures need `apiUserId` to authorize resource access (e.g., `WHERE userId = ctx.apiUserId`).

#### Lines 56–66: OpenAPI tRPC Instance

```ts
const tApi = initTRPC.meta<OpenApiMeta>().context<typeof createOpenApiContext>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof Error ? error.cause.message : null,
      },
    };
  },
});
```

**Line 56** — `const tApi = initTRPC.meta<OpenApiMeta>().context<typeof createOpenApiContext>().create({`
- **What:** Creates a specialized tRPC instance explicitly typed with `OpenApiMeta` and our Unkey-backed context.
- **Why:** To enable the `.meta({ openapi: { ... } })` chaining on procedures. Standard tRPC lacks OpenAPI metadata typings.
- **If removed:** You could not build OpenAPI procedures.

**Lines 57–65** — `errorFormatter(...)`
- **What:** Serializes tRPC errors (like Zod validation failures) into clean JSON shapes.
- **Why:** When `trpc-to-openapi` throws HTTP 400 for bad inputs, this ensures the API consumer receives a readable string detailing the specific Zod failure instead of a generic "Bad Request".

#### Lines 68–76: Public Middleware

```ts
export const createPublicApiRouter = tApi.router;
export const publicApiProcedure = tApi.procedure.use(({ ctx, next }) => {
  if (!ctx.apiUserId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { ...ctx, apiUserId: ctx.apiUserId },
  });
});
```

**Line 69–76** — `export const publicApiProcedure = ...`
- **What:** A middleware asserting that `apiUserId` exists before allowing the procedure to execute.
- **Why:** Although `createOpenApiContext` already throws if the key is invalid, this middleware narrows the TypeScript type of `ctx.apiUserId` from `string | undefined` to `string`.
- **If removed:** Developers writing procedures would have to constantly assert `if (!ctx.apiUserId) throw...` to satisfy TypeScript.

### Data Flow Diagram (ASCII)
```
Request Header: "Authorization: Bearer nf_12345"
  |
  +-> createOpenApiContext()
        |
        +-> Unkey Edge Network verifyKey("nf_12345")
              |
              +-> Unkey Response: { valid: true, identity: { externalId: "usr_abc" } }
        |
        +-> Returns { apiUserId: "usr_abc" }
  |
  +-> publicApiProcedure middleware
        |
        +-> Validates apiUserId exists (Type safety)
        |
        +-> Procedure Executes
```

### Gotchas & Non-Obvious Constraints
- > ⚠️ **GOTCHA:** Unkey validates keys, but it does **not** inherently deduct NextFlow credits. If an endpoint requires credits, the tRPC procedure must handle that transaction separately against `CreditLedger`. Unkey's "remaining" limits could be used for general rate limiting, but NextFlow credit business logic happens downstream.
- > ⚠️ **GOTCHA:** The `env.UNKEY_ROOT_KEY` must be configured in Vercel. If missing, `unkey.keys.verifyKey` throws or fails silently depending on the SDK configuration, immediately breaking the public API.

---

## File: `server/trpc/routers/public-api.ts`

### Overview
This file defines the actual public API endpoints using tRPC. Because of `trpc-to-openapi`, each procedure defined here acts simultaneously as a strongly-typed internal RPC method and a publicly exposed, OpenAPI-documented REST endpoint. It handles listing workflows, fetching status, checking credits, and triggering complex execution logic.

### Dependency Graph
- **Imports from:** `zod`, `createPublicApiRouter`, `publicApiProcedure`, `appRouter` (for bridging logic), and `getExposedInputs`.
- **Imported by:** The `/api/v1/[...path]/route.ts` REST handler and the `openapi.json` spec generator.

### Line-by-Line / Key-by-Key Walkthrough (Focusing on `executeWorkflow`)

#### Lines 41–52: Metadata Configuration

```ts
  executeWorkflow: publicApiProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/v1/workflows/{id}/execute",
        protect: true,
        tags: ["Executions"],
        summary: "Execute full workflow",
        description: "Trigger a full execution of a workflow..."
      },
    })
```

**Lines 42–52** — `.meta({ openapi: { ... } })`
- **What:** The magical incantation that instructs `trpc-to-openapi` to expose this procedure as a REST endpoint.
- **`method: "POST"`:** Defines the HTTP verb. It's a POST because execution causes side effects (spawning tasks, deducting credits).
- **`path: "/v1/workflows/{id}/execute"`:** Maps the URL. The `{id}` path parameter is automatically extracted by `trpc-to-openapi` and passed to the Zod input schema.
- **`protect: true`:** Instructs the OpenAPI spec generator to mark this endpoint as requiring `securitySchemes.bearerAuth`. This ensures Mintlify renders the "Authorization" header field in the playground.
- **`tags`, `summary`, `description`:** Controls how Mintlify groups and labels this endpoint in the documentation sidebar and page header.

#### Lines 53–77: Input Schema (Request Body + Path Params)

```ts
    .input(
      z.object({
        id: z.string(),
        inputs: z.record(z.string(), z.record(z.string(), z.any())).optional().describe("..."),
        variables: z.record(z.string(), z.any()).optional().describe("..."),
        webhook: z.object({
          url: z.string().url().describe("The URL to receive POST notifications."),
          events: z.array(z.enum(["run.completed", "run.failed"])).optional()
        }).optional()
      })
    )
```

**Line 55** — `id: z.string(),`
- **What:** The workflow ID.
- **Why:** `trpc-to-openapi` is smart enough to see `{id}` in the path and `id` in the input schema, and maps this field to an OpenAPI Path Parameter. The API consumer puts it in the URL, not the JSON body.

**Lines 56–61** — `inputs: z.record(z.string(), z.record(z.string(), z.any())).optional()`
- **What:** Represents a complex JSON object: `Record<NodeId, Record<FieldKey, AnyValue>>`.
- **Why:** Allows developers to pass low-level overrides (e.g. `{"node_abc123": {"model": "gpt-4"}}`).
- **OpenAPI Translation:** Becomes an optional object in the `requestBody` schema. The `.describe()` method populates the description text in the Mintlify documentation for this field.

**Lines 62–67** — `variables: z.record(z.string(), z.any()).optional()`
- **What:** Represents `Record<NodeLabel, Record<FieldKey, AnyValue> | String>`.
- **Why:** Allows developers to target human-readable labels instead of internal UUIDs (e.g., `{"Product Brief": {"text": "hello"}}`).

**Lines 68–75** — `webhook: z.object(...)`
- **What:** An optional configuration for async delivery.
- **Why Zod Primitive:** `.url()` ensures the consumer provides a valid HTTP/S URI. If they pass `"not-a-url"`, `trpc-to-openapi` returns HTTP 400.
- **OpenAPI Translation:** Renders in Mintlify as an expandable nested object under `requestBody`.

#### Lines 78: Output Schema (Response Body)

```ts
    .output(z.object({ runId: z.string(), workflowId: z.string(), scope: z.string(), nodeCount: z.number(), estimatedCredits: z.number() }))
```

**Line 78** — `.output(...)`
- **What:** Enforces the shape of the data returned by the server.
- **Why:** This acts as a contract. `trpc-to-openapi` converts this into the OpenAPI `responses[200].content["application/json"].schema`. Mintlify reads this and renders the `ResponseExample` blocks in the docs.
- **If removed:** The endpoint would technically still work, but the OpenAPI spec wouldn't document the return shape, leaving developers guessing.

#### Lines 79–154: The Execution Mutation

```ts
    .mutation(async ({ ctx, input }) => {
      const caller = appRouter.createCaller({ auth: { userId: ctx.apiUserId } as any, prisma: ctx.prisma, req: ctx.req });
      
      const workflow = await caller.workflow.load({ id: input.id });
      // ... mapping logic ...
      const res = await caller.workflow.execute({ ... });
      return res;
    })
```

**Line 80** — `const caller = appRouter.createCaller(...)`
- **What:** Creates a server-side caller to the *internal* application router.
- **Why:** Instead of duplicating the complex execution logic, we proxy the request to the existing `appRouter.workflow.execute` method. We mock the `auth.userId` object using the `ctx.apiUserId` we got from Unkey.
- **If removed:** We'd have to rewrite workflow fetching, permission checking, and Trigger.dev invocation logic here.

**Lines 87–134** — Mapping `inputs` and `variables`
- **What:** Transforms the developer-friendly nested objects into the flat `nodeId.fieldKey` structure that the Trigger.dev orchestrator (`orchestrate-workflow.ts`) expects.
- **Why:** We support fuzzy-matching on `variables` (e.g., if a node has exactly one exposed input, the user can just pass `{"Node Label": "value"}`). This requires reading the workflow DAG (`nodes`), extracting `exposedInputKeys`, and translating human labels back to internal IDs.

**Line 138** — `const res = await caller.workflow.execute(...)`
- **What:** Invokes the internal execution engine.
- **Why:** This fires off the task to Trigger.dev. Because we proxied the `caller` with `apiUserId`, the internal execution service ensures the correct user's credit balance is checked and deducted.

### Data Flow Diagram (ASCII)
```
Request Body (variables: {"text": "hello"})
  v
Zod Validation (Ensures webhook is valid URL, etc.)
  v
mutation() function
  v
appRouter.createCaller() (Spoofing internal auth session with Unkey identity)
  v
Fetch Workflow from DB
  v
Map human-readable `variables` to internal flattened `nodeId.field` keys
  v
Trigger.dev tasks.trigger("orchestrate-workflow")
  v
Return { runId: "..." } matching Zod Output Schema
```

### Gotchas & Non-Obvious Constraints
- > ⚠️ **GOTCHA:** You must use `.input(z.object({...}))`. Passing scalar values like `.input(z.string())` directly will cause `trpc-to-openapi` to break or generate invalid JSON Schema, as REST bodies generally expect objects.
- > ⚠️ **GOTCHA:** If the internal `appRouter.workflow.execute` modifies its return type, and it no longer matches the `.output()` Zod schema defined here, tRPC will throw an internal server error on successful execution, breaking the public API.

---

## File: `app/api/v1/openapi.json/route.ts`

### Overview
This file serves the dynamic, auto-generated OpenAPI 3.x specification JSON. Mintlify requests this URL to hydrate its entire API reference section automatically.

### Dependency Graph
- **Imports from:** `next/server`, `generateOpenApiDocument` from `trpc-to-openapi`, and `publicApiRouter`.
- **Imported by:** Nothing. Mintlify reads this via network request using the `openapi` key in `mint.json`.

### Line-by-Line Walkthrough

#### Lines 5–19: Document Generation

```ts
export function GET() {
  const doc = generateOpenApiDocument(publicApiRouter, {
    title: "NextFlow API",
    version: "1.0.0",
    baseUrl: "https://next-flow-beta.vercel.app/api",
    description: "REST API for triggering and monitoring AI generation workflows",
    tags: ["Workflows", "Executions", "Credits"],
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "NextFlow API key — generate from Settings → API Keys",
      },
    },
  });
```

**Line 6** — `const doc = generateOpenApiDocument(publicApiRouter, {`
- **What:** Traverses the entire `publicApiRouter` AST, searching for `.meta({ openapi: ... })`.
- **Why:** Only `publicApiRouter` is passed. If `appRouter` was passed, every single internal UI endpoint would be dumped into the public spec.

**Lines 7–11** — `title`, `version`, `baseUrl`, `description`, `tags`
- **What:** Standard OpenAPI meta-information.
- **Why:** `baseUrl` is crucial: it dictates where the Mintlify "Try it" playground routes requests. If this is `localhost` in production, the playground fails.

**Lines 12–18** — `securitySchemes`
- **What:** Declares the auth mechanism.
- **Why:** `scheme: "bearer"` tells OpenAPI that requests require an `Authorization: Bearer <key>` header. Because the tRPC endpoints use `.meta({ openapi: { protect: true } })`, they inherit this requirement.

#### Lines 21–52: Post-Processing Examples

```ts
  // ── Post-process: inject request body examples for Mintlify playground ──
  const paths = (doc as any).paths ?? {};

  const executePath = paths["/v1/workflows/{id}/execute"];
  if (executePath?.post?.requestBody?.content?.["application/json"]) {
    executePath.post.requestBody.content["application/json"].example = {
      variables: {
        "text": { text: "Explain why pineapple belongs on pizza." }
      },
      // ...
    };
  }
  
  return NextResponse.json(doc);
}
```

**Lines 21–49** — Manual post-processing of the `doc` object.
- **What:** Directly mutates the OpenAPI JSON object in memory to inject `example` objects into the request bodies.
- **Why:** While Zod `.describe()` handles individual field descriptions, `trpc-to-openapi` struggles to generate rich, nested *full-body* examples automatically. Injecting them directly ensures the Mintlify playground defaults to a working, comprehensive payload.
- **If removed:** The Mintlify playground would start completely blank or with useless default strings (like `"string"`), frustrating developers trying to test the API.

**Line 51** — `return NextResponse.json(doc);`
- **What:** Serves the JSON to the client (Mintlify).

### Data Flow Diagram (ASCII)
```
GET /api/v1/openapi.json
  |
  +-> generateOpenApiDocument(publicApiRouter)
  |      +-> Parses listWorkflows metadata & Zod schemas -> JSON Schema
  |      +-> Parses executeWorkflow metadata & Zod schemas -> JSON Schema
  |
  +-> Mutate `doc.paths["/v1/..."]` to inject default JSON body examples
  |
  +-> Return Response(doc)
```

### Gotchas & Non-Obvious Constraints
- > ⚠️ **GOTCHA:** `baseUrl` is hardcoded to `https://next-flow-beta.vercel.app/api`. If deployed to production under a custom domain, the OpenAPI playground will continue sending requests to the beta URL, which may cause CORS errors or Unkey rejection if environments differ. Use `process.env.VERCEL_URL` or a custom environment variable to set `baseUrl` dynamically.
- > ⚠️ **GOTCHA:** The Next.js Edge Runtime might cache `GET` handlers with no arguments. Ensure `openapi.json` is not returning a stale cached spec if you modify the Zod schemas and redeploy. Add `export const dynamic = 'force-dynamic'` if cache invalidation becomes an issue.

---

## File: `docs/mint.json`

### Overview
This is the master configuration file for the Mintlify documentation site. It dictates navigation structure, theming, branding, and API playground configuration.

### Dependency Graph
- **Imports from:** N/A (JSON configuration)
- **Imported by:** The Mintlify build engine reads this at generation time.

### Key-by-Key Walkthrough

```json
{
  "$schema": "https://mintlify.com/schema.json",
  "name": "NextFlow",
  "logo": {
    "dark": "/logo/dark.svg",
    "light": "/logo/light.svg"
  },
```
- **`$schema`**: Enables autocomplete/intellisense in IDEs for `mint.json`.
- **`name`**: The text that appears in the browser tab and globally across the docs.
- **`logo`**: Paths to static SVGs placed in the `/docs/logo/` folder. Mintlify automatically switches between them based on user OS dark/light mode preference.

```json
  "colors": {
    "primary": "#0F172A",
    "light": "#F8FAFC",
    "dark": "#0B0F19",
    "anchors": {
      "from": "#0F172A",
      "to": "#334155"
    }
  },
```
- **`colors.primary`**: Dictates the color of primary CTA buttons, active states, and code block headers.
- **`colors.anchors`**: Defines the gradient colors used for hyperlink underlines and hover states.

```json
  "navigation": [
    {
      "group": "Get Started",
      "pages": [
        "introduction",
        "authentication",
        "quickstart"
      ]
    },
    {
      "group": "API Reference",
      "pages": [
        "api-reference/workflows/list",
        "api-reference/workflows/get",
        "api-reference/workflows/execute",
        "api-reference/workflows/execute-selected",
        "api-reference/executions/get",
        "api-reference/credits/get"
      ]
    }
  ],
```
- **`navigation`**: Creates the left sidebar.
- **`group`**: The category header (e.g., "API Reference").
- **`pages`**: The relative paths (without `.mdx`) to the files in the `docs` folder.
- **If missing or mistyped:** Mintlify will throw a 404 for that page, even if the `.mdx` file exists on disk. Files must be explicitly registered here.

```json
  "api": {
    "baseUrl": "https://next-flow-beta.vercel.app",
    "auth": {
      "method": "bearer"
    }
  },
  "openapi": "https://next-flow-beta.vercel.app/api/v1/openapi.json"
}
```
- **`api.baseUrl`**: Overrides the `baseUrl` from the OpenAPI spec for the interactive playground. (Note the lack of `/api` here, it appends the path from the OpenAPI spec).
- **`api.auth.method`**: Instructs the Mintlify UI to prompt the user for a token and format it as `Bearer <token>`.
- **`openapi`**: The remote URL where Mintlify pulls the spec.
- **Why a URL instead of a file?**: This allows the docs to sync dynamically with the live API. If we update a Zod schema in production, the docs automatically reflect the new constraints without requiring a manual spec export.

### Gotchas & Non-Obvious Constraints
- > ⚠️ **GOTCHA:** The `openapi` key points to a production URL. If you are testing changes locally, your local Mintlify dev server (`npx mintlify dev`) will still be pulling the production OpenAPI spec, meaning your local Zod changes won't appear in the local docs until you deploy. You must temporarily change `openapi` to `http://localhost:3000/api/v1/openapi.json` for local testing.

---

## File: `docs/api-reference/workflows/execute.mdx`

### Overview
This Markdown/MDX file utilizes Mintlify's custom components to render human-readable documentation for the execution endpoint. Because it references an OpenAPI endpoint via frontmatter, Mintlify automatically generates the right-side playground pane, request body parameters, and response schemas.

### Dependency Graph
- **Imports from:** `mint.json` (for navigation placement), `openapi.json` (via frontmatter).
- **Imported by:** Rendered by Mintlify engine.

### Line-by-Line Walkthrough

#### Lines 1–4: Frontmatter

```mdx
---
title: "Execute Workflow"
openapi: "POST /v1/workflows/{id}/execute"
---
```

**Line 2** — `title: "Execute Workflow"`
- **What:** The H1 heading and sidebar text for the page.

**Line 3** — `openapi: "POST /v1/workflows/{id}/execute"`
- **What:** The magic directive.
- **Why:** Mintlify parses the `openapi.json` file, looks up the `paths["/v1/workflows/{id}/execute"].post` object, and automatically extracts:
  1. The `{id}` path parameter (renders a `<ParamField path="id">` automatically).
  2. The `requestBody` Zod schema (renders the request configuration table).
  3. The `responses` schemas.
  4. The "Try it" playground logic.
- **If removed:** The page becomes a standard markdown page without API interactivity or auto-generated schema tables.

#### Lines 18–21: Mintlify Components

```mdx
<Warning>
  `variables` **only works with exposed inputs**. If a node or field is not exposed,
  the override will be silently ignored. Use `inputs` (below) for non-exposed fields.
</Warning>
```

**Lines 18–21** — `<Warning>`
- **What:** A Mintlify-specific React component injected into MDX.
- **Why:** Renders a visually distinct callout box (orange/red styling) highlighting critical API constraints.

#### Lines 36–44: Static Code Blocks

```mdx
```json
{
  "variables": {
    "<node_label>": {
      "<field_key>": "<value>"
    }
  }
}
```
```

**What:** Standard markdown syntax highlighting.
- **Why:** While the right-hand playground automatically shows the JSON schema, human-readable explanatory snippets in the center column help establish mental models (like explaining the shape of `variables`).

#### Lines 196–206: Response Examples

```mdx
<ResponseExample>
```json 200
{
  "runId": "run_abc123",
  "workflowId": "wf_xyz",
  "scope": "FULL",
  "nodeCount": 11,
  "estimatedCredits": 141200
}
```
</ResponseExample>
```

**Lines 196 & 206** — `<ResponseExample>`
- **What:** A Mintlify component that captures the contained code block and teleports it into the right-hand column of the documentation page.
- **Why:** Keeps the center column focused on prose while putting the technical response payloads in the secondary column. The `200` annotation attaches it to the HTTP 200 success tab.

### Gotchas & Non-Obvious Constraints
- > ⚠️ **GOTCHA:** The string passed to `openapi: "..."` must perfectly match the case, method, and path exactness of the OpenAPI JSON. A trailing slash or missing `/v1` will cause Mintlify to fail to hydrate the page.

---

## Cross-File Architecture Summary

### How OpenAPI spec flows from tRPC → Mintlify → Developer

```text
1. DESIGN-TIME (Codebase)
Zod Schemas + .meta() defined in `public-api.ts`
      |
2. RUN-TIME (Next.js Server)
`generateOpenApiDocument()` converts Zod -> OpenAPI JSON
      |
3. BUILD-TIME (Mintlify)
Mintlify cloud requests `GET /api/v1/openapi.json`
      |
4. RENDER-TIME (Docs Site)
Mintlify merges JSON Spec + `.mdx` prose -> Static Docs Pages
      |
5. INTERACTION-TIME (Developer)
Developer fills out Playground -> hits `POST /api/v1/[...path]`
      |
6. EXECUTION-TIME (Next.js Edge)
`trpc-to-openapi` routes POST -> Unkey validates Bearer Token -> `public-api` Zod validates input -> Trigger.dev Task
```

### Public API Endpoint Reference — Complete Table

| HTTP Method | Path | tRPC Procedure | Auth | Input Schema | Output Schema | Mintlify Page |
|---|---|---|---|---|---|---|
| `GET` | `/v1/workflows` | `listWorkflows` | Unkey | None | Array of `{id, name, updatedAt}` | `workflows/list.mdx` |
| `GET` | `/v1/workflows/{id}` | `getWorkflow` | Unkey | `{id: string}` | `{id, nodes, edges, ...}` | `workflows/get.mdx` |
| `POST` | `/v1/workflows/{id}/execute` | `executeWorkflow` | Unkey | `{id, variables?, inputs?, webhook?}`| `{runId, estimatedCredits, ...}` | `workflows/execute.mdx` |
| `POST` | `/v1/workflows/{id}/execute-selected`| `executeSelected` | Unkey | `{id, selectedNodeIds, ...}` | `{runId, estimatedCredits, ...}` | `workflows/execute-selected.mdx`|
| `GET` | `/v1/executions/{id}` | `getExecution` | Unkey | `{id: string}` | `{status, nodeRuns, ...}` | `executions/get.mdx` |
| `GET` | `/v1/credits` | `getCredits` | Unkey | None | `{balance, formatted}` | `credits/get.mdx` |

### Error Response Taxonomy

When the public API fails, `trpc-to-openapi` transforms tRPC errors into HTTP codes:

1. **HTTP 401 Unauthorized**
   - **Cause:** Missing `Authorization` header, revoked Unkey, rate-limited Unkey.
   - **Body:** `{ "message": "Invalid API key", "code": "UNAUTHORIZED" }`
   - **Action:** Dev must check billing or generate a new key.

2. **HTTP 400 Bad Request**
   - **Cause:** Zod schema validation failure (e.g., passing `"not-a-url"` to the webhook field).
   - **Body:** Contains the exact `zodError` string mapped in `server/trpc/trpc.ts`.
   - **Action:** Dev must fix their JSON payload.

3. **HTTP 404 Not Found**
   - **Cause:** Calling an endpoint that doesn't exist, or providing a `{id}` for a workflow that doesn't belong to the `apiUserId`.
   - **Body:** `{ "message": "NOT_FOUND" }`
   - **Action:** Verify URL and workflow ID ownership.

4. **HTTP 500 Internal Server Error**
   - **Cause:** Trigger.dev is down, database fails, or output schema doesn't match internal procedure return type.

### Unkey Integration Map
- **Validation:** Every request to `/api/v1/*` runs through `createOpenApiContext`.
- **Identity:** Unkey returns `identity.externalId`, which maps 1:1 to the `User.id` column in PostgreSQL.
- **Rate Limiting:** Managed via Unkey dashboard configurations, enforced at the Edge before Next.js processes the request body.
- **Credits:** Unkey does *not* deduct credits. Credit deduction happens via `CreditLedger` service calls inside the `executeWorkflow` procedure.

---

## If I Were Refactoring This Tomorrow

**1. The `openapi.json` network roundtrip is brittle.**
- **Current:** Mintlify fetches `openapi.json` from the live production Vercel URL at build time.
- **Better:** A CI/CD GitHub Action that runs `npm run generate-spec` to emit an `openapi.json` file to the `docs/` folder, and commits it.
- **Why:** Architecture. If Vercel has a cold start timeout or the API returns a 500 during Mintlify's build process, the documentation build fails. Tying doc builds to live production runtime is a recipe for flakiness.

**2. Local Development Experience is confusing.**
- **Current:** `mint.json` hardcodes the production `openapi` URL. Local developers modifying Zod schemas can't see their changes in `npx mintlify dev` without changing `mint.json` to localhost, which accidentally gets committed.
- **Better:** Use Mintlify's multiple spec configuration or an environment variable override for the spec URL.
- **Why:** Developer experience. Developers shouldn't have to hack production configs to test API changes locally.

**3. The `POST` empty-body workaround is a hack.**
- **Current:** `app/api/v1/[...path]/route.ts` clones the request stream and manually injects `"{}"` to prevent JSON parse errors.
- **Better:** Fix the upstream library (`trpc-to-openapi`) or add a rigorous Next.js middleware that normalizes incoming requests cleanly before they hit the route handler.
- **Why:** Code quality. Cloning streams in Edge/Serverless environments is an unnecessary memory allocation and adds latency to every single API call.

**4. Error responses are completely undocumented in the OpenAPI spec.**
- **Current:** Zod schemas only define `.output()`, which maps to `responses[200]`. There are no 400, 401, or 500 error schemas documented in the OpenAPI spec.
- **Better:** Use `trpc-to-openapi`'s advanced metadata configurations or custom extensions to document error payload shapes.
- **Why:** Reliability. A developer integrating this API currently has no typed contract for what an error looks like, meaning their error handling will be built by trial-and-error.

**5. `apiUserId` spoofing in internal caller.**
- **Current:** `appRouter.createCaller({ auth: { userId: ctx.apiUserId } as any })` forces a type cast (`as any`) to bypass Clerk's required auth object shape.
- **Better:** Refactor the internal services (like `workflow.execute`) to accept a generic `userId: string` dependency injection instead of relying directly on the tRPC `ctx.auth` object.
- **Why:** Code quality. Type casting `as any` in core auth/authorization pathways is a security risk waiting to happen. The internal logic should be agnostic to whether the request came from Clerk or Unkey.
