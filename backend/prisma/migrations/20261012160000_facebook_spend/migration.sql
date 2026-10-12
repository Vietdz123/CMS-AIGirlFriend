-- CreateTable
CREATE TABLE "FbAdAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "tokenEnc" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FbAdAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FbCampaign" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storeId" TEXT,
    "appId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FbCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSpendStat" (
    "id" BIGSERIAL NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "campaignId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "spendMicros" BIGINT NOT NULL,
    "impressions" BIGINT NOT NULL,
    "clicks" BIGINT NOT NULL,
    "installs" BIGINT NOT NULL,

    CONSTRAINT "AdSpendStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FbCampaign_accountId_idx" ON "FbCampaign"("accountId");

-- CreateIndex
CREATE INDEX "AdSpendStat_accountId_date_idx" ON "AdSpendStat"("accountId", "date");

-- CreateIndex
CREATE INDEX "AdSpendStat_campaignId_date_idx" ON "AdSpendStat"("campaignId", "date");

-- CreateIndex
CREATE INDEX "AdSpendStat_date_idx" ON "AdSpendStat"("date");

-- AddForeignKey
ALTER TABLE "FbCampaign" ADD CONSTRAINT "FbCampaign_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FbAdAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

