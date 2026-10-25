-- Trang biến động chi phí chỉ theo dõi Google Ads; bỏ lịch sử Facebook đã ghi.
DELETE FROM "SpendSnapshot" WHERE "source" = 'facebook';

-- Lịch sử chuyển sang ghi 1 lần/ngày: các lần ghi 30 phút/lần trong ngày 24/10 (từ khi bật tính năng) chỉ giữ lần
-- mới nhất của mỗi ngày x tài khoản.
DELETE FROM "SpendSnapshot" s
WHERE s."capturedAt" >= '2026-10-24 12:00:00'
  AND EXISTS (
    SELECT 1 FROM "SpendSnapshot" n
    WHERE n."accountId" = s."accountId" AND n."date" = s."date" AND n."source" = s."source"
      AND n."capturedAt" >= '2026-10-24 12:00:00' AND n."capturedAt" > s."capturedAt"
  );
