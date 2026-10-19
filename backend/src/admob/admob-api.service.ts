import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export const ADMOB_SCOPES = [
  'https://www.googleapis.com/auth/admob.readonly',
  'https://www.googleapis.com/auth/admob.report',
];

const API = 'https://admob.googleapis.com/v1';

export interface ApiAccount {
  name: string; // accounts/pub-XXX
  publisherId: string;
  reportingTimeZone: string;
  currencyCode: string;
}

export interface ApiApp {
  appId: string;
  platform: string;
  linkedAppInfo?: { appStoreId?: string; displayName?: string };
  manualAppInfo?: { displayName?: string };
}

export interface ApiAdUnit {
  adUnitId: string;
  appId: string;
  displayName: string;
  adFormat: string;
}

type DimValue = { value?: string; displayLabel?: string };
type MetricValue = { integerValue?: string; microsValue?: string; doubleValue?: number };
export interface ReportRow {
  dimensionValues: Record<string, DimValue>;
  metricValues: Record<string, MetricValue>;
}

export const REPORT_METRICS = [
  'ESTIMATED_EARNINGS',
  'IMPRESSIONS',
  'CLICKS',
  'AD_REQUESTS',
  'MATCHED_REQUESTS',
];

/** Wrapper mỏng quanh AdMob API v1 (REST). */
@Injectable()
export class AdmobApiService {
  private readonly logger = new Logger(AdmobApiService.name);

  constructor(private config: ConfigService) {}

  oauthClient(): OAuth2Client {
    return new OAuth2Client(
      this.config.getOrThrow('GOOGLE_CLIENT_ID'),
      this.config.getOrThrow('GOOGLE_CLIENT_SECRET'),
      this.config.getOrThrow('GOOGLE_REDIRECT_URI'),
    );
  }

  clientFor(refreshToken: string): OAuth2Client {
    const client = this.oauthClient();
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  async listAccounts(client: OAuth2Client): Promise<ApiAccount[]> {
    return this.listAll<ApiAccount>(client, `${API}/accounts`, 'account');
  }

  async listApps(client: OAuth2Client, publisherId: string): Promise<ApiApp[]> {
    return this.listAll<ApiApp>(client, `${API}/accounts/${publisherId}/apps`, 'apps');
  }

  async listAdUnits(client: OAuth2Client, publisherId: string): Promise<ApiAdUnit[]> {
    return this.listAll<ApiAdUnit>(client, `${API}/accounts/${publisherId}/adUnits`, 'adUnits');
  }

  /**
   * Mediation report — gồm doanh thu từ AdMob Network và mọi mạng mediation.
   * API trả về 1 mảng JSON: [{header}, {row}, {row}, ..., {footer}].
   */
  async mediationReport(
    client: OAuth2Client,
    publisherId: string,
    from: string,
    to: string,
    dimensions: string[],
    currencyCode: string,
    /** Lọc: dimension -> danh sách giá trị (khớp bất kỳ). */
    filters: Record<string, string[]> = {},
    maxReportRows?: number,
  ): Promise<ReportRow[]> {
    const dimensionFilters = Object.entries(filters)
      .filter(([, values]) => values.length)
      // StringList.values là mảng chuỗi thuần (ví dụ trong tài liệu AdMob dùng {value} là sai).
      .map(([dimension, values]) => ({ dimension, matchesAny: { values } }));
    const res = await client.request<Array<{ row?: ReportRow; footer?: { warnings?: unknown[] } }>>({
      url: `${API}/accounts/${publisherId}/mediationReport:generate`,
      method: 'POST',
      data: {
        reportSpec: {
          dateRange: { startDate: toApiDate(from), endDate: toApiDate(to) },
          dimensions,
          metrics: REPORT_METRICS,
          localizationSettings: { currencyCode },
          ...(dimensionFilters.length ? { dimensionFilters } : {}),
          ...(maxReportRows ? { maxReportRows } : {}),
        },
      },
    });
    const items = Array.isArray(res.data) ? res.data : [res.data];
    const warnings = items.flatMap((i) => i.footer?.warnings ?? []);
    if (warnings.length) this.logger.warn(`Report warnings: ${JSON.stringify(warnings)}`);
    return items.filter((i) => i.row).map((i) => i.row!);
  }

  private async listAll<T>(client: OAuth2Client, url: string, key: string): Promise<T[]> {
    const out: T[] = [];
    let pageToken: string | undefined;
    do {
      const res = await client.request<Record<string, any>>({
        url,
        params: { pageSize: 10000, ...(pageToken ? { pageToken } : {}) },
      });
      out.push(...((res.data[key] as T[]) ?? []));
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    return out;
  }
}

function toApiDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

export function metricInt(row: ReportRow, metric: string): bigint {
  const v = row.metricValues[metric];
  return BigInt(v?.microsValue ?? v?.integerValue ?? 0);
}

export function dim(row: ReportRow, name: string): DimValue {
  return row.dimensionValues[name] ?? {};
}
