import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdmobApiService, dim, metricInt, ReportRow } from '../admob/admob-api.service';
import { decrypt } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

/** Chiều người dùng chọn được -> dimension của AdMob mediation report. */
export const EXPLORE_DIMENSIONS = {
  date: 'DATE',
  account: null, // không phải dimension của AdMob: mỗi tài khoản là 1 lần gọi API riêng
  app: 'APP',
  adUnit: 'AD_UNIT',
  format: 'FORMAT',
  adSource: 'AD_SOURCE',
  country: 'COUNTRY',
  appVersion: 'APP_VERSION_NAME',
} as const;

export type ExploreDimension = keyof typeof EXPLORE_DIMENSIONS;

export interface ExploreQuery {
  from: string;
  to: string;
  dimensions: ExploreDimension[];
  /** null = mọi app user được xem (admin: tất cả). */
  appIds: string[] | null;
  adUnitIds?: string[];
  adSourceIds?: string[];
  appVersions?: string[];
  countries?: string[];
  formats?: string[];
}

/** Giới hạn số dòng trả về trình duyệt (bảng to hơn thì nên lọc thêm). */
const MAX_ROWS = 5000;

/**
 * Bảng phân tích tuỳ chọn chiều, lấy trực tiếp từ AdMob API (không qua DB) nên có cả các chiều không lưu sẵn
 * như App version. Mỗi tài khoản AdMob = 1 lần gọi API.
 */
@Injectable()
export class ExploreService {
  constructor(
    private prisma: PrismaService,
    private api: AdmobApiService,
    private config: ConfigService,
  ) {}

  async run(q: ExploreQuery) {
    if (!q.dimensions.length) throw new BadRequestException('Chọn ít nhất 1 dimension');
    const currency = this.config.get('REPORT_CURRENCY', 'USD');
    // AdMob không cho lọc theo APP_VERSION_NAME (chỉ cho chia nhóm): khi lọc version thì lấy thêm chiều version,
    // lọc ở đây rồi cộng gộp lại theo đúng các chiều user chọn.
    const versionFilter = q.appVersions?.length ? new Set(q.appVersions) : null;
    const fetchDims: ExploreDimension[] =
      versionFilter && !q.dimensions.includes('appVersion') ? [...q.dimensions, 'appVersion'] : q.dimensions;
    const admobDims = fetchDims.map((d) => EXPLORE_DIMENSIONS[d]).filter((d): d is NonNullable<typeof d> => !!d);

    // Tài khoản cần gọi: tài khoản chứa app được xem / được lọc.
    const apps = await this.prisma.app.findMany({
      where: q.appIds === null ? {} : { id: { in: q.appIds } },
      select: { id: true, name: true, accountId: true },
    });
    const byAccount = new Map<string, string[]>();
    for (const a of apps) byAccount.set(a.accountId, [...(byAccount.get(a.accountId) ?? []), a.id]);
    const accounts = await this.prisma.admobAccount.findMany({ where: { id: { in: [...byAccount.keys()] } } });

    const rows = (
      await Promise.all(
        accounts.map(async (acc) => {
          const client = this.api.clientFor(decrypt(acc.refreshTokenEnc));
          const report = await this.api.mediationReport(client, acc.publisherId, q.from, q.to, admobDims, currency, {
            // Luôn lọc theo app để người không phải admin không thấy app ngoài quyền.
            APP: q.appIds === null ? [] : byAccount.get(acc.id)!,
            AD_UNIT: q.adUnitIds ?? [],
            AD_SOURCE: q.adSourceIds ?? [],
            COUNTRY: q.countries ?? [],
            FORMAT: (q.formats ?? []).map((f) => f.toLowerCase()),
          }, 100_000).catch((e: any) => {
            // Lỗi AdMob (400 sai tham số, 403 hết quyền…) trả về trình duyệt kèm lý do thay vì "Internal server error".
            const data = e?.response?.data;
            const message = (Array.isArray(data) ? data[0]?.error?.message : data?.error?.message) ?? e?.message;
            throw new BadGatewayException(`AdMob ${acc.publisherId}: ${message}`);
          });
          let accRows = report.map((r) => toRow(r, fetchDims, acc.name));
          if (versionFilter) {
            accRows = accRows.filter((r) => versionFilter.has(r.appVersion!));
            if (fetchDims !== q.dimensions) accRows = regroup(accRows, q.dimensions);
          }
          return accRows;
        }),
      )
    ).flat();

    rows.sort((a, b) => b.earnings - a.earnings);
    const appNames = new Map(apps.map((a) => [a.id, a.name]));
    for (const r of rows) if (r.app) r.appName = appNames.get(r.app) ?? r.appName;
    return { rows: rows.slice(0, MAX_ROWS), totalRows: rows.length, truncated: rows.length > MAX_ROWS, totals: totals(rows) };
  }

  /** Giá trị cho các ô lọc: ad unit, ad source, app version, quốc gia trong khoảng ngày. */
  async options(q: Pick<ExploreQuery, 'from' | 'to' | 'appIds'>) {
    const result = await this.run({ ...q, dimensions: ['adUnit', 'adSource', 'appVersion', 'country'] });
    const uniq = (pick: (r: (typeof result.rows)[number]) => [string, string] | null) => {
      const m = new Map<string, string>();
      for (const r of result.rows) {
        const kv = pick(r);
        if (kv && kv[0]) m.set(kv[0], kv[1]);
      }
      return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    };
    return {
      adUnits: uniq((r) => [r.adUnit!, r.adUnitName ?? r.adUnit!]),
      adSources: uniq((r) => [r.adSource!, r.adSourceName ?? r.adSource!]),
      appVersions: uniq((r) => [r.appVersion!, r.appVersion!]).sort((a, b) => compareVersions(b.value, a.value)),
      countries: uniq((r) => [r.country!, r.country!]),
    };
  }
}

interface ExploreRow {
  date?: string;
  account?: string;
  app?: string;
  appName?: string;
  adUnit?: string;
  adUnitName?: string;
  format?: string;
  adSource?: string;
  adSourceName?: string;
  country?: string;
  appVersion?: string;
  earnings: number;
  impressions: number;
  clicks: number;
  adRequests: number;
  matchedRequests: number;
  ecpm: number;
  matchRate: number;
  showRate: number;
  ctr: number;
}

function toRow(r: ReportRow, dims: ExploreDimension[], accountName: string): ExploreRow {
  const row = withRatios({
    earnings: Number(metricInt(r, 'ESTIMATED_EARNINGS')) / 1e6,
    impressions: Number(metricInt(r, 'IMPRESSIONS')),
    clicks: Number(metricInt(r, 'CLICKS')),
    adRequests: Number(metricInt(r, 'AD_REQUESTS')),
    matchedRequests: Number(metricInt(r, 'MATCHED_REQUESTS')),
  }) as ExploreRow;
  if (dims.includes('date')) {
    const d = dim(r, 'DATE').value ?? '';
    row.date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  if (dims.includes('account')) row.account = accountName;
  if (dims.includes('app') || dims.includes('adUnit')) {
    row.app = dim(r, 'APP').value;
    row.appName = dim(r, 'APP').displayLabel ?? row.app;
  }
  if (dims.includes('adUnit')) {
    row.adUnit = dim(r, 'AD_UNIT').value;
    row.adUnitName = dim(r, 'AD_UNIT').displayLabel ?? row.adUnit;
  }
  if (dims.includes('format')) row.format = (dim(r, 'FORMAT').value ?? '').toUpperCase();
  if (dims.includes('adSource')) {
    row.adSource = dim(r, 'AD_SOURCE').value;
    row.adSourceName = dim(r, 'AD_SOURCE').displayLabel ?? row.adSource;
  }
  if (dims.includes('country')) row.country = dim(r, 'COUNTRY').value ?? 'ZZ';
  if (dims.includes('appVersion')) row.appVersion = dim(r, 'APP_VERSION_NAME').value || '(không rõ)';
  return row;
}

function withRatios(m: { earnings: number; impressions: number; clicks: number; adRequests: number; matchedRequests: number }) {
  return {
    ...m,
    ecpm: m.impressions ? (m.earnings / m.impressions) * 1000 : 0,
    matchRate: m.adRequests ? m.matchedRequests / m.adRequests : 0,
    showRate: m.matchedRequests ? m.impressions / m.matchedRequests : 0,
    ctr: m.impressions ? m.clicks / m.impressions : 0,
  };
}

const DIM_FIELDS: Record<ExploreDimension, (keyof ExploreRow)[]> = {
  date: ['date'],
  account: ['account'],
  app: ['app', 'appName'],
  adUnit: ['adUnit', 'adUnitName', 'app', 'appName'],
  format: ['format'],
  adSource: ['adSource', 'adSourceName'],
  country: ['country'],
  appVersion: ['appVersion'],
};

/** Cộng gộp các dòng theo đúng các chiều đã chọn (bỏ chiều phụ đã lấy thêm để lọc). */
function regroup(rows: ExploreRow[], dims: ExploreDimension[]): ExploreRow[] {
  const fields = [...new Set(dims.flatMap((d) => DIM_FIELDS[d]))];
  const groups = new Map<string, ExploreRow>();
  for (const r of rows) {
    const key = fields.map((f) => r[f] ?? '').join('\u0001');
    const g = groups.get(key);
    if (!g) {
      const base = Object.fromEntries(fields.map((f) => [f, r[f]])) as Partial<ExploreRow>;
      groups.set(key, { ...base, earnings: r.earnings, impressions: r.impressions, clicks: r.clicks,
        adRequests: r.adRequests, matchedRequests: r.matchedRequests } as ExploreRow);
    } else {
      g.earnings += r.earnings;
      g.impressions += r.impressions;
      g.clicks += r.clicks;
      g.adRequests += r.adRequests;
      g.matchedRequests += r.matchedRequests;
    }
  }
  return [...groups.values()].map((g) => ({ ...g, ...withRatios(g) }));
}

function totals(rows: ExploreRow[]) {
  const sum = (k: 'earnings' | 'impressions' | 'clicks' | 'adRequests' | 'matchedRequests') =>
    rows.reduce((s, r) => s + r[k], 0);
  return withRatios({
    earnings: sum('earnings'),
    impressions: sum('impressions'),
    clicks: sum('clicks'),
    adRequests: sum('adRequests'),
    matchedRequests: sum('matchedRequests'),
  });
}

/** "1.2.10" > "1.2.9" */
function compareVersions(a: string, b: string) {
  const pa = a.split(/[.\-]/).map((x) => Number(x) || 0);
  const pb = b.split(/[.\-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}
