-- Retention chuyển từ 5 mốc cố định sang đủ D0..D60. Số cũ không đổi được sang dạng mới (thiếu các ngày ở giữa),
-- nên xoá; lần đồng bộ GA4 ngay sau khi khởi động tải lại 63 ngày gần nhất (đủ toàn bộ dữ liệu hiện có).
DELETE FROM "RetentionStat";

-- DropIndex
DROP INDEX "RetentionStat_date_country_source_appVersion_key";

-- AlterTable
ALTER TABLE "RetentionStat" DROP COLUMN "appVersion",
DROP COLUMN "d1",
DROP COLUMN "d14",
DROP COLUMN "d3",
DROP COLUMN "d30",
DROP COLUMN "d7",
ADD COLUMN     "active" INTEGER[];

-- CreateTable
CREATE TABLE "RetentionInstallVersion" (
    "id" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "country" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "users" INTEGER NOT NULL,

    CONSTRAINT "RetentionInstallVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetentionInstallVersion_date_idx" ON "RetentionInstallVersion"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionInstallVersion_date_country_source_appVersion_key" ON "RetentionInstallVersion"("date", "country", "source", "appVersion");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionStat_date_country_source_key" ON "RetentionStat"("date", "country", "source");

