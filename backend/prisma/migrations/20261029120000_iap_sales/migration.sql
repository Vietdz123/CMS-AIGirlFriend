-- CreateTable
CREATE TABLE "IapSaleStat" (
    "id" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "packageName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "orders" INTEGER NOT NULL,
    "refunds" INTEGER NOT NULL,
    "priceLocalMicros" BIGINT NOT NULL,
    "taxLocalMicros" BIGINT NOT NULL,
    "priceUsdMicros" BIGINT NOT NULL,
    "taxUsdMicros" BIGINT NOT NULL,

    CONSTRAINT "IapSaleStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IapSaleStat_date_idx" ON "IapSaleStat"("date");

-- CreateIndex
CREATE INDEX "IapSaleStat_packageName_date_idx" ON "IapSaleStat"("packageName", "date");
