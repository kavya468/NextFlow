import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/nodes/registry", () => ({ nodeRegistry: { get: vi.fn() } }));

import { estimateWorkflowCost, validateCreditAmount } from "@/lib/credits/credit-service";
import { nodeRegistry } from "@/lib/nodes/registry";

beforeEach(() => vi.resetAllMocks());

describe("credit amounts", () => {
  it.each([0, 1, 2_147_483_647])("accepts the supported integer amount %s", (amount) => {
    expect(validateCreditAmount(amount)).toBe(amount);
  });

  it.each([-1, 0.5, NaN, Infinity, -Infinity, 2_147_483_648])("rejects invalid amount %s", (amount) => {
    expect(() => validateCreditAmount(amount)).toThrow("must be an integer");
  });

  it("rejects a total estimate that would overflow the stored reservation", async () => {
    vi.mocked(nodeRegistry.get, { partial: true }).mockReturnValue({ credits: { estimate: () => 1_500_000_000, calculate: () => 0 } });
    await expect(estimateWorkflowCost([
      { id: "first", type: "paid", data: {} },
      { id: "second", type: "paid", data: {} },
    ])).rejects.toThrow("Workflow estimate");
  });

  it("rejects invalid provider estimates before they can reduce a reservation", async () => {
    vi.mocked(nodeRegistry.get, { partial: true }).mockReturnValue({ credits: { estimate: () => -10, calculate: () => 0 } });
    await expect(estimateWorkflowCost([{ id: "paid-node", type: "paid", data: {} }])).rejects.toThrow("Estimate for paid-node");
  });
});
