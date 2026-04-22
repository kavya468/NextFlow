# NextFlow — Post-Delivery Improvement Progress

> **Goal**: Demonstrate significant improvement in MCP design, API quality, and user-centric thinking.
> **Core feedback**: "Not thinking from the user's perspective."

---

## Guiding Principle

Every change below is evaluated against one question:
**"If I were a user (or an LLM acting on behalf of a user), would this make sense to me without reading the source code?"**

---

## Priority 1: MCP Server — User-Centric Redesign

The MCP server is where the feedback hit hardest. The tools work technically, but they were built as a thin DB wrapper, not as a UX layer.

### What was wrong (before)
- Tools require internal UUIDs that no human would know
- Tool descriptions mention Clerk, Trigger.dev, Run records — implementation details that confuse LLMs
- No resources layer — LLMs can't discover what's available
- Error messages say what failed but not what to do next
- `manage_node` overloads add/update/delete into one tool with conditional params

### What we're fixing

| # | Change | User Impact | Status |
|---|--------|-------------|--------|
| 1 | Accept workflow **names** instead of UUIDs | Users say "run my video pipeline", not "run a1b2c3d4" | |
| 2 | Auto-resolve userId from session/env | Users never asked for Clerk IDs | |
| 3 | Rewrite tool descriptions for LLM consumption | LLMs stop hallucinating parameter values | |
| 4 | Add MCP resources (node types, workflow list) | LLMs can discover what's available before acting | |
| 5 | Add recovery hints to error messages | LLMs self-correct instead of looping | |
| 6 | Split manage_node into add/update/delete tools | Clear params per tool, no conditional logic | |

---

## Priority 2: API Hardening

| # | Change | User Impact | Status |
|---|--------|-------------|--------|
| 7 | Credit error: 402 instead of 403 | Correct HTTP semantics | |
| 8 | Idempotency keys on execute endpoint | Safe retries, no double charges | |
| 9 | Upload route: add auth + rate limiting | Can't be abused by anonymous users | |
| 10 | Sequential NodeRun inserts → createMany | Faster execution start | |

---

## Priority 3: Architecture

| # | Change | User Impact | Status |
|---|--------|-------------|--------|
| 11 | Shared service layer (tRPC + MCP use same functions) | Consistent behavior regardless of entry point | |
| 12 | Machine sizing (webhook tasks → micro/small) | Cost savings, no user-visible change | |
| 13 | Eliminate `any` types on critical paths | Type safety catches bugs before users see them | |

---

## Session Log

### Session 1 — 2026-04-19
- Read full audit (nextflow_audit.md, phase1/2/3 docs, Parameterized.md, task.md)
- Established progress tracking in PROGRESS.md
- Identified MCP user-centric redesign as highest priority
- **Next**: Start with MCP tool descriptions + name-based workflow resolution
