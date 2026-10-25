-- CreateTable
CREATE TABLE "RevenueCohortStat" (
    "id" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "installDate" DATE,
    "revenueMicros" BIGINT NOT NULL,
    "users" INTEGER NOT NULL,

    CONSTRAINT "RevenueCohortStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RevenueCohortStat_date_idx" ON "RevenueCohortStat"("date");

