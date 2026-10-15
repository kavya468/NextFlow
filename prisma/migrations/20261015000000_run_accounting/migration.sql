-- Historical ledger rows and snapshots are intentionally not inferred or rewritten.
ALTER TABLE "Workflow" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Run"
  ADD COLUMN "graphSnapshot" JSONB,
  ADD COLUMN "workflowRevision" INTEGER,
  ADD COLUMN "accountingVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reservedCredits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "chargedCredits" INTEGER,
  ADD COLUMN "settledAt" TIMESTAMP(3),
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "workerId" TEXT,
  ADD COLUMN "dispatchError" TEXT,
  ADD COLUMN "cancellationRequestedAt" TIMESTAMP(3);
ALTER TABLE "CreditLedger" ADD COLUMN "operationKey" TEXT;
CREATE UNIQUE INDEX "Run_userId_requestKey_key" ON "Run"("userId", "requestKey");
CREATE UNIQUE INDEX "CreditLedger_operationKey_key" ON "CreditLedger"("operationKey");
ALTER TABLE "Run" ADD CONSTRAINT "Run_credit_amounts_nonnegative"
  CHECK ("reservedCredits" >= 0 AND ("chargedCredits" IS NULL OR "chargedCredits" >= 0));
