import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addDays, toDbDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';

export interface ReportFilter {
  from: string;
  to: string;
  appIds: string[] | null; // null = mọi app
  accountIds?: string[];
  formats?: string[];
  countries?: string[];
}

export type Granularity = 'day' | 'week' | 'month';
export type Dimension = 'app' | 'adUnit' | 'format' | 'country' | 'adSource' | 'account';

interface MetricRow {
  earnings_micros: bigint | null;
  impressions: bigint | null;
  clicks: bigint | null;
  ad_requests: bigint | null;
  matched_requests: bigint | null;
}

const METRICS_SQL = Prisma.sql`
  SUM("earningsMicros")::bigint AS earnings_micros,
  SUM(impressions)::bigint AS impressions,
  SUM(clicks)::bigint AS clicks,
  SUM("adRequests")::bigint AS ad_requests,
  SUM("matchedRequests")::bigint AS matched_requests`;

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async summary(f: ReportFilter) {
    const days = diffDays(f.from, f.to) + 1;
    const prev = { ...f, from: addDays(f.from, -days), to: addDays(f.from, -1) };
    const [current, previous] = await Promise.all([this.totals(f), this.totals(prev)]);
    return { current, previous, previousRange: { from: prev.from, to: prev.to } };
  }

  async timeseries(f: ReportFilter, granularity: Granularity) {
    const bucket = Prisma.raw(`'${granularity}'`);
    const rows = await this.prisma.$queryRaw<(MetricRow & { bucket: Date })[]>`
      SELECT date_trunc(${bucket}, date)::date AS bucket, ${METRICS_SQL}
      FROM "UnitStat" WHERE ${this.where(f)}
      GROUP BY 1 ORDER BY 1`;
    return rows.map((r) => ({ date: r.bucket.toISOString().slice(0, 10), ...metrics(r) }));
  }

  async breakdown(f: ReportFilter, dimension: Dimension, limit = 100) {
    if (dimension === 'adSource') {
      // Ad source chỉ có ở bảng SourceStat, không có chiều country.
      const rows = await this.prisma.$queryRaw<(MetricRow & { key: string; label: string })[]>`
        SELECT "adSourceId" AS key, MAX("adSourceName") AS label, ${METRICS_SQL}
        FROM "SourceStat" WHERE ${this.where({ ...f, countries: undefined })}
        GROUP BY 1 ORDER BY earnings_micros DESC NULLS LAST LIMIT ${limit}`;
      return rows.map((r) => ({ key: r.key, label: r.label, ...metrics(r) }));
    }

    const column = Prisma.raw(
      { app: '"appId"', adUnit: '"adUnitId"', format: 'format', country: 'country', account: '"accountId"' }[
        dimension
      ],
    );
    const rows = await this.prisma.$queryRaw<(MetricRow & { key: string })[]>`
      SELECT ${column} AS key, ${METRICS_SQL}
      FROM "UnitStat" WHERE ${this.where(f)}
      GROUP BY 1 ORDER BY earnings_micros DESC NULLS LAST LIMIT ${limit}`;
    const labels = await this.labels(dimension, rows.map((r) => r.key));
    return rows.map((r) => ({ key: r.key, label: labels.get(r.key) ?? r.key, ...metrics(r) }));
  }

  /** Bảng app x ngày cho trang chi tiết. */
  async appDaily(f: ReportFilter) {
    const rows = await this.prisma.$queryRaw<(MetricRow & { date: Date; app_id: string })[]>`
      SELECT date, "appId" AS app_id, ${METRICS_SQL}
      FROM "UnitStat" WHERE ${this.where(f)}
      GROUP BY 1, 2 ORDER BY 1 DESC, earnings_micros DESC`;
    const labels = await this.labels('app', [...new Set(rows.map((r) => r.app_id))]);
    return rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      appId: r.app_id,
      appName: labels.get(r.app_id) ?? r.app_id,
      ...metrics(r),
    }));
  }

  async filterOptions(appIds: string[] | null) {
    const where = appIds === null ? Prisma.sql`TRUE` : inList('"appId"', appIds);
    const [formats, countries] = await Promise.all([
      this.prisma.$queryRaw<{ v: string }[]>`SELECT DISTINCT format AS v FROM "UnitStat" WHERE ${where} ORDER BY 1`,
      this.prisma.$queryRaw<{ v: string }[]>`SELECT DISTINCT country AS v FROM "UnitStat" WHERE ${where} ORDER BY 1`,
    ]);
    return { formats: formats.map((r) => r.v), countries: countries.map((r) => r.v) };
  }

  private async totals(f: ReportFilter) {
    const [row] = await this.prisma.$queryRaw<MetricRow[]>`
      SELECT ${METRICS_SQL} FROM "UnitStat" WHERE ${this.where(f)}`;
    return metrics(row);
  }

  private where(f: ReportFilter): Prisma.Sql {
    const parts = [Prisma.sql`date BETWEEN ${f.from}::date AND ${f.to}::date`];
    if (f.appIds !== null) parts.push(inList('"appId"', f.appIds));
    if (f.accountIds?.length) parts.push(inList('"accountId"', f.accountIds));
    if (f.formats?.length) parts.push(inList('format', f.formats));
    if (f.countries?.length) parts.push(inList('country', f.countries));
    return Prisma.join(parts, ' AND ');
  }

  private async labels(dimension: Dimension, keys: string[]): Promise<Map<string, string>> {
    if (!keys.length) return new Map();
    if (dimension === 'app') {
      const apps = await this.prisma.app.findMany({ where: { id: { in: keys } }, select: { id: true, name: true } });
      return new Map(apps.map((a) => [a.id, a.name]));
    }
    if (dimension === 'adUnit') {
      const units = await this.prisma.adUnit.findMany({
        where: { id: { in: keys } },
        select: { id: true, name: true, app: { select: { name: true } } },
      });
      return new Map(units.map((u) => [u.id, `${u.name} · ${u.app.name}`]));
    }
    if (dimension === 'account') {
      const accounts = await this.prisma.admobAccount.findMany({
        where: { id: { in: keys } },
        select: { id: true, name: true },
      });
      return new Map(accounts.map((a) => [a.id, a.name]));
    }
    return new Map();
  }
}

function inList(column: string, values: string[]): Prisma.Sql {
  // IN () rỗng là lỗi cú pháp; danh sách rỗng nghĩa là không có quyền xem gì.
  if (!values.length) return Prisma.sql`FALSE`;
  return Prisma.sql`${Prisma.raw(column)} IN (${Prisma.join(values)})`;
}

function metrics(r: MetricRow | undefined) {
  const earnings = Number(r?.earnings_micros ?? 0) / 1e6;
  const impressions = Number(r?.impressions ?? 0);
  const clicks = Number(r?.clicks ?? 0);
  const adRequests = Number(r?.ad_requests ?? 0);
  const matchedRequests = Number(r?.matched_requests ?? 0);
  return {
    earnings,
    impressions,
    clicks,
    adRequests,
    matchedRequests,
    ecpm: impressions ? (earnings / impressions) * 1000 : 0,
    ctr: impressions ? clicks / impressions : 0,
    matchRate: adRequests ? matchedRequests / adRequests : 0,
    showRate: matchedRequests ? impressions / matchedRequests : 0,
  };
}

function diffDays(from: string, to: string) {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000);
}
