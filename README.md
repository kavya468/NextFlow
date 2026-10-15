# NextFlow

A visual workflow editor for connecting text, image, audio, and video tools. Build a graph, supply inputs, run the pipeline, and inspect the values passed between steps.

Created by [Kavya](https://github.com/kavya468).

## What it does

- **Visual composition:** typed connections, reusable templates, JSON import/export, and a configurable node palette.
- **Execution:** whole workflows or selected nodes with their dependencies, persistent run history, cancellation, and recovery of interrupted runs.
- **Input handling:** validates connected values and provider payloads; failed dependencies block downstream steps instead of reusing stale results.
- **Credit accounting:** reserves the maximum allowed cost before dispatch, records successful usage, and settles once. Unconfirmed provider outcomes retain their reservation.
- **Draft protection:** serializes autosaves and checks workflow revisions. Conflicts preserve the local draft for export or explicit reload.
- **Programmatic access:** authenticated REST endpoints and an HTTP MCP endpoint for workflow management and execution.

The registry contains 15 node types: text, image and video inputs; Gemini and OpenRouter text generation; Seedream images; Seedance video; ElevenLabs dialogue; image cropping, frame/audio extraction and media merging; Kling editing and lipsync. **Kling and lipsync execution are currently disabled** until duration-based billing can be verified. See [billing policy and limits](docs/BILLING_POLICY.md).

## Architecture

| Area | Implementation |
| --- | --- |
| Application | Next.js App Router, React, TypeScript |
| Editor | React Flow, Zustand, shared UI configuration |
| API and authentication | tRPC, REST/OpenAPI, MCP, Clerk sessions, Unkey API keys |
| Persistence | PostgreSQL, Prisma, transactional credit ledger |
| Background execution | Trigger.dev tasks, provider adapters, FFmpeg |
| Media storage | Signed Transloadit uploads |

The web application validates and snapshots a workflow before creating a run. Trigger.dev workers execute that snapshot and persist node inputs, outputs, and accounting results. The UI reads the database state; a worker completion event alone does not establish that billing has settled.

## Run locally

Use **Node 24** (the exact version is in `.nvmrc`) and **pnpm 10.33.0**. You also need a separate PostgreSQL database and a Clerk development application. The database adapter supports loopback PostgreSQL for local development and Neon for hosted use.

```bash
git clone https://github.com/kavya468/NextFlow.git
cd NextFlow
cp .env.example .env.local
pnpm install --frozen-lockfile
```

Fill in `.env.local` before starting the app. The example groups credentials by feature; it contains no working keys.

```bash
pnpm db:migrate
pnpm dev
```

Open [localhost:3000](http://localhost:3000) and sign in. `db:migrate` applies checked-in migrations to the configured database; confirm the connection points to your development database first.

Workflow execution also needs a Trigger.dev development worker. Set your project reference in `trigger.config.ts`, configure its development secret, and start it in another terminal:

```bash
pnpm exec trigger.dev login
pnpm exec trigger.dev dev
```

Configure provider credentials in the worker environment for the nodes you use. Media processing needs FFmpeg and FFprobe on `PATH`, plus Transloadit credentials for storing results. Uploads also require Unkey for rate limiting. Fal callbacks need a publicly reachable HTTPS `NEXT_PUBLIC_APP_URL` and the same `FAL_WEBHOOK_SECRET` in the app and worker; localhost alone cannot receive them.

Paid nodes require a funded credit ledger. There is no self-service purchase flow or automatic development credit grant. Start with a Text-to-Text workflow to check dispatch and input propagation without paid providers.

## Development checks

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the development server |
| `pnpm typecheck` | Generate Next.js route types and check TypeScript |
| `pnpm test` | Run unit and mocked integration tests, including native media checks |
| `pnpm test:integration` | Run accounting, recovery, and save-conflict tests against isolated PostgreSQL |
| `pnpm lint` | Report application-wide lint findings |
| `pnpm build` | Generate Prisma client and build the web application |
| `pnpm db:migrate` | Apply checked-in database migrations |

The database tests require a **disposable loopback PostgreSQL database named `nextflow_test`**. They delete their fixtures. Configure `DATABASE_URL` and `DIRECT_URL` explicitly, apply migrations, then run `pnpm test:integration`. Keep these credentials separate from the database used by your browser session.

[CI](.github/workflows/ci.yml) checks types, boundary/test lint, unit tests, PostgreSQL integration tests, and the production build. Full application lint is reported separately while older lint debt is addressed. Native media tests require FFmpeg and FFprobe; CI installs them explicitly.

## REST and MCP

Generate an API key from **Settings > API Keys**. REST requests use `Authorization: Bearer <key>` and the `/api/v1` prefix:

```bash
curl http://localhost:3000/api/v1/workflows \
  -H "Authorization: Bearer $NEXTFLOW_API_KEY"
```

The generated specification is served at `/api/v1/openapi.json`. Request examples and payload details are in [the API documentation](docs/quickstart.mdx). Execution requests accept an `idempotencyKey`; reuse it with the same request when retrying an uncertain response.

MCP clients connect to `/api/mcp` using HTTP transport and the same bearer API key. The server exposes workflow discovery, graph editing, and execution tools. There is no separate stdio MCP server to install.

## Source layout

| Path | Contents |
| --- | --- |
| `app/`, `components/`, `hooks/` | Pages, editor UI, and save coordination |
| `lib/nodes/` | Node contracts, provider mappings, and registry |
| `lib/services/`, `lib/credits/` | Workflow lifecycle, recovery, and accounting |
| `lib/ui-config.ts`, `app/globals.css` | Shared interaction/copy settings and visual tokens |
| `server/trpc/` | Authenticated application and REST procedures |
| `src/trigger/` | Background orchestration and provider/media tasks |
| `prisma/` | Database schema and versioned migrations |
| `lib/__tests__/`, `hooks/__tests__/`, `tests/` | Regression tests and local verification fixtures |
| `docs/` | API reference and billing policy |

Generated JavaScript, Prisma clients, build output, credentials, local agent configuration, and design experiments are excluded from version control.

## Release status

This branch includes changes to the database schema, task payloads, and accounting contract. The application and worker must be released together after migrations and staging verification; updating only one is insufficient.

Local tests cover concurrency, recovery, payload validation, save conflicts, and media boundaries. Live paid-provider execution and hosted worker recovery still need end-to-end verification. Existing dependency advisories and application lint debt remain. Completion callbacks are best-effort, without delivery retries or event filtering; poll execution status for confirmation.

Automatic Vercel deployments are enabled for pushes to `main` in `vercel.json`. Feature branches run CI and remain undeployed. A local commit alone does not deploy; it must reach GitHub. Vercel uses the linked Git repository, Node 24, and Corepack with the pinned pnpm version.

Before the first release of this execution contract, configure the environment variables in `.env.example`, apply migrations, and release the matching Trigger.dev worker. Vercel builds the web application only; it does not migrate the database or deploy background tasks. Keep the PR unmerged until that coordinated release is ready.

## Ownership

This repository is maintained by Kavya. The project remains proprietary; publishing its source does not grant an open-source license. Third-party libraries and services retain their respective licenses and terms.
