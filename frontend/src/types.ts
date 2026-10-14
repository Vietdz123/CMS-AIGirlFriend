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
}
