-- CreateTable
CREATE TABLE "GadsBalanceSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "accountId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "limitMicros" BIGINT NOT NULL,
    "servedMicros" BIGINT NOT NULL,
    "adjustmentMicros" BIGINT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GadsBalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GadsBalanceSnapshot_accountId_capturedAt_idx" ON "GadsBalanceSnapshot"("accountId", "capturedAt");
