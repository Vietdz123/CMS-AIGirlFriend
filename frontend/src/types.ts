export type Role = 'ADMIN' | 'MANAGER' | 'VIEWER';

export interface Me {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Metrics {
  earnings: number;
  impressions: number;
  clicks: number;
  adRequests: number;
  matchedRequests: number;
  ecpm: number;
  ctr: number;
  matchRate: number;
  showRate: number;
}

/** Chi phí Facebook Ads: có ở tổng quan, theo ngày, theo app và theo quốc gia. */
export interface SpendMetrics {
  spend: number;
  installs: number;
  profit: number;
  roas: number;
  cpi: number;
}

export interface Summary {
  current: Metrics & SpendMetrics;
  previous: Metrics & SpendMetrics;
  previousRange: { from: string; to: string };
  /** Chi phí chưa ghép được app nào (chỉ có khi xem mọi app), đã nằm trong current.spend. */
  unmatchedSpend?: number;
}

export type TimePoint = Metrics & SpendMetrics & { date: string };
export type BreakdownRow = Metrics & Partial<SpendMetrics> & { key: string; label: string };
export type AppDailyRow = Metrics & { date: string; appId: string; appName: string };

export interface AdmobAccount {
  id: string;
  publisherId: string;
  name: string;
  currencyCode: string;
  timeZone: string;
  lastSyncedAt: string | null;
  createdAt: string;
  _count: { apps: number };
}

export interface AppInfo {
  id: string;
  name: string;
  platform: string;
  storeId: string | null;
  account: { id: string; publisherId: string; name: string };
  _count: { adUnits: number };
}

export interface SyncRun {
  id: string;
  accountId: string;
  trigger: 'INITIAL' | 'MANUAL' | 'SCHEDULED';
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  fromDate: string;
  toDate: string;
  rowCount: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  account?: { publisherId: string; name: string };
}

export interface SyncStatus {
  id: string;
  publisherId: string;
  lastSyncedAt: string | null;
  running: boolean;
  lastRun: SyncRun | null;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
  appIds: string[];
}

export interface FbAdAccount {
  id: string;
  name: string;
  currencyCode: string;
  timeZone: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  running: boolean;
  createdAt: string;
  _count: { campaigns: number };
}

/** Tài khoản quảng cáo token xem được (khi kiểm tra token, chưa lưu). */
export interface FbApiAdAccount {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
}

export interface FbCampaign {
  id: string;
  name: string;
  storeId: string | null;
  appId: string | null;
  autoAppId: string | null;
  /** Chi phí trong khoảng ngày đang lọc, đã quy đổi USD. */
  totalSpend: number;
  /** Chi phí theo tiền tệ gốc của tài khoản quảng cáo. */
  localSpend: number;
  installs: number;
  /** Conversion value nền tảng báo (USD). Facebook luôn 0. */
  convValue: number;
  account: { id: string; name: string };
}

export interface GadsAccount {
  id: string; // customer id 10 chữ số
  name: string;
  currencyCode: string;
  timeZone: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  running: boolean;
  createdAt: string;
  _count: { campaigns: number };
}

/** Cùng dạng với FbCampaign: ghép chiến dịch với app AdMob. */
export type GadsCampaign = FbCampaign;

/** 1 ngày của 1 chiến dịch (trang Google Ads, xem theo ngày). */
export interface CampaignDay {
  date: string;
  spend: number;
  localSpend: number;
  impressions: number;
  clicks: number;
  installs: number;
  cpi: number | null;
  convValue: number;
  roas: number | null;
  /** Budget/ngày (mức cuối ngày); null = chưa ghi nhận được. */
  budget: number | null;
  localBudget: number | null;
}

/** 1 dòng ROAS cohort Google Ads: ngày tương tác quảng cáo, giá trị và ROAS theo mốc (null = chưa đủ ngày). */
export interface CohortRoasRow {
  date: string;
  spend: number;
  installs: number;
  convValue: number;
  value: Record<'d0' | 'd1' | 'd3' | 'd7' | 'd14' | 'd30', number>;
  roas: Record<'d0' | 'd1' | 'd3' | 'd7' | 'd14' | 'd30', number | null>;
  /** partial: số tích luỹ tới hiện tại, còn tăng; final: đã đủ ngày, đã chốt. */
  status: Record<'d0' | 'd1' | 'd3' | 'd7' | 'd14' | 'd30', 'partial' | 'final'>;
}

/** Retention theo ngày cài (GA4): số người dùng mới và active[n] = số còn hoạt động ngày thứ n (chỉ các ngày đã đủ). */
export interface RetentionDay {
  date: string;
  newUsers: number;
  active: number[];
}

/** Retention theo nước: tỷ lệ (0..1) ở từng mốc; null = chưa có ngày cài nào đủ mốc. */
export interface RetentionCountry {
  country: string;
  newUsers: number;
  d1: number | null;
  d3: number | null;
  d7: number | null;
  d14: number | null;
  d30: number | null;
}

export interface RetentionStatus {
  enabled: boolean;
  running: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  maxDay: number;
}

/** So sánh retention 2 kỳ; mix + rateEffect của các nhóm cộng lại = delta. */
export interface RetentionCompare {
  day: number;
  by: 'country' | 'source' | 'version';
  a: { from: string; to: string; users: number; rate: number | null };
  b: { from: string; to: string; users: number; rate: number | null };
  delta?: number;
  mix?: number;
  rateEffect?: number;
  segments: {
    key: string;
    usersA: number;
    usersB: number;
    shareA: number;
    shareB: number;
    rateA: number | null;
    rateB: number | null;
    mix: number;
    rateEffect: number;
  }[];
}

/** 1 chiến dịch Google Ads trong 1 ngày của bảng ROAS theo ngày. */
export interface CohortRoasCampaign {
  id: string;
  name: string;
  storeId: string | null;
  budget: number | null;
  localBudget: number | null;
  spend: number;
  localSpend: number;
  installs: number;
  cpi: number | null;
  convValue: number;
  roas: Record<'d0' | 'd1' | 'd3' | 'd7' | 'd14' | 'd30', number | null>;
  status: Record<'d0' | 'd1' | 'd3' | 'd7' | 'd14' | 'd30', 'partial' | 'final'>;
}

/** Doanh thu quảng cáo theo ngày phát sinh x ngày cài; columns gồm ngày cài, "earlier" (gộp ≤ 1%) và "unknown". */
export interface RevenueByInstall {
  columns: string[];
  earlierBefore: string | null;
  /** Chi phí quảng cáo cả các kênh theo ngày cài (cột), USD; googleValue = doanh thu Google Ads tự ghi nhận. */
  spend: Record<string, { total: number; bySource: Record<string, number>; googleValue: number }>;
  rows: { date: string; total: number; cells: Record<string, { revenue: number; users: number }> }[];
}

/** ROAS theo giờ hôm nay của từng chiến dịch Google Ads (USD, giờ theo múi giờ tài khoản). */
export interface GadsHourly {
  date: string;
  currentHour: number;
  fetchedAt: string;
  campaigns: { id: string; name: string; hours: { hour: number; spend: number; value: number }[] }[];
}

/** Số liệu chi phí của 1 ngày lần đầu CMS ghi nhận và hiện tại, kèm mọi phiên bản (USD). */
export interface SpendChange {
  date: string;
  source: string;
  /** Mốc gốc: lần ghi đầu tiên khi ngày đã qua 1,5 ngày; null khi chưa đủ. */
  first: { spend: number; convValue: number; installs: number; at: string } | null;
  latest: { spend: number; convValue: number; installs: number; at: string };
  /** early = ghi khi ngày chưa đủ 1,5 ngày (số còn về thêm). */
  versions: { at: string; spend: number; convValue: number; installs: number; early: boolean }[];
}

/** Click và click không hợp lệ (Google đã lọc, không tính tiền) của 1 ngày, Google Ads. */
export interface InvalidClickDay {
  date: string;
  clicks: number;
  invalidClicks: number;
}

/** Số dư tài khoản Google Ads theo tiền gốc: hạn mức đã nạp, đã tiêu, tổng điều chỉnh (tín dụng). */
export interface GadsBalance {
  id: string;
  name: string;
  currency: string;
  current: GadsBalancePoint | null;
  history: GadsBalancePoint[];
}
export interface GadsBalancePoint {
  at: string;
  limit: number;
  served: number;
  adjustment: number;
}
