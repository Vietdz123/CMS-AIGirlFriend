-- AlterTable
ALTER TABLE "AdSpendStat" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'facebook';

-- CreateTable
CREATE TABLE "GadsAccount" (
    "id" TEXT NOT NULL,
    "loginCustomerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GadsAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GadsCampaign" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storeId" TEXT,
    "appId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GadsCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GadsCampaign_accountId_idx" ON "GadsCampaign"("accountId");

-- AddForeignKey
ALTER TABLE "GadsCampaign" ADD CONSTRAINT "GadsCampaign_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GadsAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
