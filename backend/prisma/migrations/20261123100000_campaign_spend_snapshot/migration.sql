-- CreateTable
CREATE TABLE "CampaignSpendSnapshot" (
    "id" BIGSERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spendMicros" BIGINT NOT NULL,
    "convValueMicros" BIGINT NOT NULL,
    "installs" BIGINT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignSpendSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignSpendSnapshot_source_date_campaignId_capturedAt_idx" ON "CampaignSpendSnapshot"("source", "date", "campaignId", "capturedAt");
