-- CreateTable
CREATE TABLE "GaCampaignRevenue" (
    "id" BIGSERIAL NOT NULL,
    "installDate" DATE NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "dayN" INTEGER NOT NULL,
    "revenueMicros" BIGINT NOT NULL,
    "users" INTEGER NOT NULL,

    CONSTRAINT "GaCampaignRevenue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GaCampaignRevenue_installDate_idx" ON "GaCampaignRevenue"("installDate");
