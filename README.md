# AdMob Revenue CMS

CMS theo dõi doanh thu AdMob cho app Android: **NestJS + Prisma + PostgreSQL** (backend) và **React + Vite + Recharts** (frontend).

## Tính năng

- **Dashboard**: doanh thu ước tính, eCPM, impressions, requests, match rate, show rate; so sánh với kỳ trước; biểu đồ theo ngày.
- **Breakdown**: theo ad unit, format (banner / interstitial / rewarded / native / app open), quốc gia, mạng mediation (AdMob Network, Meta, AppLovin…), app, tài khoản.
- **Nhiều app / nhiều tài khoản AdMob**: kết nối bao nhiêu tài khoản Google cũng được, app và ad unit được đồng bộ tự động.
- **Nút Update**: lấy số liệu mới nhất từ AdMob API ngay lập tức; dashboard tự làm mới khi sync xong.
- **Đồng bộ tự động**: 30 phút/lần (3 ngày gần nhất) + 3h15 sáng hằng ngày (14 ngày gần nhất, để bắt các điều chỉnh muộn của AdMob).
- **Đăng nhập & phân quyền**:
  | Quyền | Xem | Bấm Update | Quản lý user, kết nối tài khoản |
  |---|---|---|---|
  | ADMIN | Mọi app | ✅ | ✅ |
  | MANAGER | App được gán | ✅ | ❌ |
  | VIEWER | App được gán | ❌ | ❌ |

> Số liệu AdMob API trả về là **ước tính** (giống con số trên AdMob console), số tiền thanh toán cuối tháng có thể chênh lệch nhẹ.
> AdMob thường cập nhật dữ liệu với độ trễ vài giờ, nên bấm Update liên tục cũng không làm số nhảy theo thời gian thực từng giây.

## 1. Thiết lập Google Cloud (làm 1 lần)

1. Vào <https://console.cloud.google.com/> → tạo project mới (ví dụ `admob-cms`).
2. **Bật AdMob API**: *APIs & Services → Library* → tìm **AdMob API** → **Enable**.
3. **OAuth consent screen** (*APIs & Services → OAuth consent screen*, hoặc *Google Auth Platform → Branding/Audience*):
   - User type: **External**.
   - Điền tên app, email hỗ trợ.
   - Scopes: thêm `https://www.googleapis.com/auth/admob.readonly` và `https://www.googleapis.com/auth/admob.report`.
   - **Test users**: thêm email Google đang sở hữu tài khoản AdMob.
   - ⚠️ Khi app ở trạng thái *Testing*, refresh token **hết hạn sau 7 ngày** → phải kết nối lại. Để dùng lâu dài, bấm **Publish app** (chuyển sang *In production*). Với app nội bộ dùng scope này, Google có thể hiện cảnh báo "unverified app" khi đăng nhập — bấm *Advanced → Go to … (unsafe)* là được.
4. **Tạo OAuth Client**: *APIs & Services → Credentials → Create credentials → OAuth client ID*
   - Application type: **Web application**.
   - Authorized redirect URIs: `http://localhost:3000/api/admob/oauth/callback`
     (khi deploy thêm `https://<domain-backend>/api/admob/oauth/callback`).
   - Copy **Client ID** và **Client secret** vào `backend/.env`.

## 1b. Kết nối Google Ads (chi phí UAC)

1. Trong cùng project Google Cloud: bật **Google Ads API** (<https://console.cloud.google.com/flows/enableapi?apiid=googleads.googleapis.com>), rồi vào <https://console.cloud.google.com/google/ads-apis/overview> xin **Explorer** access (2.880 lệnh/ngày, đủ dùng). Không cần developer token.
2. OAuth consent screen: thêm scope `https://www.googleapis.com/auth/adwords`; Gmail quản lý tài khoản Ads phải có trong **Test users**.
3. Trong CMS: **Google Ads → + Kết nối Google Ads**, đăng nhập Gmail đó. Mọi tài khoản quảng cáo Gmail đó xem được (kể cả tài khoản con dưới MCC) sẽ được thêm và tải 90 ngày chi phí.
4. App campaign (UAC) tự ghép với app AdMob theo package name; chiến dịch khác chọn app bằng tay ở bảng **Chiến dịch → App**.

Chi phí Google cộng chung với chi phí Facebook vào Spend, Profit, ROAS, CPI. Install = cột *Installs* (biddable app install conversions) của Google Ads.

## 2. Chạy local

Yêu cầu: Node.js ≥ 20, Docker (hoặc PostgreSQL có sẵn).

```bash
docker compose up -d
```

```bash
cd backend && cp .env.example .env
```

Sửa `backend/.env`: điền `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, đổi `JWT_SECRET`, `ENCRYPTION_KEY` thành chuỗi ngẫu nhiên (`openssl rand -hex 32`) và đổi mật khẩu admin.

```bash
cd backend && npm install && npx prisma migrate dev --name init && npm run seed && npm run start:dev
```

```bash
cd frontend && npm install && npm run dev
```

Mở <http://localhost:5173>, đăng nhập bằng `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, vào **Tài khoản AdMob → Kết nối tài khoản**. Sau khi kết nối, hệ thống tự tải `BACKFILL_DAYS` (mặc định 90) ngày dữ liệu ở nền.

## 3. Cách hoạt động

```
AdMob API ──(OAuth refresh token, mã hoá AES-GCM trong DB)──> SyncService ──> PostgreSQL ──> /api/reports/* ──> React
                                ▲
              Nút Update / cron 30 phút / cron hằng ngày
```

- Dữ liệu lấy từ **Mediation Report** của AdMob API nên gồm cả doanh thu các mạng mediation bên thứ 3, không chỉ AdMob Network.
- 2 report được lưu:
  - `UnitStat`: ngày × app × ad unit × format × quốc gia — dùng cho dashboard và hầu hết breakdown.
  - `SourceStat`: ngày × app × ad unit × format × ad source — dùng cho breakdown theo mạng quảng cáo.
- Mỗi lần sync xoá rồi ghi lại toàn bộ khoảng ngày được lấy (trong 1 transaction), nên dữ liệu được AdMob điều chỉnh sau sẽ được cập nhật đúng.
- Mọi tài khoản được quy đổi về `REPORT_CURRENCY` (mặc định USD) để cộng gộp được.
- Ngày trong report theo **múi giờ báo cáo của tài khoản AdMob** (thường là `America/Los_Angeles`), giống AdMob console.

## API

| Method | Path | Quyền |
|---|---|---|
| POST | `/api/auth/login` | public |
| GET | `/api/auth/me` | đã đăng nhập |
| GET | `/api/reports/summary?from&to&appIds&formats&countries` | đã đăng nhập |
| GET | `/api/reports/timeseries?…&granularity=day\|week\|month` | đã đăng nhập |
| GET | `/api/reports/breakdown?…&dimension=app\|adUnit\|format\|country\|adSource\|account` | đã đăng nhập |
| GET | `/api/reports/app-daily?…` | đã đăng nhập |
| POST | `/api/sync` | ADMIN, MANAGER |
| GET | `/api/sync/status` | đã đăng nhập |
| GET | `/api/sync/history` | ADMIN |
| GET | `/api/admob/accounts`, `/api/admob/apps` | đã đăng nhập |
| GET | `/api/admob/oauth/url` | ADMIN |
| DELETE | `/api/admob/accounts/:id` | ADMIN |
| GET/POST/PATCH/DELETE | `/api/users…` | ADMIN |

## Deploy lên VPS (Docker + HTTPS tự động)

Cả app chạy trong 1 container: backend NestJS phục vụ luôn frontend đã build. Caddy đứng trước để lo HTTPS.

1. Thuê VPS Ubuntu (1 vCPU / 1–2 GB RAM là đủ), cài Docker: `curl -fsSL https://get.docker.com | sh`.
2. Trỏ **A record** của tên miền (ví dụ `cms.tenmien.com`) về IP của VPS. Mở port 80 và 443.
3. Copy code lên VPS (git clone hoặc `scp`), rồi tạo file cấu hình:
   ```bash
   cp .env.production.example .env.production && nano .env.production
   ```
4. Trong Google Cloud → OAuth Client → **Authorized redirect URIs**, thêm `https://<DOMAIN>/api/admob/oauth/callback`.
5. Build và chạy:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   ```
6. Tạo tài khoản admin (chỉ chạy 1 lần):
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production exec app npx prisma db seed
   ```
7. Mở `https://<DOMAIN>`, đăng nhập admin, kết nối lại tài khoản AdMob (DB trên server là DB mới), rồi vào **Người dùng** để tạo tài khoản cho mọi người.

Cập nhật code: kéo code mới về rồi chạy lại lệnh ở bước 5. Migration DB chạy tự động khi container khởi động.

Xem log: `docker compose -f docker-compose.prod.yml logs -f app`.

> Chỉ chạy **1 container app**: cron và khoá chống sync trùng nằm trong bộ nhớ process.
