// ============================================================================
// src/trigger/orchestrator.ts — Config-Driven DAG Executor
// ============================================================================
//
// This is the core execution engine for NextFlow workflows. It receives a
// serialized DAG (nodes + edges), topologically sorts them into parallel
// execution layers, then dispatches each node using the NodeRegistry —
// completely eliminating hardcoded if/else branching.
//
// EXECUTION MODEL:
//   1. Build a topological sort → produce parallel "layers"
//   2. For each layer, iterate nodes and classify them:
//      a. PASSTHROUGH nodes (text, image, video) → resolve immediately
//         via registry.resolvePassthrough() — no Trigger.dev dispatch
//      b. ASYNC nodes (llm, crop, extract, ...) → resolve their endpoint
//         via registry.resolveEndpoint() → batch dispatch to Trigger.dev
//   3. After each batch completes, map raw provider outputs back to
//      node output keys via registry.mapOutput()
//   4. Store all intermediate results in nodeOutputs for downstream wiring
//   5. Deduct actual credits post-completion via Postgres FOR UPDATE txn
//
// ARCHITECTURAL INVARIANT (MEMORY.md Rule 2):
//   This orchestrator is NODE-TYPE-AGNOSTIC. It never inspects node.type
//   to decide what to do. All dispatch logic lives in the NodeConfig's
//   providers[] array, resolved dynamically by the registry.
//
// CREDIT DEDUCTION:
//   Block-on-estimate at tRPC level (pre-check), deduct-on-completion here.
//   Uses SELECT ... FOR UPDATE to prevent double-spend race conditions.
//   DB failure in credit deduction does NOT crash the orchestrator.
// ============================================================================

import { logger, task, batch, metadata } from "@trigger.dev/sdk/v3";
import { prisma } from "../../lib/db";
import { nodeRegistry } from "../../lib/nodes/registry";
import { deductCredits, settleCredits } from "../../lib/credits/credit-service";

// Ensure all node configs are registered before execution begins.
// This import triggers the side-effect of calling nodeRegistry.registerAll().
import "../../lib/nodes/configs";

// ── DAG Orchestration Task ──────────────────────────────────────────────────

export const orchestrateWorkflow = task({
  machine: {
    preset: "large-2x",
  },
  id: "orchestrate-workflow",
  queue: {
    name: "workflow-execution",
    concurrencyLimit: 20, // Max 20 orchestrators running globally at once
  },
  retry: {
    maxAttempts: 1, // DO NOT RETRY THE ORCHESTRATOR. Let individual nodes retry.
  },
  run: async (payload: {
    runId: string;
    userId: string;
    nodes: any[];
    edges: any[];
    startTime?: number;
    inputValues?: Record<string, unknown>;
    reservedCredits?: number;
    webhookUrl?: string;
  }) => {
    logger.info("Orchestrating Workflow DAG", { runId: payload.runId });

    const { runId, userId, nodes, edges } = payload;
    const executionStart = payload.startTime || Date.now();

    // ── Step 0: Inject Parameterized Input Overrides ────────────────────
    // If the caller provided inputValues (label→value map), merge them into
    // matching nodes' data BEFORE execution begins.
    //
    // TWO RESOLUTION MODES:
    //   1. Passthrough: key = nodeLabel → override the first passthroughMapping dataKey
    //   2. Explicit:    key = nodeLabel.inputKey → override that specific data field
    //
    // Resolution is by node.data.label, NOT nodeId — stable across copies.
    // The nodes array is a deserialized copy — mutations here only affect
    // this execution's in-memory representation. The workflow template is
    // untouched in the database.
    if (payload.inputValues && Object.keys(payload.inputValues).length > 0) {
      // Track which override labels resolved to which node IDs
      // to detect multi-match corruption
      const labelMatchTracker = new Map<string, string[]>();

      for (const node of nodes) {
        if (!node.type) continue;
        const config = nodeRegistry.get(node.type);
        if (!config) continue;

        const nodeLabel = (node.data?.label as string) || node.type;

        // ── Mode 1: Passthrough label-match (backward compatible) ──────
        if (config.isPassthrough && config.passthroughMapping) {
          if (nodeLabel in payload.inputValues) {
            // Track this label→nodeId mapping
            if (!labelMatchTracker.has(nodeLabel)) {
              labelMatchTracker.set(nodeLabel, []);
            }
            labelMatchTracker.get(nodeLabel)!.push(node.id);

            const overrideValue = payload.inputValues[nodeLabel];
            const dataKeys = Object.keys(config.passthroughMapping);
            if (dataKeys.length > 0) {
              node.data[dataKeys[0]] = overrideValue;
              logger.info("Applied passthrough input override", {
                nodeId: node.id,
                label: nodeLabel,
                dataKey: dataKeys[0],
              });
            }
          }
        }

        // ── Mode 2: Explicit compound label "nodeLabel.inputKey" ────────
        // Scans all inputValues for keys matching this node's label prefix.
        const labelPrefix = `${nodeLabel}.`;
        for (const [overrideKey, overrideValue] of Object.entries(payload.inputValues)) {
          if (!overrideKey.startsWith(labelPrefix)) continue;
          const inputKey = overrideKey.slice(labelPrefix.length);
          if (!inputKey) continue;

          // Verify this input key exists in the node's config
          const inputDef = config.inputs?.find((inp) => inp.key === inputKey);
          if (!inputDef) {
            logger.warn("Skipping override for unknown input key", {
              nodeId: node.id,
              label: nodeLabel,
              inputKey,
            });
            continue;
          }

          node.data[inputKey] = overrideValue;
          logger.info("Applied explicit input override", {
            nodeId: node.id,
            label: nodeLabel,
            inputKey,
          });
        }
      }

      // ── Warn on multi-match labels (data corruption indicator) ────────
      for (const [label, matchedNodeIds] of labelMatchTracker) {
        if (matchedNodeIds.length > 1) {
          logger.warn("⚠️ DUPLICATE LABEL DETECTED — override applied to multiple nodes", {
            label,
            matchedNodeIds,
            nodeCount: matchedNodeIds.length,
            hint: "This means the same value was injected into ALL these nodes. " +
                  "Assign unique labels to prevent silent data corruption.",
          });
        }
      }
    }


    // Realtime metadata — streamed to the client via useRealtimeRun.
    // Kept in local maps and flushed to Trigger.dev metadata on every transition.
    const rtStatuses: Record<string, string> = {};
    const rtOutputs: Record<string, Record<string, unknown>> = {};

    function emitNodeStatus(
      nodeId: string,
      status: string,
      outputs?: Record<string, unknown>
    ) {
      rtStatuses[nodeId] = status;
      metadata.set("nodeStatuses", JSON.parse(JSON.stringify(rtStatuses)));
      if (outputs) {
        rtOutputs[nodeId] = outputs;
        metadata.set("nodeOutputs", JSON.parse(JSON.stringify(rtOutputs)));
      }
    }

    // ── Step 1: Topological Sort ──────────────────────────────────────────
    // Build adjacency list + in-degree map for Kahn's algorithm.
    // Produces execution "layers" where all nodes in a layer can run in
    // parallel because their upstream dependencies have already resolved.

    const adjList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const n of nodes) {
      adjList.set(n.id, []);
      inDegree.set(n.id, 0);
    }

    for (const e of edges) {
      adjList.get(e.source)?.push(e.target);
      if (inDegree.has(e.target)) {
        inDegree.set(e.target, inDegree.get(e.target)! + 1);
      }
    }

    // Seed the queue with root nodes (in-degree 0)
    let queue: string[] = [];
    inDegree.forEach((degree, nodeId) => {
      if (degree === 0) queue.push(nodeId);
    });

    // BFS to produce parallel execution layers
    const layers: string[][] = [];
    while (queue.length > 0) {
      const nextQueue: string[] = [];
      const currentLayer: string[] = [];

      for (const nodeId of queue) {
        currentLayer.push(nodeId);
        for (const neighbor of adjList.get(nodeId) || []) {
          inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
          if (inDegree.get(neighbor) === 0) nextQueue.push(neighbor);
        }
      }

      layers.push(currentLayer);
      queue = nextQueue;
    }

    // Cycle detection — if we didn't process all nodes, there's a cycle
    if (layers.flat().length !== nodes.length) {
      logger.error("Cycle detected in DAG", {
        processed: layers.flat().length,
        total: nodes.length,
      });
      await updateRunStatus(runId, "FAILED", Date.now() - executionStart);
      return;
    }

    logger.info("DAG layers calculated", { layerCount: layers.length, layers });

    // Credit pre-check happens in the tRPC layer (estimateWorkflowCost + getBalance).
    // Actual deduction happens post-completion inside the batch result loop below.

    // ── Step 2: Layer-by-Layer Execution ───────────────────────────────────
    // nodeOutputs accumulates the resolved output of every executed node.
    // Downstream nodes read their inputs from this map via edge wiring.

    const nodeOutputs = new Map<string, Record<string, unknown>>();

    try {
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        logger.info(`Executing layer ${i + 1}/${layers.length}`, { nodes: layer });

        // Collect batch items for async (non-passthrough) nodes in this layer
        const batchItems: { id: string; payload: Record<string, unknown> }[] = [];
        // Track metadata per-node for timing, result mapping, and credit deduction
        const layerMeta: Record<string, {
          nodeStart: number;
          finalInputs: Record<string, unknown>;
          endpointId: string | null;
          providerId: string | null;
        }> = {};
        // Track which nodeIds correspond to batch items (ordered)
        const asyncNodeIds: string[] = [];

        for (const nodeId of layer) {
          const nodeStart = Date.now();
          const node = nodes.find((n: any) => n.id === nodeId);
          if (!node) continue;

          // ── Wire upstream outputs into this node's inputs ──────────────
          // For each incoming edge, pull the relevant output field from the
          // source node's resolved outputs and assign it to the target handle.
          const incomingEdges = edges.filter((e: any) => e.target === nodeId);
          const inputs: Record<string, unknown> = {};

          for (const edge of incomingEdges) {
            const sourceOutput = nodeOutputs.get(edge.source);
            if (!sourceOutput || !edge.targetHandle) continue;

            // ── Resolve the value from the source node's outputs ──────────
            // The sourceHandle should match a key in sourceOutput. However,
            // legacy edges may reference old handle IDs (e.g., "output") that
            // no longer match the config-driven output keys (e.g., "text").
            //
            // Lookup chain:
            //   1. Exact match: sourceOutput[edge.sourceHandle]
            //   2. Single-output fallback: if the source has only one output
            //      key and the handle didn't match, use that single value
            //      (covers legacy "output" → config "text" migration)
            let value: unknown;
            if (edge.sourceHandle && edge.sourceHandle in sourceOutput) {
              // Direct match — config handle IDs align
              value = sourceOutput[edge.sourceHandle];
            } else {
              // Fallback — the source node likely has only one output.
              // Use its first (and only) value regardless of key name.
              const outputKeys = Object.keys(sourceOutput);
              if (outputKeys.length > 0) {
                value = sourceOutput[outputKeys[0]];
                logger.info(`Edge fallback: "${edge.sourceHandle}" not in source outputs [${outputKeys}], using "${outputKeys[0]}"`, {
                  edgeId: edge.id,
                  source: edge.source,
                  target: edge.target,
                });
              }
            }

            // Skip if we couldn't resolve any value
            if (value === undefined) continue;

            // Multi-value inputs (e.g., "images") aggregate into arrays
            const targetConfig = nodeRegistry.get(node.type);
            const targetInput = targetConfig?.inputs.find(
              (inp) => inp.key === edge.targetHandle
            );

            if (targetInput?.multi) {
              // Track values by source node ID for reordering support
              const orderKey = `_multiSources_${edge.targetHandle}`;
              if (!inputs[orderKey]) {
                inputs[orderKey] = [] as Array<{ sourceId: string; value: unknown }>;
              }
              (inputs[orderKey] as Array<{ sourceId: string; value: unknown }>).push({
                sourceId: edge.source,
                value,
              });
            } else {
              inputs[edge.targetHandle] = value;
            }
          }

          // ── Reorder multi-inputs using _inputOrder ──────────────────────
          // The UI stores node.data._inputOrder[handleKey] as an ordered array
          // of source node IDs. Use that order when building the final arrays.
          const inputOrder = (node.data?._inputOrder as Record<string, string[]>) || {};

          for (const key of Object.keys(inputs)) {
            if (!key.startsWith("_multiSources_")) continue;
            const handleKey = key.replace("_multiSources_", "");
            const tracked = inputs[key] as Array<{ sourceId: string; value: unknown }>;
            const savedOrder = inputOrder[handleKey];

            let orderedValues: unknown[];
            if (savedOrder && savedOrder.length > 0) {
              // Reorder tracked values according to savedOrder
              const bySource = new Map<string, unknown>();
              for (const entry of tracked) {
                bySource.set(entry.sourceId, entry.value);
              }
              orderedValues = [];
              // First: values in the saved order
              for (const sourceId of savedOrder) {
                if (bySource.has(sourceId)) {
                  orderedValues.push(bySource.get(sourceId));
                  bySource.delete(sourceId);
                }
              }
              // Then: any remaining values not in the saved order (newly added)
              for (const remaining of bySource.values()) {
                orderedValues.push(remaining);
              }
            } else {
              // No saved order — use edge iteration order (original behavior)
              orderedValues = tracked.map((t) => t.value);
            }

            inputs[handleKey] = orderedValues;
            delete inputs[key]; // Clean up tracking key
          }

          // Merge node.data (user-entered values) with wired upstream values.
          // Upstream connections take precedence over static data.
          const finalInputs: Record<string, unknown> = { ...node.data, ...inputs };

          // Sanitize any array inputs to remove undefined/null/empty strings.
          // This prevents PrismaClientValidationError when empty connection
          // ports inject undefined values into array fields (like 'images').
          for (const key of Object.keys(finalInputs)) {
            if (Array.isArray(finalInputs[key])) {
              finalInputs[key] = (finalInputs[key] as any[]).filter(
                (val) => val !== undefined && val !== null && val !== ""
              );
            }
          }

          // Strip internal UI metadata (e.g., _inputOrder) from task payloads
          for (const key of Object.keys(finalInputs)) {
            if (key.startsWith("_")) {
              delete finalInputs[key];
            }
          }

          logger.info(`Processing node ${node.type} (${nodeId})`, { finalInputs });

          // ── Runtime Zod Validation of Merged Inputs ─────────────────────
          // The full payload (static + upstream) is now assembled. Validate
          // against the complete schema — at this point, all required fields
          // should be present. If upstream hallucinated bad data or a source
          // node failed, this catches it. Marks the node FAILED without
          // crashing the batch (MEMORY.md: single-node failure → PARTIAL).
          if (node.type && nodeRegistry.has(node.type)) {
            const inputSchema = nodeRegistry.getInputSchema(node.type);
            const parseResult = inputSchema.safeParse(finalInputs);
            if (!parseResult.success) {
              const issues = parseResult.error.issues
                .map((iss: any) => `${iss.path.join(".")}: ${iss.message}`)
                .join("; ");
              const errMsg = `Input validation failed: ${issues}`;
              logger.warn(`Node ${nodeId} failed runtime input validation`, {
                nodeType: node.type,
                issues: parseResult.error.issues,
              });
              await updateNodeRun(
                runId, nodeId, "FAILED",
                finalInputs, null, errMsg,
                Date.now() - nodeStart
              );
              emitNodeStatus(nodeId, "FAILED");
              continue;
            }

            // Strictly isolate inputs by reassigning to the Zod-stripped validated object.
            // This prevents outputs (e.g. `result`, `result_text`) from `node.data`
            // from leaking into task payloads.
            //
            // IMPORTANT: Only strip for non-passthrough nodes. Passthrough nodes
            // store their data in node.data fields (e.g. `url`) that are NOT in
            // the input schema — stripping would destroy them.
            const config = nodeRegistry.get(node.type);
            if (!config?.isPassthrough) {
              for (const key of Object.keys(finalInputs)) {
                delete finalInputs[key];
              }
              Object.assign(finalInputs, parseResult.data);
            }

            // ── Dynamic Element Handle Assembly ────────────────────────────
            // For nodes with allowDynamicHandles that have element_N_frontal /
            // element_N_ref_M keys (e.g., Kling O1), reassemble them into the
            // structured elements[] array expected by the task.
            // This runs after Zod validation (.passthrough() preserves dynamic
            // keys) and before endpoint resolution maps inputs to the payload.
            if (config?.allowDynamicHandles) {
              const elementMap = new Map<number, {
                frontal_image_url: string;
                reference_image_urls: string[];
              }>();

              for (const key of Object.keys(finalInputs)) {
                // Match element_N_frontal
                const frontalMatch = key.match(/^element_(\d+)_frontal$/);
                if (frontalMatch) {
                  const idx = parseInt(frontalMatch[1], 10);
                  if (!elementMap.has(idx)) {
                    elementMap.set(idx, { frontal_image_url: "", reference_image_urls: [] });
                  }
                  const val = finalInputs[key];
                  if (typeof val === "string" && val.length > 0) {
                    elementMap.get(idx)!.frontal_image_url = val;
                  }
                  delete finalInputs[key];
                  continue;
                }

                // Match element_N_ref_M
                const refMatch = key.match(/^element_(\d+)_ref_(\d+)$/);
                if (refMatch) {
                  const idx = parseInt(refMatch[1], 10);
                  const refIdx = parseInt(refMatch[2], 10);
                  if (!elementMap.has(idx)) {
                    elementMap.set(idx, { frontal_image_url: "", reference_image_urls: [] });
                  }
                  const val = finalInputs[key];
                  if (typeof val === "string" && val.length > 0) {
                    const refs = elementMap.get(idx)!.reference_image_urls;
                    // Ensure the array is large enough
                    while (refs.length <= refIdx) refs.push("");
                    refs[refIdx] = val;
                  }
                  delete finalInputs[key];
                  continue;
                }
              }

              // If we found any dynamic element keys, build the elements array
              if (elementMap.size > 0) {
                const sortedIndices = Array.from(elementMap.keys()).sort((a, b) => a - b);
                const assembledElements = sortedIndices.map((idx) => {
                  const el = elementMap.get(idx)!;
                  // Filter out empty reference URLs
                  el.reference_image_urls = el.reference_image_urls.filter((u) => u.length > 0);
                  return el;
                });

                // Merge with existing elements array (from manual UI input) if present
                const existingElements = finalInputs.elements;
                if (Array.isArray(existingElements) && existingElements.length > 0) {
                  // Dynamic handle values override matching indices, append new ones
                  for (let i = 0; i < assembledElements.length; i++) {
                    const assembled = assembledElements[i];
                    if (i < existingElements.length) {
                      // Override only if dynamic handle had a value
                      if (assembled.frontal_image_url) {
                        existingElements[i].frontal_image_url = assembled.frontal_image_url;
                      }
                      if (assembled.reference_image_urls.length > 0) {
                        // Merge references: override matching indices
                        for (let r = 0; r < assembled.reference_image_urls.length; r++) {
                          if (assembled.reference_image_urls[r]) {
                            existingElements[i].reference_image_urls[r] =
                              assembled.reference_image_urls[r];
                          }
                        }
                      }
                    } else {
                      existingElements.push(assembled);
                    }
                  }
                  finalInputs.elements = existingElements;
                } else {
                  finalInputs.elements = assembledElements;
                }

                logger.info("Assembled dynamic element handles into elements[]", {
                  nodeId,
                  elementCount: (finalInputs.elements as unknown[]).length,
                });
              }
            }
          }

          await updateNodeRun(runId, nodeId, "RUNNING", finalInputs, null, null);
          emitNodeStatus(nodeId, "RUNNING");

          // ── Classify: Passthrough vs Async ──────────────────────────────
          // The registry decides — we never inspect node.type ourselves.

          const passthroughOutput = nodeRegistry.resolvePassthrough(
            node.type,
            finalInputs
          );

          if (passthroughOutput !== null) {
            nodeOutputs.set(nodeId, passthroughOutput);
            await updateNodeRun(
              runId, nodeId, "SUCCESS",
              finalInputs, passthroughOutput, null,
              Date.now() - nodeStart
            );
            emitNodeStatus(nodeId, "SUCCESS", passthroughOutput);
            layerMeta[nodeId] = { nodeStart, finalInputs, endpointId: null, providerId: null };
            continue;
          }

          // ASYNC: resolve the provider endpoint from the registry
          const resolved = nodeRegistry.resolveEndpoint(node.type, finalInputs);

          if (!resolved) {
            const errMsg = `No endpoint resolved for node type "${node.type}"`;
            logger.warn(errMsg, { nodeId });
            await updateNodeRun(
              runId, nodeId, "FAILED",
              finalInputs, null, errMsg,
              Date.now() - nodeStart
            );
            emitNodeStatus(nodeId, "FAILED");
            continue;
          }

          // Queue for batch dispatch
          batchItems.push({ id: resolved.taskId, payload: resolved.payload });
          asyncNodeIds.push(nodeId);
          layerMeta[nodeId] = {
            nodeStart,
            finalInputs,
            endpointId: resolved.endpointId,
            providerId: resolved.providerId,
          };
        }

        // ── Batch Dispatch ────────────────────────────────────────────────
        // All async nodes in this layer fire in parallel via Trigger.dev's
        // batch.triggerAndWait. Results come back in the same order.

        if (batchItems.length > 0) {
          logger.info(
            `Dispatching ${batchItems.length} async tasks in layer ${i + 1}...`
          );

          try {
            const batchResult = await batch.triggerAndWait<any>(batchItems);

            for (let j = 0; j < asyncNodeIds.length; j++) {
              const nodeId = asyncNodeIds[j];
              const result = batchResult.runs[j];
              const { nodeStart, finalInputs, endpointId, providerId } = layerMeta[nodeId];
              const node = nodes.find((n: any) => n.id === nodeId);

              if (result.ok) {
                // Map raw provider output → node output keys via registry
                const rawOutput = result.output as Record<string, unknown>;
                const mappedOutput = node?.type && endpointId
                  ? nodeRegistry.mapOutput(node.type, endpointId, rawOutput)
                  : rawOutput;

                nodeOutputs.set(nodeId, mappedOutput);

                // ── Credit Deduction (post-completion) ─────────────────
                // Calculate actual cost from the provider response and write
                // a single negative ledger entry for this node.
                let creditsUsed = 0;
                if (node?.type) {
                  try {
                    creditsUsed = nodeRegistry.calculateCredits(
                      node.type,
                      finalInputs,
                      rawOutput
                    );

                    const nodeRun = await prisma.nodeRun.findFirst({
                      where: { runId, nodeId },
                      select: { id: true },
                    });
                    if (nodeRun && creditsUsed > 0) {
                      await deductCredits(
                        userId,
                        runId,
                        nodeRun.id,
                        creditsUsed,
                        node.type
                      );
                    }
                    logger.info("Credits deducted", {
                      nodeId,
                      nodeType: node.type,
                      creditsUsed,
                    });
                  } catch (creditErr: any) {
                    logger.error("Credit deduction failed (non-fatal)", {
                      nodeId,
                      nodeType: node.type,
                      error: creditErr.message,
                    });
                  }
                }

                await updateNodeRun(
                  runId, nodeId, "SUCCESS",
                  finalInputs, mappedOutput, null,
                  Date.now() - nodeStart,
                  providerId ?? undefined,
                  creditsUsed
                );
                emitNodeStatus(nodeId, "SUCCESS", mappedOutput);
              } else {
                // ── Non-fatal node failure ──────────────────────────────
                // Mark this node FAILED but do NOT throw — downstream nodes
                // that depend on it will simply receive no input and fail
                // or skip gracefully. The orchestrator continues executing
                // independent branches so we get PARTIAL instead of FAILED.
                const errMsg = `Task failed: ${
                  (result.error as any)?.message || "Unknown error"
                }`;
                logger.error(`Node ${nodeId} failed (non-fatal)`, { error: result.error });
                await updateNodeRun(
                  runId, nodeId, "FAILED",
                  finalInputs, null, errMsg,
                  Date.now() - nodeStart,
                  providerId ?? undefined
                );
                emitNodeStatus(nodeId, "FAILED");
              }
            }
          } catch (batchError: any) {
            // Only reaches here if batch.triggerAndWait itself crashes
            // (network failure, Trigger.dev infra issue). Mark all nodes
            // in this batch as FAILED individually.
            logger.error(`Batch infrastructure error in layer ${i + 1}`, {
              error: batchError.message,
            });
            for (const nodeId of asyncNodeIds) {
              const { nodeStart, finalInputs } = layerMeta[nodeId];
              await updateNodeRun(
                runId, nodeId, "FAILED",
                finalInputs, null,
                `Batch dispatch failed: ${batchError.message}`,
                Date.now() - nodeStart
              );
              emitNodeStatus(nodeId, "FAILED");
            }
          }
        }

        logger.info(`Layer ${i + 1} complete`);
      }

      const nodeRuns = await prisma.nodeRun.findMany({
        where: { runId },
        select: { status: true },
      });

      const hasFailed = nodeRuns.some((nr) => nr.status === "FAILED");
      const hasSuccess = nodeRuns.some((nr) => nr.status === "SUCCESS");

      let finalStatus = "SUCCESS";
      if (hasFailed) {
        finalStatus = hasSuccess ? "PARTIAL" : "FAILED";
      }

      logger.info(`Workflow completed with status: ${finalStatus}`);
      await updateRunStatus(runId, finalStatus, Date.now() - executionStart);
      metadata.set("runStatus", finalStatus);

      // ── Credit Settlement ───────────────────────────────────────────
      // Refund the difference between reserved and actually spent credits.
      if (payload.reservedCredits && payload.reservedCredits > 0) {
        try {
          const actualNodeRuns = await prisma.nodeRun.findMany({
            where: { runId },
            select: { creditsUsed: true },
          });
          const actualTotal = actualNodeRuns.reduce(
            (sum, nr) => sum + (nr.creditsUsed ?? 0),
            0,
          );
          const { refunded } = await settleCredits(
            userId,
            runId,
            payload.reservedCredits,
            actualTotal,
          );
          if (refunded > 0) {
            logger.info("Credits settled — refund issued", {
              reserved: payload.reservedCredits,
              actual: actualTotal,
              refunded,
            });
          }
        } catch (settleErr: any) {
          logger.error("Credit settlement failed (non-fatal)", {
            error: settleErr.message,
          });
        }
      }

      // ── Webhook Notification ──────────────────────────────────────────
      if (payload.webhookUrl) {
        try {
          await fetch(payload.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: finalStatus === "SUCCESS" ? "run.completed" : "run.failed",
              runId,
              status: finalStatus,
            }),
          });
          logger.info("Webhook notification sent", { url: payload.webhookUrl });
        } catch (webhookErr: any) {
          logger.error("Failed to send webhook notification", { error: webhookErr.message });
        }
      }
    } catch (err: any) {
      logger.error("Workflow failed during execution", { error: err.message });

      const nodeRuns = await prisma.nodeRun.findMany({
        where: { runId },
        select: { status: true, creditsUsed: true },
      });
      const hasSuccess = nodeRuns.some((nr) => nr.status === "SUCCESS");
      const finalStatus = hasSuccess ? "PARTIAL" : "FAILED";
      await updateRunStatus(runId, finalStatus, Date.now() - executionStart);
      metadata.set("runStatus", finalStatus);

      // ── Credit Settlement on failure ─────────────────────────────────
      if (payload.reservedCredits && payload.reservedCredits > 0) {
        try {
          const actualTotal = nodeRuns.reduce(
            (sum, nr) => sum + (nr.creditsUsed ?? 0),
            0,
          );
          await settleCredits(userId, runId, payload.reservedCredits, actualTotal);
          logger.info("Credits settled on failure", {
            reserved: payload.reservedCredits,
            actual: actualTotal,
          });
        } catch (settleErr: any) {
          logger.error("Credit settlement on failure failed (non-fatal)", {
            error: settleErr.message,
          });
        }
      }

      // ── Webhook Notification on failure ───────────────────────────────
      if (payload.webhookUrl) {
        try {
          await fetch(payload.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "run.failed",
              runId,
              status: finalStatus,
              error: err.message,
            }),
          });
          logger.info("Webhook notification sent on failure", { url: payload.webhookUrl });
        } catch (webhookErr: any) {
          logger.error("Failed to send webhook notification on failure", { error: webhookErr.message });
        }
      }

      throw err;
    }
  },
});

// ── Database Helpers ────────────────────────────────────────────────────────

async function updateRunStatus(
  runId: string,
  status: string,
  durationMs?: number
) {
  const isTerminal = ["SUCCESS", "FAILED", "PARTIAL"].includes(status);
  await prisma.run.update({
    where: { id: runId },
    data: {
      status,
      ...(durationMs !== undefined && { durationMs }),
      ...(isTerminal && { completedAt: new Date() }),
    },
  });
}

// ── Prisma-safe deep sanitizer ──────────────────────────────────────────────
// Recursively strips `undefined` values from objects and arrays before they
// reach Prisma. This prevents PrismaClientValidationError when unconnected
// multi-input handles inject undefined into arrays (e.g., images: [undefined]).
function sanitizeForPrisma(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => sanitizeForPrisma(item));
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) {
      result[k] = sanitizeForPrisma(v);
    }
  }
  return result;
}

async function updateNodeRun(
  runId: string,
  nodeId: string,
  status: string,
  inputs: any,
  outputs: any,
  error: string | null,
  durationMs?: number,
  providerUsed?: string,
  creditsUsed?: number
) {
  const nodeRun = await prisma.nodeRun.findFirst({
    where: { runId, nodeId },
  });

  if (nodeRun) {
    await prisma.nodeRun.update({
      where: { id: nodeRun.id },
      data: {
        status,
        inputs: sanitizeForPrisma(inputs) as any,
        outputs: sanitizeForPrisma(outputs) as any,
        ...(error && { error }),
        ...(durationMs !== undefined && { durationMs }),
        ...(providerUsed !== undefined && { providerUsed }),
        ...(creditsUsed !== undefined && { creditsUsed }),
      },
    });
  }
}

// Credit deduction handled by lib/credits/credit-service.ts → deductCredits()
