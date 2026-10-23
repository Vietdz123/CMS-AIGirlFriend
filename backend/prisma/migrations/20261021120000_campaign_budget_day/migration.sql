-- CreateTable
CREATE TABLE "CampaignBudgetDay" (
    "id" BIGSERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "budgetMicros" BIGINT NOT NULL,
    "localBudgetMicros" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,

    CONSTRAINT "CampaignBudgetDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignBudgetDay_accountId_date_idx" ON "CampaignBudgetDay"("accountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignBudgetDay_source_campaignId_date_key" ON "CampaignBudgetDay"("source", "campaignId", "date");

