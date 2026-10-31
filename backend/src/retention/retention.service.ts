import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { GoogleAuth } from 'google-auth-library';
import { batches } from '../common/batches';
import { addDays, toDbDate, todayIn } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';

/** Lưu đường retention từ D0 tới D{MAX_DAY}. */
export const MAX_DAY = 60;
/** Mỗi lần đồng bộ lấy lại cohort của chừng ấy ngày để D60 kịp đủ (+ vài ngày GA4 xử lý trễ). */
const SYNC_DAYS = MAX_DAY + 3;
/** Số cohort mỗi lần gọi GA4 (1 cohort = 1 ngày cài). */
const COHORTS_PER_REQUEST = 31;
const PAGE_SIZE = 100000;
/** 1 ô (ngày cài x nước x nguồn) được gán 1 phiên bản khi ít nhất tỷ lệ này người dùng ngày cài dùng phiên bản đó. */
const DOMINANT_SHARE = 0.9;
/** Ô có nhiều phiên bản trong ngày cài (không phiên bản nào chiếm DOMINANT_SHARE). */
export const MIXED_VERSION = 'mixed';
/** Số ngày gần nhất lấy lại doanh thu theo ngày cài mỗi lần đồng bộ. */
const REVENUE_DAYS = 14;
/** ROAS theo GA4: lấy lại người cài chừng ấy ngày gần nhất (D30 cần 31 ngày + vài ngày GA4 còn điều chỉnh). */
const CAMPAIGN_REVENUE_DAYS = 45;
/** Cột ngày cài chiếm ≤ ngưỡng này trên tổng doanh thu của khoảng đang xem thì gộp vào cột "trước đó". */
const MERGE_SHARE = 0.01;
/** Mốc trả về cho bảng theo nước (Ranking Finance). */
const COUNTRY_DAYS = [1, 3, 7, 14, 30] as const;

export type CompareDimension = 'country' | 'source' | 'version';

interface Ga4Row {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

interface Filter {
  from: string;
  to: string;
  countries?: string[];
  sources?: string[];
  versions?: string[];
}

/** 1 ô dữ liệu: ngày cài x nước x nguồn, kèm phiên bản cài ước tính. */
interface Cell {
  date: string;
  country: string;
  source: string;
  version: string;
  newUsers: number;
  /** active[n] = số người còn hoạt động ngày thứ n; chỉ có các ngày đã đủ. */
  active: number[];
}

/**
 * Retention theo ngày cài từ GA4 Data API (cohort theo firstSessionDate), chia theo nước và nguồn cài đầu tiên,
 * lưu đủ D0..D60. Phiên bản cài ước tính từ phiên bản người dùng dùng trong ngày cài.
 * Dùng service account (GA4_KEY_FILE) đã được cấp quyền Viewer trên property GA4_PROPERTY_ID.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private running = false;
  private auth: GoogleAuth | null = null;
  lastSyncedAt: Date | null = null;
  lastError: string | null = null;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  get enabled() {
    return !!this.config.get('GA4_PROPERTY_ID') && !!this.config.get('GA4_KEY_FILE');
  }

  isRunning() {
    return this.running;
  }

  /** Lúc khởi động: dữ liệu trống (ví dụ vừa đổi cấu trúc) thì tải lại ngay. */
  async onApplicationBootstrap() {
    if (this.enabled && !(await this.prisma.retentionStat.count())) this.start();
  }

  /** Mỗi 3 tiếng: GA4 chỉ cập nhật vài lần/ngày nên gọi dày hơn không có số mới. */
  @Cron('0 5 */3 * * *')
  async scheduled() {
    await this.sync().catch(() => undefined);
  }

  /** Chạy nền, trả về ngay. */
  start() {
    if (!this.enabled || this.running) return false;
    this.sync().catch(() => undefined);
    return true;
  }

  async sync(days = SYNC_DAYS) {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const timeZone = this.config.get('GA4_TIME_ZONE', 'Asia/Ho_Chi_Minh');
      // GA4 xử lý số của 1 ngày xong vào khoảng ngày hôm sau, nên coi hôm qua như chưa xong: cohort mới nhất là
      // hôm kia, và ngày thứ n chỉ có số khi ngày cài + n ≤ hôm kia.
      const today = addDays(todayIn(timeZone), -1);
      const to = addDays(today, -1);
      const from = addDays(to, -(days - 1));
      const dates: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);

      let rowCount = 0;
      for (let i = 0; i < dates.length; i += COHORTS_PER_REQUEST) {
        const chunk = dates.slice(i, i + COHORTS_PER_REQUEST);
        const [curves, versions] = [await this.fetchCurves(chunk, today), await this.fetchInstallVersions(chunk)];
        const range = { date: { gte: toDbDate(chunk[0]), lte: toDbDate(chunk.at(-1)!) } };
        await this.prisma.$transaction([
          this.prisma.retentionStat.deleteMany({ where: range }),
          this.prisma.retentionInstallVersion.deleteMany({ where: range }),
          ...batches(curves).map((d) => this.prisma.retentionStat.createMany({ data: d })),
          ...batches(versions).map((d) => this.prisma.retentionInstallVersion.createMany({ data: d })),
        ]);
        rowCount += curves.length;
      }
      // Doanh thu quảng cáo theo ngày cài: lấy lại REVENUE_DAYS ngày gần nhất (GA4 còn điều chỉnh vài ngày sau).
      const revFrom = addDays(todayIn(timeZone), -(REVENUE_DAYS - 1));
      const revenue = await this.fetchRevenueByInstallDate(revFrom, todayIn(timeZone));
      await this.prisma.$transaction([
        this.prisma.revenueCohortStat.deleteMany({ where: { date: { gte: toDbDate(revFrom) } } }),
        ...batches(revenue).map((d) => this.prisma.revenueCohortStat.createMany({ data: d })),
      ]);
      // Doanh thu GA4 theo chiến dịch Google Ads x ngày cài x số ngày sau cài (cột ROAS theo GA4 trên trang Google Ads).
      const campFrom = addDays(todayIn(timeZone), -(CAMPAIGN_REVENUE_DAYS - 1));
      const campaignRevenue = await this.fetchCampaignRevenue(campFrom, todayIn(timeZone));
      await this.prisma.$transaction([
        this.prisma.gaCampaignRevenue.deleteMany({ where: { installDate: { gte: toDbDate(campFrom) } } }),
        ...batches(campaignRevenue).map((d) => this.prisma.gaCampaignRevenue.createMany({ data: d })),
      ]);
      this.lastSyncedAt = new Date();
      this.lastError = null;
      this.logger.log(`GA4 retention ${from}..${to}: ${rowCount} rows`);
    } catch (e: any) {
      this.lastError = (e?.message ?? String(e)).slice(0, 1000);
      this.logger.error(`GA4 retention failed: ${this.lastError}`);
      throw e;
    } finally {
      this.running = false;
    }
  }

  /** Đường retention D0..D60 cho mỗi ngày cài x nước x nguồn. */
  private async fetchCurves(dates: string[], today: string): Promise<Prisma.RetentionStatCreateManyInput[]> {
    const rows = await this.runReport({
      dimensions: [{ name: 'cohort' }, { name: 'cohortNthDay' }, { name: 'countryId' }, { name: 'firstUserSource' }],
      metrics: [{ name: 'cohortActiveUsers' }, { name: 'cohortTotalUsers' }],
      cohortSpec: {
        cohorts: dates.map((d) => ({ name: d, dimension: 'firstSessionDate', dateRange: { startDate: d, endDate: d } })),
        cohortsRange: { granularity: 'DAILY', startOffset: 0, endOffset: MAX_DAY },
      },
    });

    const out = new Map<string, Prisma.RetentionStatCreateManyInput & { active: number[] }>();
    for (const r of rows) {
      const [date, nth, countryId, source] = r.dimensionValues.map((v) => v.value);
      const country = /^[A-Z]{2}$/.test(countryId) ? countryId : 'ZZ';
      const key = `${date}|${country}|${source}`;
      let row = out.get(key);
      if (!row) {
        // Ngày thứ n đã đủ khi ngày cài + n < today (đã lùi 1 ngày); ngày đủ mà GA4 không trả dòng = 0 người.
        const complete = Math.min(MAX_DAY + 1, daysBetween(date, today));
        row = { date: toDbDate(date), country, source: source || '(not set)', newUsers: 0, active: new Array(complete).fill(0) };
        out.set(key, row);
      }
      const n = Number(nth);
      row.newUsers = Math.max(row.newUsers, Number(r.metricValues[1].value));
      if (n < row.active.length) row.active[n] = Number(r.metricValues[0].value);
    }
    return [...out.values()];
  }

  /** Số người dùng theo phiên bản app trong ngày cài (ngày 0) của mỗi ngày cài x nước x nguồn. */
  private async fetchInstallVersions(dates: string[]): Promise<Prisma.RetentionInstallVersionCreateManyInput[]> {
    const rows = await this.runReport({
      dimensions: [
        { name: 'cohort' }, { name: 'cohortNthDay' }, { name: 'countryId' }, { name: 'firstUserSource' }, { name: 'appVersion' },
      ],
      metrics: [{ name: 'cohortActiveUsers' }],
      cohortSpec: {
        cohorts: dates.map((d) => ({ name: d, dimension: 'firstSessionDate', dateRange: { startDate: d, endDate: d } })),
        // GA4 bắt buộc endOffset > 0; chỉ lấy ngày 0 bằng bộ lọc.
        cohortsRange: { granularity: 'DAILY', startOffset: 0, endOffset: 1 },
      },
      dimensionFilter: { filter: { fieldName: 'cohortNthDay', stringFilter: { value: '0000' } } },
    });
    const out = new Map<string, Prisma.RetentionInstallVersionCreateManyInput>();
    for (const r of rows) {
      const [date, , countryId, source, version] = r.dimensionValues.map((v) => v.value);
      const country = /^[A-Z]{2}$/.test(countryId) ? countryId : 'ZZ';
      const appVersion = version && version !== '(not set)' ? version : '?';
      const key = `${date}|${country}|${source}|${appVersion}`;
      const row = out.get(key) ?? { date: toDbDate(date), country, source: source || '(not set)', appVersion, users: 0 };
      row.users += Number(r.metricValues[0].value);
      out.set(key, row);
    }
    return [...out.values()];
  }

  /** Doanh thu quảng cáo (GA4 totalAdRevenue) mỗi ngày, chia theo ngày cài (firstSessionDate) của người dùng. */
  private async fetchRevenueByInstallDate(from: string, to: string): Promise<Prisma.RevenueCohortStatCreateManyInput[]> {
    const rows = await this.runReport({
      dateRanges: [{ startDate: from, endDate: to }],
      dimensions: [{ name: 'date' }, { name: 'firstSessionDate' }],
      metrics: [{ name: 'totalAdRevenue' }, { name: 'activeUsers' }],
    });
    const ymd = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    return rows
      .map((r) => {
        const [date, first] = r.dimensionValues.map((v) => v.value);
        return {
          date: toDbDate(ymd(date)),
          installDate: /^\d{8}$/.test(first) ? toDbDate(ymd(first)) : null,
          revenueMicros: BigInt(Math.round(Number(r.metricValues[0].value) * 1e6)),
          users: Number(r.metricValues[1].value),
        };
      })
      .filter((r) => r.revenueMicros > 0n || r.users > 0);
  }

  /**
   * Ma trận doanh thu theo ngày cài: mỗi dòng là 1 ngày phát sinh doanh thu, mỗi cột là 1 ngày cài. Ngày cài trong
   * khoảng đang xem luôn có cột; ngày cài trước khoảng đó chiếm ≤ 1% tổng doanh thu được gộp vào cột "trước đó".
   */
  async revenueByInstallDate(q: { from: string; to: string }) {
    const rows = await this.prisma.revenueCohortStat.findMany({
      where: { date: { gte: toDbDate(q.from), lte: toDbDate(q.to) } },
      select: { date: true, installDate: true, revenueMicros: true, users: true },
    });
    const key = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : 'unknown');
    const total = rows.reduce((s, r) => s + Number(r.revenueMicros), 0);
    const byInstall = new Map<string, number>();
    for (const r of rows) byInstall.set(key(r.installDate), (byInstall.get(key(r.installDate)) ?? 0) + Number(r.revenueMicros));

    // Ngày cài trong khoảng đang xem luôn có cột riêng (kể cả hôm nay mới có ít doanh thu). Ngày cài trước khoảng đó:
    // giữ cột từ mới nhất trở về, dừng ở ngày đầu tiên chiếm ≤ 1%; ngày đó và mọi ngày cũ hơn gộp thành "trước đó".
    const dates = [...byInstall.keys()].filter((k) => k !== 'unknown').sort().reverse();
    const kept: string[] = dates.filter((d) => d >= q.from);
    for (const d of dates.filter((d) => d < q.from)) {
      if (total && byInstall.get(d)! / total <= MERGE_SHARE) break;
      kept.push(d);
    }
    const keep = new Set(kept);
    const oldest = kept.at(-1);
    const column = (install: string) => (install === 'unknown' ? 'unknown' : keep.has(install) ? install : 'earlier');

    const days = new Map<string, { date: string; total: number; cells: Record<string, { revenue: number; users: number }> }>();
    for (const r of rows) {
      const date = key(r.date);
      const d = days.get(date) ?? { date, total: 0, cells: {} };
      const col = column(key(r.installDate));
      const cell = (d.cells[col] ??= { revenue: 0, users: 0 });
      const rev = Number(r.revenueMicros) / 1e6;
      cell.revenue += rev;
      cell.users += r.users;
      d.total += rev;
      days.set(date, d);
    }
    // Chi phí quảng cáo cả các kênh (Facebook, Google Ads…) của từng ngày cài đang hiện thành cột, USD.
    const spendRows = kept.length
      ? await this.prisma.adSpendStat.groupBy({
          by: ['date', 'source'],
          where: { date: { gte: toDbDate(oldest!), lte: toDbDate(kept[0]) } },
          _sum: { spendMicros: true, convValueMicros: true },
        })
      : [];
    // googleValue: doanh thu Google Ads tự ghi nhận (conversion value) cho click/cài của ngày đó.
    const spend: Record<string, { total: number; bySource: Record<string, number>; googleValue: number }> = {};
    for (const r of spendRows) {
      const v = Number(r._sum.spendMicros ?? 0) / 1e6;
      const s = (spend[key(r.date)] ??= { total: 0, bySource: {}, googleValue: 0 });
      s.total += v;
      s.bySource[r.source] = (s.bySource[r.source] ?? 0) + v;
      if (r.source === 'google') s.googleValue += Number(r._sum.convValueMicros ?? 0) / 1e6;
    }
    const used = new Set([...days.values()].flatMap((d) => Object.keys(d.cells)));
    return {
      columns: [...kept, ...(used.has('earlier') ? ['earlier'] : []), ...(used.has('unknown') ? ['unknown'] : [])],
      earlierBefore: oldest ?? null,
      spend,
      rows: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)),
    };
  }

  /**
   * Doanh thu quảng cáo (totalAdRevenue) của người dùng nguồn google cài trong [from, to], theo chiến dịch đầu tiên
   * (firstUserCampaignId) x ngày cài x ngày phát sinh, kèm số người mới của chiến dịch trong ngày cài.
   */
  private async fetchCampaignRevenue(from: string, to: string): Promise<Prisma.GaCampaignRevenueCreateManyInput[]> {
    const ymd = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
    const installs: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) installs.push(d.replace(/-/g, ''));
    const google = { filter: { fieldName: 'firstUserSource', stringFilter: { value: 'google' } } };
    const [revenue, users] = await Promise.all([
      this.runReport({
        dateRanges: [{ startDate: from, endDate: to }],
        dimensions: [{ name: 'firstSessionDate' }, { name: 'date' }, { name: 'firstUserCampaignId' }, { name: 'firstUserCampaignName' }],
        metrics: [{ name: 'totalAdRevenue' }],
        dimensionFilter: { andGroup: { expressions: [google, { filter: { fieldName: 'firstSessionDate', inListFilter: { values: installs } } }] } },
      }),
      this.runReport({
        dateRanges: [{ startDate: from, endDate: to }],
        dimensions: [{ name: 'date' }, { name: 'firstUserCampaignId' }, { name: 'firstUserCampaignName' }],
        metrics: [{ name: 'newUsers' }],
        dimensionFilter: google,
      }),
    ]);
    const out = new Map<string, Prisma.GaCampaignRevenueCreateManyInput>();
    const row = (install: string, id: string, name: string, dayN: number) => {
      const k = `${install}|${id}|${dayN}`;
      const r = out.get(k) ?? { installDate: toDbDate(install), campaignId: id, campaignName: name, dayN, revenueMicros: 0n, users: 0 };
      out.set(k, r);
      return r;
    };
    for (const r of revenue) {
      const [first, date, id, name] = r.dimensionValues.map((v) => v.value);
      if (!/^\d{8}$/.test(first)) continue;
      const dayN = daysBetween(ymd(first), ymd(date));
      if (dayN < 0) continue;
      const x = row(ymd(first), id, name, dayN);
      x.revenueMicros = BigInt(x.revenueMicros as bigint) + BigInt(Math.round(Number(r.metricValues[0].value) * 1e6));
    }
    for (const r of users) {
      const [date, id, name] = r.dimensionValues.map((v) => v.value);
      row(ymd(date), id, name, 0).users = Number(r.metricValues[0].value);
    }
    return [...out.values()].filter((r) => (r.revenueMicros as bigint) > 0n || (r.users ?? 0) > 0);
  }

  private async runReport(body: Record<string, unknown>): Promise<Ga4Row[]> {
    this.auth ??= new GoogleAuth({
      keyFile: this.config.getOrThrow('GA4_KEY_FILE'),
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });
    const client = await this.auth.getClient();
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${this.config.getOrThrow('GA4_PROPERTY_ID')}:runReport`;
    const out: Ga4Row[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await client.request<{ rows?: Ga4Row[]; rowCount?: number }>({
            method: 'POST', url, data: { ...body, limit: PAGE_SIZE, offset },
          });
          out.push(...(res.data.rows ?? []));
          if (offset + PAGE_SIZE >= (res.data.rowCount ?? 0)) return out;
          break;
        } catch (e: any) {
          const status = e?.response?.status;
          if ((!status || status === 429 || status >= 500) && attempt < 4) {
            await new Promise((r) => setTimeout(r, 3000 * attempt));
            continue;
          }
          throw new Error(`GA4: ${e?.response?.data?.error?.message ?? e.message}`);
        }
      }
    }
  }

  /**
   * Các ô ngày cài x nước x nguồn trong khoảng ngày, kèm phiên bản cài ước tính: phiên bản chiếm ≥ 90% người dùng
   * của ngày cài, ngược lại là MIXED_VERSION ("?" khi GA4 không có phiên bản).
   */
  private async cells(f: Filter): Promise<Cell[]> {
    const where = {
      date: { gte: toDbDate(f.from), lte: toDbDate(f.to) },
      ...(f.countries?.length ? { country: { in: f.countries } } : {}),
      ...(f.sources?.length ? { source: { in: f.sources } } : {}),
    };
    const [stats, versions] = await Promise.all([
      this.prisma.retentionStat.findMany({ where, select: { date: true, country: true, source: true, newUsers: true, active: true } }),
      this.prisma.retentionInstallVersion.findMany({ where, select: { date: true, country: true, source: true, appVersion: true, users: true } }),
    ]);
    const byCell = new Map<string, { version: string; users: number }[]>();
    for (const v of versions) {
      const key = `${v.date.toISOString().slice(0, 10)}|${v.country}|${v.source}`;
      byCell.set(key, [...(byCell.get(key) ?? []), { version: v.appVersion, users: v.users }]);
    }
    const dominant = (key: string) => {
      const list = byCell.get(key);
      if (!list?.length) return '?';
      const total = list.reduce((s, v) => s + v.users, 0);
      const top = list.reduce((a, b) => (b.users > a.users ? b : a));
      return total && top.users / total >= DOMINANT_SHARE ? top.version : MIXED_VERSION;
    };
    return stats
      .map((s) => {
        const date = s.date.toISOString().slice(0, 10);
        return { date, country: s.country, source: s.source, newUsers: s.newUsers, active: s.active,
          version: dominant(`${date}|${s.country}|${s.source}`) };
      })
      .filter((c) => !f.versions?.length || f.versions.includes(c.version));
  }

  /** Retention theo ngày cài: số người dùng mới và số còn hoạt động từng ngày (chỉ các ngày đã đủ). */
  async byDate(f: Filter) {
    const out = new Map<string, { date: string; newUsers: number; active: number[] }>();
    for (const c of await this.cells(f)) {
      const d = out.get(c.date);
      if (!d) {
        out.set(c.date, { date: c.date, newUsers: c.newUsers, active: [...c.active] });
        continue;
      }
      d.newUsers += c.newUsers;
      // Mọi ô cùng ngày cài có cùng số ngày đã đủ; lấy độ dài nhỏ nhất cho chắc.
      d.active.length = Math.min(d.active.length, c.active.length);
      for (let n = 0; n < d.active.length; n++) d.active[n] += c.active[n];
    }
    return [...out.values()].sort((a, b) => b.date.localeCompare(a.date));
  }

  /** Tỷ lệ retention theo nước (mốc DN chỉ tính các ngày cài đã đủ N ngày). */
  async byCountry(f: Filter) {
    const out = new Map<string, { country: string; newUsers: number; hit: number[]; base: number[] }>();
    for (const c of await this.cells(f)) {
      const r = out.get(c.country) ?? { country: c.country, newUsers: 0, hit: COUNTRY_DAYS.map(() => 0), base: COUNTRY_DAYS.map(() => 0) };
      r.newUsers += c.newUsers;
      COUNTRY_DAYS.forEach((n, i) => {
        if (n >= c.active.length) return;
        r.hit[i] += c.active[n];
        r.base[i] += c.newUsers;
      });
      out.set(c.country, r);
    }
    return [...out.values()].map((r) => ({
      country: r.country,
      newUsers: r.newUsers,
      ...Object.fromEntries(COUNTRY_DAYS.map((n, i) => [`d${n}`, r.base[i] ? r.hit[i] / r.base[i] : null])),
    }));
  }

  /**
   * So sánh retention ngày thứ `day` giữa 2 khoảng ngày cài và tách phần chênh lệch theo nhóm (nước / nguồn /
   * phiên bản): "do tỷ trọng" = nhóm thay đổi tỷ lệ người dùng mới, "do retention" = retention trong nhóm thay đổi.
   * Hai phần cộng lại đúng bằng chênh lệch tổng. Chỉ tính các ngày cài đã đủ `day` ngày.
   */
  async compare(q: Omit<Filter, 'from' | 'to'> & { a: { from: string; to: string }; b: { from: string; to: string };
    day: number; by: CompareDimension }) {
    const key = (c: Cell) => (q.by === 'country' ? c.country : q.by === 'source' ? c.source : c.version);
    const collect = async (range: { from: string; to: string }) => {
      const groups = new Map<string, { users: number; active: number }>();
      let users = 0;
      let active = 0;
      for (const c of await this.cells({ ...q, ...range })) {
        if (q.day >= c.active.length) continue;
        const g = groups.get(key(c)) ?? { users: 0, active: 0 };
        g.users += c.newUsers;
        g.active += c.active[q.day];
        groups.set(key(c), g);
        users += c.newUsers;
        active += c.active[q.day];
      }
      return { groups, users, active, rate: users ? active / users : null };
    };
    const [a, b] = await Promise.all([collect(q.a), collect(q.b)]);
    const period = (p: typeof a, range: { from: string; to: string }) => ({ ...range, users: p.users, rate: p.rate });
    if (!a.users || !b.users) return { day: q.day, by: q.by, a: period(a, q.a), b: period(b, q.b), segments: [] };

    const rateA = a.rate!;
    const rateB = b.rate!;
    let segments = [...new Set([...a.groups.keys(), ...b.groups.keys()])].map((s) => {
      const ga = a.groups.get(s) ?? { users: 0, active: 0 };
      const gb = b.groups.get(s) ?? { users: 0, active: 0 };
      // Nhóm không có ở kỳ trước: coi retention kỳ trước bằng mức chung của kỳ trước.
      const rA = ga.users ? ga.active / ga.users : rateA;
      const rB = gb.users ? gb.active / gb.users : rA;
      const shareA = ga.users / a.users;
      const shareB = gb.users / b.users;
      return { key: s, usersA: ga.users, usersB: gb.users, activeA: ga.active, activeB: gb.active,
        shareA, shareB, mix: (shareB - shareA) * rA, rateEffect: shareB * (rB - rA) };
    });
    // Gộp các nhóm nhỏ thành "Khác" (đóng góp cộng dồn được nên tổng vẫn đúng).
    segments.sort((x, y) => Math.max(y.shareA, y.shareB) - Math.max(x.shareA, x.shareB));
    const top = segments.slice(0, 12);
    const rest = segments.slice(12);
    if (rest.length) {
      top.push(rest.reduce((o, s) => ({
        key: 'other', usersA: o.usersA + s.usersA, usersB: o.usersB + s.usersB, activeA: o.activeA + s.activeA,
        activeB: o.activeB + s.activeB, shareA: o.shareA + s.shareA, shareB: o.shareB + s.shareB,
        mix: o.mix + s.mix, rateEffect: o.rateEffect + s.rateEffect,
      })));
    }
    segments = top;
    return {
      day: q.day,
      by: q.by,
      a: period(a, q.a),
      b: period(b, q.b),
      delta: rateB - rateA,
      mix: segments.reduce((s, x) => s + x.mix, 0),
      rateEffect: segments.reduce((s, x) => s + x.rateEffect, 0),
      segments: segments
        .map((s) => ({
          key: s.key,
          usersA: s.usersA,
          usersB: s.usersB,
          shareA: s.shareA,
          shareB: s.shareB,
          rateA: s.usersA ? s.activeA / s.usersA : null,
          rateB: s.usersB ? s.activeB / s.usersB : null,
          mix: s.mix,
          rateEffect: s.rateEffect,
        }))
        .sort((x, y) => Math.abs(y.mix + y.rateEffect) - Math.abs(x.mix + x.rateEffect)),
    };
  }

  /** Các phiên bản cài (ước tính) có trong dữ liệu, mới nhất trước; "mixed" và "?" ở cuối. */
  async versions() {
    const totals = new Map<string, number>();
    for (const c of await this.cells({ from: '2000-01-01', to: '2100-01-01' })) {
      totals.set(c.version, (totals.get(c.version) ?? 0) + c.newUsers);
    }
    const special = (v: string) => (v === MIXED_VERSION || v === '?' ? 1 : 0);
    return [...totals.entries()]
      .map(([version, newUsers]) => ({ version, newUsers }))
      .sort((a, b) => special(a.version) - special(b.version) || b.version.localeCompare(a.version, undefined, { numeric: true }));
  }

  /** Các nguồn có trong dữ liệu (cho ô lọc), nhiều người dùng mới nhất trước. */
  async sources() {
    const rows = await this.prisma.retentionStat.groupBy({
      by: ['source'], _sum: { newUsers: true }, orderBy: { _sum: { newUsers: 'desc' } },
    });
    return rows.map((r) => ({ source: r.source, newUsers: r._sum.newUsers ?? 0 }));
  }
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}
