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

export interface Summary {
  current: Metrics;
  previous: Metrics;
  previousRange: { from: string; to: string };
}

export type TimePoint = Metrics & { date: string };
export type BreakdownRow = Metrics & { key: string; label: string };
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
