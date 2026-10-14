-- AlterTable
ALTER TABLE "AdSpendStat" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN "localSpendMicros" BIGINT NOT NULL DEFAULT 0;

-- Dữ liệu cũ: spendMicros đang là tiền gốc của tài khoản; ghi lại tiền tệ gốc để quy đổi lại ở lần sync tiếp theo.
UPDATE "AdSpendStat" s SET "localSpendMicros" = s."spendMicros", "currency" = a."currencyCode"
FROM "FbAdAccount" a WHERE s.source = 'facebook' AND a.id = s."accountId";
UPDATE "AdSpendStat" s SET "localSpendMicros" = s."spendMicros", "currency" = a."currencyCode"
FROM "GadsAccount" a WHERE s.source = 'google' AND a.id = s."accountId";

-- CreateTable
CREATE TABLE "FxRate" (
    "date" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("date","currency")
);

-- Chi phí cũ của tài khoản không dùng USD đang bị cộng thẳng như USD (sai). Xoá đi để lần "Update" tiếp theo
-- tải lại toàn bộ và quy đổi đúng tỷ giá (tài khoản không còn dữ liệu sẽ được backfill BACKFILL_DAYS ngày).
DELETE FROM "AdSpendStat" WHERE "currency" <> 'USD';
