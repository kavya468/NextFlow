import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { finalizeRun, getBalance, recordNodeResult, reserveCredits } from "@/lib/credits/credit-service";
import { InsufficientCreditsError, OwnershipError } from "@/lib/services/errors";

const users: string[] = [];
const fixturePrefix = `credit-test-${randomUUID()}`;

function assertTestDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? "http://missing.invalid");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/nextflow_test") {
    throw new Error("Credit integration tests require a local nextflow_test database");
  }
}

beforeAll(assertTestDatabase);
afterAll(async () => {
  assertTestDatabase();
  if (users.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.creditLedger.deleteMany({ where: { userId: { in: users } } });
    await tx.run.deleteMany({ where: { userId: { in: users } } });
    await tx.workflow.deleteMany({ where: { userId: { in: users } } });
    await tx.user.deleteMany({ where: { id: { in: users } } });
  });
  await prisma.$disconnect();
});

async function fixture(balance = 1_000, accountingVersion = 1) {
  const userId = `${fixturePrefix}-${users.length}`;
  users.push(userId);
  return prisma.$transaction(async (tx) => {
    await tx.user.create({ data: { id: userId } });
    const workflow = await tx.workflow.create({ data: { userId, name: "Credit test", nodes: [], edges: [] } });
    if (balance > 0) await tx.creditLedger.create({ data: { userId, delta: balance, reason: "test:grant" } });
    const run = await tx.run.create({ data: { userId, workflowId: workflow.id, scope: "FULL", status: "PENDING", accountingVersion } });
    const node = await tx.nodeRun.create({ data: { runId: run.id, nodeId: "node-1", nodeType: "test", status: "PENDING" } });
    return { userId, run, node };
  });
}

async function completeNode(f: Awaited<ReturnType<typeof fixture>>, creditsUsed = 80) {
  return recordNodeResult(f.userId, f.run.id, f.node.nodeId, {
    inputs: { text: "input" }, outputs: { text: "output" }, creditsUsed, providerUsed: "test", durationMs: 10,
  });
}

describe.sequential("PostgreSQL credit accounting", () => {
  it("reserves once, records usage without another debit, and settles 1000 / 100 / 80 to 920", async () => {
    const f = await fixture();
    await expect(reserveCredits(f.userId, f.run.id, 100)).resolves.toEqual({ reserved: 100, remainingBalance: 900 });
    await completeNode(f);
    expect(await getBalance(f.userId)).toBe(900);
    await expect(finalizeRun(f.userId, f.run.id, "SUCCESS", { durationMs: 20 })).resolves.toMatchObject({ charged: 80, refunded: 20, settled: true });
    expect(await getBalance(f.userId)).toBe(920);
    const run = await prisma.run.findUniqueOrThrow({ where: { id: f.run.id } });
    expect(run).toMatchObject({ status: "SUCCESS", reservedCredits: 100, chargedCredits: 80, durationMs: 20 });
    expect(run.completedAt).toEqual(run.settledAt);
    expect(await prisma.creditLedger.count({ where: { workflowRunId: f.run.id } })).toBe(2);
  });

  it("serializes concurrent reservations so two runs cannot spend the same credits", async () => {
    const f = await fixture(100);
    const other = await prisma.run.create({ data: { userId: f.userId, workflowId: f.run.workflowId, scope: "FULL", status: "PENDING", accountingVersion: 1 } });
    const results = await Promise.allSettled([
      reserveCredits(f.userId, f.run.id, 80), reserveCredits(f.userId, other.id, 80),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: expect.any(InsufficientCreditsError) });
    expect(await getBalance(f.userId)).toBe(20);
  });

  it("makes concurrent duplicate reservations idempotent and rejects a different retry amount", async () => {
    const f = await fixture();
    await Promise.all([reserveCredits(f.userId, f.run.id, 100), reserveCredits(f.userId, f.run.id, 100)]);
    await expect(reserveCredits(f.userId, f.run.id, 101)).rejects.toThrow("different reservation");
    expect(await getBalance(f.userId)).toBe(900);
    expect(await prisma.creditLedger.count({ where: { operationKey: `run:${f.run.id}:reserve` } })).toBe(1);
  });

  it("settles only once under simultaneous completion and repeated cancellation", async () => {
    const f = await fixture();
    await reserveCredits(f.userId, f.run.id, 100);
    await completeNode(f);
    const results = await Promise.all([
      finalizeRun(f.userId, f.run.id, "SUCCESS"), finalizeRun(f.userId, f.run.id, "SUCCESS"),
    ]);
    expect(results.filter((result) => result.settled)).toHaveLength(1);
    await expect(finalizeRun(f.userId, f.run.id, "CANCELLED")).resolves.toMatchObject({ status: "SUCCESS", settled: false });
    expect(await getBalance(f.userId)).toBe(920);
    expect(await prisma.creditLedger.count({ where: { operationKey: `run:${f.run.id}:settle` } })).toBe(1);
  });

  it("fully releases a no-work failure once and marks pending nodes failed", async () => {
    const f = await fixture();
    await reserveCredits(f.userId, f.run.id, 100);
    await expect(finalizeRun(f.userId, f.run.id, "FAILED", { terminalNodeStatus: "FAILED", error: "Rejected before dispatch" })).resolves.toMatchObject({ charged: 0, refunded: 100 });
    await finalizeRun(f.userId, f.run.id, "FAILED");
    expect(await getBalance(f.userId)).toBe(1_000);
    expect(await prisma.nodeRun.findUniqueOrThrow({ where: { id: f.node.id } })).toMatchObject({ status: "FAILED", error: "Rejected before dispatch" });
  });

  it("preserves the first terminal outcome when cancellation races completion", async () => {
    const f = await fixture();
    await reserveCredits(f.userId, f.run.id, 100);
    await completeNode(f);
    const results = await Promise.all([
      finalizeRun(f.userId, f.run.id, "CANCELLED"), finalizeRun(f.userId, f.run.id, "SUCCESS"),
    ]);
    const winner = results.find((result) => result.settled)!;
    expect(results.filter((result) => result.settled)).toHaveLength(1);
    expect(results.every((result) => result.status === winner.status)).toBe(true);
    expect(await getBalance(f.userId)).toBe(920);
    expect(await prisma.run.findUniqueOrThrow({ where: { id: f.run.id } })).toMatchObject({ status: winner.status, chargedCredits: 80 });
    expect(await prisma.creditLedger.count({ where: { operationKey: `run:${f.run.id}:settle` } })).toBe(1);
  });

  it("validates amounts before writing a reservation or successful usage", async () => {
    const f = await fixture();
    for (const amount of [-1, 0.5, NaN, Infinity, 2_147_483_648]) {
      await expect(reserveCredits(f.userId, f.run.id, amount)).rejects.toThrow("must be an integer");
      await expect(completeNode(f, amount)).rejects.toThrow("must be an integer");
    }
    expect(await getBalance(f.userId)).toBe(1_000);
    expect(await prisma.creditLedger.count({ where: { workflowRunId: f.run.id } })).toBe(0);
    expect(await prisma.nodeRun.findUniqueOrThrow({ where: { id: f.node.id } })).toMatchObject({ status: "PENDING", creditsUsed: 0 });
  });

  it("preserves the first successful node result and its usage on replay", async () => {
    const f = await fixture();
    await reserveCredits(f.userId, f.run.id, 100);
    await expect(completeNode(f)).resolves.toEqual({ recorded: true, creditsUsed: 80 });
    await expect(recordNodeResult(f.userId, f.run.id, f.node.nodeId, { outputs: { text: "different" }, creditsUsed: 99 })).resolves.toEqual({ recorded: false, creditsUsed: 80 });
    expect(await prisma.nodeRun.findUniqueOrThrow({ where: { id: f.node.id } })).toMatchObject({ status: "SUCCESS", creditsUsed: 80, inputs: { text: "input" }, outputs: { text: "output" } });
    await finalizeRun(f.userId, f.run.id, "SUCCESS");
    expect(await getBalance(f.userId)).toBe(920);
  });

  it("does not record a late result after confirmed no-work cancellation", async () => {
    const f = await fixture();
    await reserveCredits(f.userId, f.run.id, 100);
    await finalizeRun(f.userId, f.run.id, "CANCELLED", { terminalNodeStatus: "CANCELLED" });
    await expect(completeNode(f)).resolves.toEqual({ recorded: false, creditsUsed: 0 });
    expect(await getBalance(f.userId)).toBe(1_000);
    expect(await prisma.nodeRun.findUniqueOrThrow({ where: { id: f.node.id } })).toMatchObject({ status: "CANCELLED", creditsUsed: 0 });
  });

  it("rejects cross-owner reservations, usage, and settlement", async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(reserveCredits(other.userId, f.run.id, 100)).rejects.toBeInstanceOf(OwnershipError);
    await reserveCredits(f.userId, f.run.id, 100);
    await expect(recordNodeResult(other.userId, f.run.id, f.node.nodeId, { outputs: {}, creditsUsed: 80 })).rejects.toBeInstanceOf(OwnershipError);
    await expect(finalizeRun(other.userId, f.run.id, "FAILED")).rejects.toBeInstanceOf(OwnershipError);
    expect(await getBalance(f.userId)).toBe(900);
    expect(await getBalance(other.userId)).toBe(1_000);
  });

  it("does not apply the new accounting model to legacy runs", async () => {
    const f = await fixture(1_000, 0);
    await expect(reserveCredits(f.userId, f.run.id, 100)).rejects.toThrow("Legacy execution");
    await expect(completeNode(f)).rejects.toThrow("Legacy execution");
    await expect(finalizeRun(f.userId, f.run.id, "FAILED")).rejects.toThrow("Legacy execution");
    expect(await getBalance(f.userId)).toBe(1_000);
  });

  it("preserves the hold while a cancellation still has unresolved running work", async () => {
    const f = await fixture();
    await reserveCredits(f.userId, f.run.id, 100);
    await prisma.run.update({ where: { id: f.run.id }, data: { status: "CANCEL_REQUESTED", cancellationRequestedAt: new Date() } });
    await prisma.nodeRun.update({ where: { id: f.node.id }, data: { status: "RUNNING" } });
    await expect(finalizeRun(f.userId, f.run.id, "CANCELLED", { terminalNodeStatus: "CANCELLED" })).rejects.toThrow("unresolved");
    expect(await getBalance(f.userId)).toBe(900);
    expect(await prisma.run.findUniqueOrThrow({ where: { id: f.run.id } })).toMatchObject({ status: "CANCEL_REQUESTED", settledAt: null });
    await completeNode(f);
    await finalizeRun(f.userId, f.run.id, "CANCELLED");
    expect(await getBalance(f.userId)).toBe(920);
  });

  it("does not treat a claimed worker with pending nodes as a rejected dispatch", async () => {
    const f = await fixture();
    await reserveCredits(f.userId, f.run.id, 100);
    await prisma.run.update({ where: { id: f.run.id }, data: { status: "RUNNING", workerId: "accepted-worker" } });
    await expect(finalizeRun(f.userId, f.run.id, "FAILED", { terminalNodeStatus: "FAILED", requireUnclaimed: true })).rejects.toThrow("worker has claimed");
    expect(await getBalance(f.userId)).toBe(900);
    expect(await prisma.run.findUniqueOrThrow({ where: { id: f.run.id } })).toMatchObject({ status: "RUNNING", settledAt: null });
    expect(await prisma.nodeRun.findUniqueOrThrow({ where: { id: f.node.id } })).toMatchObject({ status: "PENDING" });
    await finalizeRun(f.userId, f.run.id, "FAILED", { terminalNodeStatus: "FAILED" });
    expect(await getBalance(f.userId)).toBe(1_000);
  });

  it("records zero-value holds and absorbs actual usage above the estimate", async () => {
    const free = await fixture(0);
    await reserveCredits(free.userId, free.run.id, 0);
    await completeNode(free, 0);
    await expect(finalizeRun(free.userId, free.run.id, "SUCCESS")).resolves.toMatchObject({ charged: 0, refunded: 0 });
    const paid = await fixture();
    await reserveCredits(paid.userId, paid.run.id, 100);
    await completeNode(paid, 150);
    await expect(finalizeRun(paid.userId, paid.run.id, "SUCCESS")).resolves.toMatchObject({ actual: 150, charged: 100, refunded: 0 });
    expect(await getBalance(paid.userId)).toBe(900);
  });

  it("serializes duplicate zero-value reservations for an account with no ledger rows", async () => {
    const f = await fixture(0);
    expect(await prisma.creditLedger.count({ where: { userId: f.userId } })).toBe(0);
    await Promise.all([reserveCredits(f.userId, f.run.id, 0), reserveCredits(f.userId, f.run.id, 0)]);
    expect(await getBalance(f.userId)).toBe(0);
    expect(await prisma.creditLedger.count({ where: { operationKey: `run:${f.run.id}:reserve` } })).toBe(1);
  });

  it("joins a caller transaction so preparation failures roll back the hold", async () => {
    const f = await fixture();
    await expect(prisma.$transaction(async (tx) => {
      await reserveCredits(f.userId, f.run.id, 100, tx);
      throw new Error("Node creation failed");
    })).rejects.toThrow("Node creation failed");
    expect(await getBalance(f.userId)).toBe(1_000);
    expect(await prisma.creditLedger.count({ where: { workflowRunId: f.run.id } })).toBe(0);
    expect(await prisma.run.findUniqueOrThrow({ where: { id: f.run.id } })).toMatchObject({ reservedCredits: 0 });
  });
});
