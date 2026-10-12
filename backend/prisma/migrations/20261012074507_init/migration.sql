-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('INITIAL', 'MANUAL', 'SCHEDULED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAppAccess" (
    "userId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,

    CONSTRAINT "UserAppAccess_pkey" PRIMARY KEY ("userId","appId")
);

-- CreateTable
CREATE TABLE "AdmobAccount" (
    "id" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmobAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "storeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdUnit" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitStat" (
    "id" BIGSERIAL NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "appId" TEXT NOT NULL,
    "adUnitId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "earningsMicros" BIGINT NOT NULL,
    "impressions" BIGINT NOT NULL,
    "clicks" BIGINT NOT NULL,
    "adRequests" BIGINT NOT NULL,
    "matchedRequests" BIGINT NOT NULL,

    CONSTRAINT "UnitStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceStat" (
    "id" BIGSERIAL NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "appId" TEXT NOT NULL,
    "adUnitId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "adSourceId" TEXT NOT NULL,
    "adSourceName" TEXT NOT NULL,
    "earningsMicros" BIGINT NOT NULL,
    "impressions" BIGINT NOT NULL,
    "clicks" BIGINT NOT NULL,
    "adRequests" BIGINT NOT NULL,
    "matchedRequests" BIGINT NOT NULL,

    CONSTRAINT "SourceStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdmobAccount_publisherId_key" ON "AdmobAccount"("publisherId");

-- CreateIndex
CREATE INDEX "App_accountId_idx" ON "App"("accountId");

-- CreateIndex
CREATE INDEX "AdUnit_appId_idx" ON "AdUnit"("appId");

-- CreateIndex
CREATE INDEX "UnitStat_accountId_date_idx" ON "UnitStat"("accountId", "date");

-- CreateIndex
CREATE INDEX "UnitStat_appId_date_idx" ON "UnitStat"("appId", "date");

-- CreateIndex
CREATE INDEX "UnitStat_date_idx" ON "UnitStat"("date");

-- CreateIndex
CREATE INDEX "SourceStat_accountId_date_idx" ON "SourceStat"("accountId", "date");

-- CreateIndex
CREATE INDEX "SourceStat_appId_date_idx" ON "SourceStat"("appId", "date");

-- CreateIndex
CREATE INDEX "SourceStat_date_idx" ON "SourceStat"("date");

-- CreateIndex
CREATE INDEX "SyncRun_accountId_startedAt_idx" ON "SyncRun"("accountId", "startedAt");

-- AddForeignKey
ALTER TABLE "UserAppAccess" ADD CONSTRAINT "UserAppAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAppAccess" ADD CONSTRAINT "UserAppAccess_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "App" ADD CONSTRAINT "App_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AdmobAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdUnit" ADD CONSTRAINT "AdUnit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AdmobAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdUnit" ADD CONSTRAINT "AdUnit_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AdmobAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
