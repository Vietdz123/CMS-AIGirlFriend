-- DropIndex
DROP INDEX "RetentionStat_date_country_source_key";

-- AlterTable
ALTER TABLE "RetentionStat" ADD COLUMN     "appVersion" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "RetentionStat_date_country_source_appVersion_key" ON "RetentionStat"("date", "country", "source", "appVersion");

-- Dòng cũ (appVersion = '') là số tổng không chia phiên bản; giữ nguyên, đồng bộ sau sẽ thêm dòng theo phiên bản.
