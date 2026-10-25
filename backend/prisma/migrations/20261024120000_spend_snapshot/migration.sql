-- CreateTable
CREATE TABLE "SpendSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spendMicros" BIGINT NOT NULL,
    "convValueMicros" BIGINT NOT NULL,
    "installs" BIGINT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpendSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpendSnapshot_source_accountId_date_capturedAt_idx" ON "SpendSnapshot"("source", "accountId", "date", "capturedAt");

-- CreateIndex
CREATE INDEX "SpendSnapshot_date_idx" ON "SpendSnapshot"("date");
