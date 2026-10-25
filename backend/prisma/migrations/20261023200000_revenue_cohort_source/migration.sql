-- Thêm nguồn cài. Số cũ không có nguồn nên xoá; app tự lấy lại 14 ngày từ GA4 khi khởi động thấy bảng trống.
DELETE FROM "RevenueCohortStat";
ALTER TABLE "RevenueCohortStat" ADD COLUMN "source" TEXT NOT NULL;
