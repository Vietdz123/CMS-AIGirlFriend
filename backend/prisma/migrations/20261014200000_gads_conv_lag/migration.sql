-- CreateTable
CREATE TABLE "GadsConvLagStat" (
    "id" BIGSERIAL NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "campaignId" TEXT NOT NULL,
    "lagBucket" TEXT NOT NULL,
    "valueMicros" BIGINT NOT NULL,
    "localValueMicros" BIGINT NOT NULL,

    CONSTRAINT "GadsConvLagStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GadsConvLagStat_accountId_date_idx" ON "GadsConvLagStat"("accountId", "date");

-- CreateIndex
CREATE INDEX "GadsConvLagStat_campaignId_date_idx" ON "GadsConvLagStat"("campaignId", "date");

