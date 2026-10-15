import { describe, expect, it } from "vitest";
import { RUN_UI, dispatchRunStatus, isActiveRunStatus, isKnownRequestRejection, isTerminalRunStatus, runCreditLabel, runNeedsReview } from "../ui-config";

describe("run UI contract", () => {
  it("keeps uncertain starts and cancellation requests active, not terminal", () => {
    for (const status of RUN_UI.activeStatuses) {
      expect(isActiveRunStatus(status)).toBe(true);
      expect(isTerminalRunStatus(status)).toBe(false);
    }
    for (const status of RUN_UI.terminalStatuses) {
      expect(isTerminalRunStatus(status)).toBe(true);
      expect(isActiveRunStatus(status)).toBe(false);
    }
    expect(isTerminalRunStatus("COMPLETED")).toBe(false);
  });

  it("normalizes dispatch acknowledgments without claiming completion", () => {
    expect(dispatchRunStatus("triggered")).toBe("PENDING");
    expect(dispatchRunStatus("dispatch_unknown")).toBe("DISPATCH_UNKNOWN");
    expect(dispatchRunStatus("cancel_requested")).toBe("CANCEL_REQUESTED");
    expect(dispatchRunStatus("failed")).toBe("FAILED");
  });

  it("shows reservation while unsettled and actual charge after settlement, including zero", () => {
    expect(runCreditLabel({ accountingVersion: 1, reservedCredits: 50, chargedCredits: null })).toBe("50 cr held");
    expect(runCreditLabel({ accountingVersion: 1, reservedCredits: 50, chargedCredits: 12, settledAt: "2026-10-15" })).toBe("12 cr charged");
    expect(runCreditLabel({ accountingVersion: 1, reservedCredits: 50, chargedCredits: 0, settledAt: "2026-10-15" })).toBe("0 cr charged");
    expect(runCreditLabel({ accountingVersion: 1, settledAt: "2026-10-15" })).toBe("Charge pending");
    expect(runCreditLabel({ reservedCredits: 50 })).toBe("Legacy run");
  });

  it("flags old or uncertain active runs for review without changing their saved status", () => {
    const createdAt = new Date("2026-10-15T00:00:00Z");
    const now = createdAt.getTime() + RUN_UI.reviewAfterMs + 1;
    const run = { status: "RUNNING", createdAt };
    expect(runNeedsReview(run, now)).toBe(true);
    expect(run.status).toBe("RUNNING");
    expect(runNeedsReview({ status: "DISPATCH_UNKNOWN", createdAt, dispatchError: "No acknowledgment" }, createdAt.getTime())).toBe(true);
    expect(runNeedsReview({ status: "CANCELLED", createdAt }, now)).toBe(false);
    expect(runNeedsReview({ status: "PENDING", createdAt }, createdAt.getTime())).toBe(false);
  });

  it("preserves retry identity for network or server uncertainty", () => {
    expect(isKnownRequestRejection(new Error("Network unavailable"))).toBe(false);
    expect(isKnownRequestRejection({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(false);
    expect(isKnownRequestRejection({ data: { code: "TIMEOUT" } })).toBe(false);
    expect(isKnownRequestRejection({ data: { code: "BAD_REQUEST" } })).toBe(true);
    expect(isKnownRequestRejection({ data: { code: "FORBIDDEN" } })).toBe(true);
    expect(isKnownRequestRejection({ data: { code: "PAYMENT_REQUIRED" } })).toBe(true);
  });
});
