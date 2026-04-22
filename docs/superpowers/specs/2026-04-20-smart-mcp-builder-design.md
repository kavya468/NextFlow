# Smart Builder MCP Suite Design Spec

## Overview
The "Smart Builder" MCP Suite bridges the gap between raw backend graph management and LLM agent UX. It allows AI agents to effortlessly discover, simulate, and generate complex Directed Acyclic Graphs (DAGs) in a single shot without hallucinating IDs, coordinates, or connection details.

## Problem Statement
Currently, agents struggle to build workflows because they must read source code to find node types, guess X/Y coordinates, and make sequential API calls to add edges. Furthermore, they lack insight into credit costs and validation rules until an error occurs.

## System Architecture

The solution involves three new active MCP tools backed by a shared `lib/services/mcp-builder-service.ts`.

### 1. `mcp_nextflow_list_node_types` (Discovery)
Converts the passive node registry into an active tool.
- **Input:** `{ category?: string }`
- **Output:** An array of node definitions, including their exact `nodeType`, `credits` cost, `config` schema, and required `inputs/outputs`.
- **Why:** Solves the hallucination problem. The agent knows exactly what building blocks are available (e.g., it sees `kling`, `elevenlabs`, `mergeVideos` rather than guessing).

### 2. `mcp_nextflow_simulate_workflow` (Validation & Cost)
A "dry-run" engine that accepts a proposed workflow schema and returns a pre-flight report.
- **Input:** `{ nodes: [...], edges: [...] }`
- **Backend Logic:**
  1. Validates the DAG for cycles (Infinite loop prevention).
  2. Calculates the estimated total credit cost.
  3. Checks for missing required inputs in the node configs.
- **Output:** `{ valid: boolean, estimatedCredits: number, errors: string[], warnings: string[] }`
- **Why:** Allows the agent to test a workflow before saving it, ensuring zero-error deployment and proactive cost warnings for the user.

### 3. `mcp_nextflow_scaffold_workflow` (One-Shot Auto-Wiring)
A single endpoint to deploy a complete, validated workflow.
- **Input:**
  ```json
  {
    "name": "My New Workflow",
    "nodes": [
      { "id": "n1", "type": "elevenlabs", "config": {...} },
      { "id": "n2", "type": "sync_lipsync", "config": {...} }
    ],
    "edges": [
      { "sourceId": "n1", "targetId": "n2" } // Notice: No handle specifications!
    ]
  }
  ```
- **Backend Logic (The "Smart" Compiler):**
  - **Auto-Wiring:** If the agent omits `sourceHandle` or `targetHandle`, the backend queries the registry for the node types and automatically connects the first compatible input/output types (e.g., wiring an `audio` output to an `audio` input). If ambiguous, it throws a clear validation error.
  - **Auto-Layout:** The backend applies a lightweight positioning algorithm (e.g., `X = index * 350`, `Y = 100`) to layout the nodes beautifully on the canvas, removing the need for the LLM to do spatial math.
- **Output:** The created `workflowId` and success message.

## Edge Case Handling (Addressed from Brainstorming)
- **Limited Arsenal:** Since we only have ~16 nodes (mostly Media/AI), the agent's "Interactive Proposer" behavior will rely heavily on `list_node_types` to suggest architectural paths (e.g., "Do you want Lipsync or just Audio merging?") rather than model variations (e.g., Claude vs GPT4).
- **DAG Violations:** By validating the graph in memory during the `scaffold` or `simulate` phase, we catch cycles *before* any database mutations occur.

## Next Steps
Transition to `writing-plans` to implement the `mcp-builder-service.ts` and the MCP tool registrations in `app/api/mcp/route.ts`.
