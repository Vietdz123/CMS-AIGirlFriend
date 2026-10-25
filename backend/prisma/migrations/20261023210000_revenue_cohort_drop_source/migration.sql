-- Bỏ lọc theo nguồn ở bảng doanh thu theo ngày cài. Các dòng hiện có vẫn đúng: bảng chỉ cộng doanh thu theo
-- ngày và ngày cài, nên bỏ cột nguồn không cần lấy lại từ GA4.
ALTER TABLE "RevenueCohortStat" DROP COLUMN "source";
