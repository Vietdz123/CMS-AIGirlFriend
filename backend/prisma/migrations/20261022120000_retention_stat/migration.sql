-- CreateTable
CREATE TABLE "RetentionStat" (
    "id" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "country" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "newUsers" INTEGER NOT NULL,
    "d1" INTEGER,
    "d3" INTEGER,
    "d7" INTEGER,
    "d14" INTEGER,
    "d30" INTEGER,

    CONSTRAINT "RetentionStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetentionStat_date_idx" ON "RetentionStat"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionStat_date_country_source_key" ON "RetentionStat"("date", "country", "source");

