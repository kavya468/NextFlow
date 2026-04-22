<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/PostgreSQL-Neon-336791?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Prisma-7-2D3748?style=for-the-badge&logo=prisma" alt="Prisma" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
</p>

<h1 align="center">⚡ NextFlow</h1>

<p align="center">
  <strong>A visual AI workflow builder for orchestrating LLM pipelines, media processing, and multi-modal content generation — powered by React Flow, Google Gemini, and Trigger.dev.</strong>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#%EF%B8%8F-tech-stack">Tech Stack</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#-project-structure">Project Structure</a> •
  <a href="#-node-types">Node Types</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-api-reference">API Reference</a> •
  <a href="#-database-schema">Database Schema</a> •
  <a href="#-deployment">Deployment</a>
</p>

---

## 🎯 Overview

**NextFlow** is a full-stack visual workflow builder inspired by [Krea.ai](https://krea.ai), designed specifically for **LLM-powered pipelines**. Users can visually compose complex AI workflows by dragging and connecting nodes on an interactive canvas — from simple text prompts to multimodal image/video processing — and execute them with a single click.

The project demonstrates production-grade engineering with:
- **Type-safe APIs** with Zod schema validation
- **Background job orchestration** via Trigger.dev with parallel DAG execution
- **Real-time visual feedback** with pulsating glow effects on running nodes
- **Full authentication** and per-user data scoping via Clerk
- **Persistent workflow history** with node-level execution details

---

## ✨ Features

### 🎛️ High-Fidelity Dashboard & Project Management
- **Premium Hero Section** — Krea.ai-inspired dashboard header with absolute-positioned halo blur gradients and optimized webp assets.
- **Intelligent Workflow Cards** — Grid display featuring deterministically hashed gradient backgrounds for unique visual identities per workflow.
- **Abstract SVG Mini-Graphs** — Each thumbnail dynamically renders an abstract node connection graph instead of static icons.
- **Full Lifecycle Management** — Custom 3-dot context menus (`⋮`) for seamless **Open**, **Rename** (inline editor), **Duplicate** (deep copy clone), and **Delete** actions.
- **Micro-Animations** — Smooth CSS fade-ins for dropdowns and custom toast notifications for real-time user feedback.

### 🖼️ Visual Workflow Canvas
- **Drag & drop** nodes from the sidebar or click-to-add directly onto a React Flow canvas.
- **Floating Canvas Controls** — Matte-black floating taskbar at the bottom-left for precise Zoom In, Zoom Out, and Fit View functionality.
- **Data-Type Standardized Handles** — Color-coded routing logic ensuring visual and systematic type safety:
  - 🟡 **Yellow** — Text & Numeric Parameters (`prompt`, `x`, `y`, `width`, `timestamp`)
  - 🔵 **Blue** — Image capabilities
  - 🩷 **Pink** — Video & motion capabilities
- **Dynamic Edge Engine** — Animated edge connections that dynamically inherit color from their source handles with custom SVG shadow filters and opacity masks.
- **MiniMap Navigation** — Bottom-right overview array with `cursor-grab` panning.
- **Undo / Redo** support (`⌘Z` / `⌘⇧Z`).

### 🧩 6 Purpose-Built Node Types
| Node | Description |
|------|-------------|
| **Text Node** | Simple text input/textarea with output handle |
| **Upload Image Node** | File upload via Transloadit with image preview |
| **Upload Video Node** | File upload via Transloadit with video player preview |
| **Run Any LLM Node** | Gemini model selector with system prompt, user message, and image inputs |
| **Crop Image Node** | Configurable crop parameters (x%, y%, width%, height%) via FFmpeg |
| **Extract Frame Node** | Extracts a single frame from video at a given timestamp via FFmpeg |

### ⚡ Smart Execution Engine
- **DAG-based orchestration** — topological sort with parallel layer execution
- **Selective execution** — run the entire workflow, selected nodes, or a single node
- **Real-time polling** — live status updates with pulsating glow on running nodes
- **Input chaining** — outputs flow automatically between connected nodes

### 📜 Workflow History
- **Right sidebar panel** displays all past workflow runs
- Each run shows **timestamp**, **status** (success/failed/partial), **duration**, and **scope** (full/partial/single)
- **Expandable node-level details** — inputs, outputs, errors, and durations for each node
- **Color-coded status badges** — 🟢 success, 🔴 failed, 🟡 running

### 🔐 Authentication & Security
- **Clerk-powered** sign in / sign up
- **Protected routes** — all workflow and API routes require authentication
- **User-scoped data** — workflows and history are isolated per user

### 💾 Persistence & Portability
- **Save & load** workflows to PostgreSQL database
- **Export / Import** workflows as JSON files
- **Pre-built sample workflow** — _Product Marketing Kit Generator_ template

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Framework** | [Next.js 16](https://nextjs.org) (App Router) | React framework with server-side capabilities |
| **Language** | [TypeScript 5](https://typescriptlang.org) | Type safety throughout the codebase |
| **UI Library** | [React 19](https://react.dev) | Component-based UI |
| **Canvas** | [@xyflow/react v12](https://reactflow.dev) (React Flow) | Visual workflow / node graph library |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com) | Dark zinc/violet theme matching Krea.ai |
| **State Management** | [Zustand](https://zustand-demo.pmnd.rs) | Lightweight global state with undo/redo |
| **Authentication** | [Clerk](https://clerk.com) | Full auth flow with protected routes |
| **Database** | [PostgreSQL](https://neon.tech) (Neon) | Serverless Postgres for persistence |
| **ORM** | [Prisma 7](https://prisma.io) | Type-safe database access with driver adapters |
| **Background Jobs** | [Trigger.dev v3](https://trigger.dev) | All node executions run as background tasks |
| **LLM Provider** | [Google Gemini](https://ai.google.dev) | Multimodal AI with vision support |
| **File Uploads** | [Transloadit](https://transloadit.com) + [Uppy](https://uppy.io) | Client-side uploads with server-side processing |
| **Media Processing** | FFmpeg (via Trigger.dev) | Image cropping, video frame extraction |
| **Validation** | [Zod](https://zod.dev) | Schema validation for API routes |
| **Icons** | [Lucide React](https://lucide.dev) | Modern icon library |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18.x
- **npm** (or yarn / pnpm)
- Accounts for the following services (all have free tiers):

| Service | Sign Up | What You Need |
|---------|---------|---------------|
| [Clerk](https://clerk.com) | Dashboard → Create App | Publishable Key + Secret Key |
| [Neon](https://neon.tech) | Create a free Postgres database | `DATABASE_URL` connection string |
| [Google AI Studio](https://aistudio.google.com) | Get API Key | `GEMINI_API_KEY` |
| [Trigger.dev](https://trigger.dev) | Create a project | `TRIGGER_SECRET_KEY` |
| [Transloadit](https://transloadit.com) | Sign up | Auth Key + Auth Secret |

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/nextflow.git
cd nextflow

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Then fill in your API keys (see Environment Variables section below)

# 4. Generate Prisma client
npx prisma generate

# 5. Push the database schema
npx prisma db push

# 6. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Environment Variables

Create a `.env` file in the project root with the following variables:

```env
# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# PostgreSQL Database (Neon)
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"

# Google Gemini API
GEMINI_API_KEY=AIza...

# Trigger.dev
TRIGGER_SECRET_KEY=tr_dev_...

# Transloadit
NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY=...
TRANSLOADIT_AUTH_SECRET=...
```

### Running Trigger.dev (Background Tasks)

Trigger.dev tasks require a separate dev process:

```bash
# In a separate terminal
npx trigger.dev@latest dev
```

---

## 📁 Project Structure

```
nextflow/
├── app/                              # Next.js App Router
│   ├── api/workflow/                 # REST API routes
│   │   ├── execute/route.ts          #   POST — Run workflow via Trigger.dev
│   │   ├── status/route.ts           #   GET  — Poll run status by runId
│   │   ├── save/route.ts             #   POST — Save workflow to database
│   │   ├── load/route.ts             #   GET  — List or load workflows
│   │   └── history/route.ts          #   GET  — Fetch workflow run history
│   ├── globals.css                   # Tailwind theme + React Flow handle styles
│   ├── layout.tsx                    # Root layout (ClerkProvider, fonts, dark mode)
│   └── page.tsx                      # Main page: canvas + sidebars
│
├── components/
│   ├── canvas/
│   │   ├── WorkflowCanvas.tsx        # React Flow setup, connection validation, drag & drop
│   │   └── ExecutionControls.tsx      # Run, undo/redo, export/import toolbar
│   ├── edges/
│   │   └── DeletableEdge.tsx         # Custom edge with delete button
│   ├── nodes/
│   │   ├── TextNode.tsx              # Prompt / text input node
│   │   ├── ImageNode.tsx             # Image upload (Uppy/Transloadit) node
│   │   ├── VideoNode.tsx             # Video upload (Uppy/Transloadit) node
│   │   ├── LLMNode.tsx              # Gemini LLM node with model selector
│   │   ├── CropNode.tsx             # Image cropping (FFmpeg) node
│   │   └── ExtractNode.tsx          # Video frame extraction (FFmpeg) node
│   ├── sidebar-left/
│   │   └── LeftSidebar.tsx           # Draggable node palette + UserButton
│   └── sidebar-right/
│       └── RightSidebar.tsx          # Workflow history panel with run details
│
├── lib/
│   ├── store.ts                      # Zustand store (nodes, edges, undo/redo, running)
│   ├── db.ts                         # Prisma client with pg driver adapter
│   ├── schemas.ts                    # Zod validation schemas
│   ├── templates.ts                  # Pre-built sample workflow template
│   └── useConnectedHandles.ts        # Hook for detecting connected inputs
│
├── src/trigger/                      # Trigger.dev background tasks
│   ├── orchestrator.ts               # DAG execution engine
│   ├── llm.ts                        # Gemini API task
│   └── media.ts                      # FFmpeg crop & frame extraction tasks
│
├── prisma/
│   └── schema.prisma                 # Database models (User, Workflow, Run, NodeRun)
│
├── middleware.ts                      # Clerk auth middleware for route protection
├── trigger.config.ts                  # Trigger.dev project configuration
├── next.config.ts                     # Next.js configuration
├── prisma.config.ts                   # Prisma driver adapter configuration
├── package.json                       # Dependencies and scripts
└── tsconfig.json                      # TypeScript configuration
```

---

## 🧩 Node Types

### 1. Text Node
> Simple text input for prompts and messages.

- **Output Handle:** `text_output` (text)
- **Usage:** Feed into LLM system prompts or user messages

### 2. Upload Image Node
> Upload images via Transloadit with in-node preview.

- **Supported Formats:** `jpg`, `jpeg`, `png`, `webp`, `gif`
- **Output Handle:** `image_url` (image URL)
- **Upload Provider:** Uppy + Transloadit

### 3. Upload Video Node
> Upload videos via Transloadit with in-node video player.

- **Supported Formats:** `mp4`, `mov`, `webm`, `m4v`
- **Output Handle:** `video_url` (video URL)
- **Upload Provider:** Uppy + Transloadit

### 4. Run Any LLM Node
> Execute Google Gemini models with multimodal inputs.

- **Input Handles:**
  - `system_prompt` — optional system instructions (from Text Node)
  - `user_message` — required user message (from Text Node)
  - `images` — optional images for vision (from Image/Crop/Extract nodes, supports multiple)
- **Output Handle:** `output` (generated text)
- **Model Selector:** Dropdown to choose Gemini model variant
- **Result Display:** Rendered inline within the node

### 5. Crop Image Node
> Crop images using percentage-based coordinates via FFmpeg.

- **Input Handles:**
  - `image_url` — source image (required)
  - `x_percent` — X offset 0–100 (default: 0)
  - `y_percent` — Y offset 0–100 (default: 0)
  - `width_percent` — crop width 0–100 (default: 100)
  - `height_percent` — crop height 0–100 (default: 100)
- **Output Handle:** `output` (cropped image URL)
- **Processing:** FFmpeg via Trigger.dev → uploaded to Transloadit

### 6. Extract Frame from Video Node
> Pull a single frame from a video at a specific timestamp.

- **Input Handles:**
  - `video_url` — source video (required)
  - `timestamp` — seconds or percentage string e.g. `"50%"` (default: 0)
- **Output Handle:** `output` (extracted frame image URL)
- **Processing:** FFmpeg via Trigger.dev → uploaded to Transloadit

---

## 🏗 Architecture

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                           BROWSER (Client)                          │
│                                                                      │
│  ┌─────────────┐   ┌──────────────────────┐   ┌──────────────────┐  │
│  │ Left Sidebar │   │   Workflow Canvas     │   │  Right Sidebar   │  │
│  │ (Node tools) │   │   (React Flow)        │   │  (Run History)   │  │
│  └──────┬──────┘   └──────────┬───────────┘   └────────┬─────────┘  │
│         │     Zustand Store    │                        │             │
│         └──────────┬───────────┘                        │             │
│                    │                                    │             │
│         ┌──────────▼───────────┐              ┌────────▼─────────┐  │
│         │ ExecutionControls    │              │  History Polling   │  │
│         │ (Run/Undo/Export)    │              │  (GET /history)    │  │
│         └──────────┬───────────┘              └──────────────────┘  │
│                    │                                                  │
└────────────────────┼─────────────────────────────────────────────────┘
                     │ POST /api/workflow/execute
                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        NEXT.js API ROUTES                            │
│                                                                      │
│  /execute  →  Auth + Create Run + Trigger orchestrate-workflow       │
│  /status   →  Auth + Return run + nodeRuns by runId                  │
│  /save     →  Auth + Create/Update workflow in DB                    │
│  /load     →  Auth + List or load workflow by ID                     │
│  /history  →  Auth + List recent runs with node details              │
│                                                                      │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ tasks.trigger()
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        TRIGGER.DEV (Background)                      │
│                                                                      │
│  ┌─────────────────────────────────┐                                 │
│  │   orchestrate-workflow          │                                 │
│  │   • Topological sort (DAG)      │                                 │
│  │   • Execute layers in parallel  │──┬──► generate-llm-content      │
│  │   • Gather inputs from edges    │  │     (Gemini API + images)    │
│  │   • Write results to DB         │  │                              │
│  │                                 │  ├──► crop-image                │
│  │                                 │  │     (FFmpeg → Transloadit)   │
│  │                                 │  │                              │
│  │                                 │  └──► extract-frame             │
│  └─────────────────────────────────┘        (FFmpeg → Transloadit)   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    POSTGRESQL (Neon) via PRISMA                       │
│                                                                      │
│  User ──< Workflow ──< Run ──< NodeRun                               │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Execution Flow

1. **User Interaction** — User builds a workflow by dragging nodes from the left sidebar onto the canvas and connecting them
2. **Run Trigger** — User clicks "Run Workflow" → `POST /api/workflow/execute` with nodes, edges, and optional selected node IDs
3. **Server Processing** — API route authenticates via Clerk, creates `Run` + `NodeRun` records in the database, triggers the `orchestrate-workflow` task on Trigger.dev
4. **DAG Execution** — Orchestrator performs topological sort, groups nodes into execution layers, runs independent nodes in parallel, waits for dependencies
5. **Task Execution** — Each node type dispatches to its specialized task (LLM → Gemini API, Crop/Extract → FFmpeg)
6. **Result Propagation** — Outputs are written to NodeRun records; downstream nodes consume outputs from their upstream dependencies
7. **Client Polling** — `ExecutionControls` polls `GET /api/workflow/status` every 2 seconds, updates running state (pulsating glow), and merges results into node data
8. **History Logging** — Every run (full, partial, or single-node) is recorded with node-level details for the history panel

### Connection Type Validation

```
Text Node     ──► system_prompt, user_message  (LLM Node)
Image Node    ──► images (LLM), image_url (Crop)
Video Node    ──► video_url (Extract Frame)
Crop Node     ──► images (LLM), image_url (Crop)
Extract Node  ──► images (LLM)
LLM Node      ──► system_prompt, user_message  (LLM Node)
```

Invalid connections (e.g., image → text input) are automatically rejected. Circular dependencies (cycles) are detected and prevented.

---

## 📡 API Reference

All API routes are authenticated via Clerk and scoped to the current user.

### `POST /api/workflow/execute`

Triggers workflow execution via Trigger.dev.

**Request Body:**
```json
{
  "nodes": [...],           // React Flow nodes array
  "edges": [...],           // React Flow edges array
  "selectedNodeIds": [],    // Optional: run only these nodes
  "workflowId": "uuid",    // Optional: existing workflow ID
  "name": "My Workflow"    // Optional: workflow name
}
```

**Response:**
```json
{
  "runId": "uuid",
  "triggerId": "string",
  "workflowId": "uuid",
  "scope": "FULL | PARTIAL | SINGLE",
  "nodeCount": 5
}
```

---

### `GET /api/workflow/status?runId=<uuid>`

Returns the current status of a workflow run with node-level details.

**Response:**
```json
{
  "run": {
    "id": "uuid",
    "status": "SUCCESS | FAILED | PARTIAL | RUNNING",
    "scope": "FULL",
    "durationMs": 8200,
    "nodeRuns": [
      {
        "nodeId": "text-1",
        "nodeType": "text",
        "status": "SUCCESS",
        "inputs": { "text": "..." },
        "outputs": { "text": "..." },
        "durationMs": 100
      }
    ]
  }
}
```

---

### `POST /api/workflow/save`

Saves or updates a workflow.

**Request Body:**
```json
{
  "workflowId": "uuid",      // Optional: update existing
  "name": "My Workflow",
  "nodes": [...],
  "edges": [...]
}
```

---

### `GET /api/workflow/load`

- **Without params:** Lists all workflows for the authenticated user
- **With `?id=<uuid>`:** Loads a specific workflow (owner check)

---

### `GET /api/workflow/history`

Returns the most recent 50 workflow runs for the authenticated user, including node-level execution details.

---

## 🗄 Database Schema

NextFlow uses **PostgreSQL** (hosted on [Neon](https://neon.tech)) with **Prisma 7** ORM and the `pg` driver adapter.

```prisma
model User {
  id        String     @id    // Clerk User ID
  workflows Workflow[]
  runs      Run[]
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
}

model Workflow {
  id          String   @id @default(uuid())
  name        String
  description String?
  nodes       Json     // React Flow nodes state
  edges       Json     // React Flow edges state
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  runs        Run[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Run {
  id         String     @id @default(uuid())
  workflowId String
  workflow   Workflow   @relation(...)
  userId     String
  user       User       @relation(...)
  scope      String     // 'FULL', 'PARTIAL', 'SINGLE'
  status     String     // 'SUCCESS', 'FAILED', 'PARTIAL', 'RUNNING'
  durationMs Int?
  nodeRuns   NodeRun[]
  createdAt  DateTime   @default(now())
}

model NodeRun {
  id         String   @id @default(uuid())
  runId      String
  run        Run      @relation(...)
  nodeId     String   // Client-side React Flow node ID
  nodeType   String
  status     String   // 'SUCCESS', 'FAILED', 'RUNNING'
  inputs     Json?
  outputs    Json?
  error      String?
  durationMs Int?
  createdAt  DateTime @default(now())
}
```

### Entity Relationships

```
User (1) ──< (N) Workflow
User (1) ──< (N) Run
Workflow (1) ──< (N) Run
Run (1) ──< (N) NodeRun
```

---

## 🧪 Sample Workflow: Product Marketing Kit Generator

NextFlow ships with a **pre-built sample workflow** that demonstrates all 6 node types working together with parallel execution and a convergence point.

### Branch A — Image Processing + Product Description
1. **Upload Image Node** → User uploads a product photo
2. **Crop Image Node** → Crops to focus on the product (center 80%)
3. **Text Node #1** (System Prompt) → _"You are a professional marketing copywriter..."_
4. **Text Node #2** (Product Details) → _"Product: Wireless Bluetooth Headphones..."_
5. **LLM Node #1** → Receives system prompt, product details, and cropped image → Generates product description

### Branch B — Video Frame Extraction
1. **Upload Video Node** → User uploads a product demo video
2. **Extract Frame Node** → Extracts frame at 50% of video duration

### Convergence — Final Marketing Summary
- **LLM Node #2** → Waits for **both branches** to complete, receives the product description + both images → Generates a tweet-length marketing post

Load this template from the UI by clicking the **"Load Template"** button in the top toolbar.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘Z` / `Ctrl+Z` | Undo |
| `⌘⇧Z` / `Ctrl+Shift+Z` | Redo |
| `Delete` / `Backspace` | Delete selected node(s) |
| Scroll wheel | Zoom in / out |
| Click + drag (background) | Pan canvas |

---

## 🚢 Deployment

### Vercel (Recommended)

1. **Push** the repository to GitHub
2. **Import** the project on [Vercel](https://vercel.com)
3. **Set environment variables** in the Vercel dashboard:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `DATABASE_URL`
   - `GEMINI_API_KEY`
   - `TRIGGER_SECRET_KEY`
   - `NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY`
   - `TRANSLOADIT_AUTH_SECRET`
4. **Deploy** — the build script (`prisma generate && next build`) runs automatically

### Trigger.dev Production

For production, deploy Trigger.dev tasks:

```bash
npx trigger.dev@latest deploy
```

---

## 📜 Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| **Dev** | `npm run dev` | Start Next.js development server |
| **Build** | `npm run build` | Generate Prisma client + build for production |
| **Start** | `npm run start` | Start production server |
| **Lint** | `npm run lint` | Run ESLint |
| **Postinstall** | `npm run postinstall` | Auto-generate Prisma client after install |

---

## 🤖 MCP Server

NextFlow includes a standalone [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that lets AI assistants (Claude Desktop, Cursor, etc.) manage workflows, trigger executions, and inspect results directly.

### Available Tools

| Tool | Description |
|------|-------------|
| `list_workflows` | List all workflows with pagination |
| `create_workflow` | Create a new empty workflow |
| `execute_workflow` | Queue a workflow for execution |
| `get_execution_status` | Check run status with per-node results |
| `manage_node` | Add, update, or delete nodes in a workflow |

### Running Locally

```bash
# Via npm script
npm run mcp

# Or directly with tsx
npx tsx lib/mcp/server.ts
```

Make sure `DATABASE_URL` is set in your environment (or `.env` file).

### Claude Desktop Configuration

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "nextflow": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/lib/mcp/server.ts"],
      "env": {
        "DATABASE_URL": "your-database-connection-string"
      }
    }
  }
}
```

### Cursor Configuration

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "nextflow": {
      "command": "npx",
      "args": ["tsx", "lib/mcp/server.ts"],
      "env": {
        "DATABASE_URL": "your-database-connection-string"
      }
    }
  }
}
```

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is private and proprietary.

---

<p align="center">
  Built with ❤️ using Next.js, React Flow, Google Gemini, and Trigger.dev
</p>
