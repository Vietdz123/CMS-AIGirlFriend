import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { GoogleAuth } from 'google-auth-library';
import { batches } from '../common/batches';
import { toDbDate } from '../common/dates';
import { FxService } from '../common/fx.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseCsv, unzip } from './unzip';

/** Số tháng gần nhất lấy lại mỗi lần (Google còn cập nhật báo cáo tháng trước vài ngày đầu tháng). */
const MONTHS = 3;

/**
 * Tên cột trong báo cáo bán hàng ước tính của Google Play; Google đã đổi tên vài lần nên mỗi cột có vài cách viết.
 * So khớp không phân biệt hoa thường / dấu cách.
 */
const COLUMNS = {
  date: ['order charged date', 'transaction date', 'charged date'],
  status: ['financial status', 'transaction type'],
  packageName: ['product id', 'package id', 'package name'],
  sku: ['sku id', 'sku', 'product sku'],
  productType: ['product type'],
  country: ['country of buyer', 'buyer country', 'country'],
  currency: ['currency of sale', 'buyer currency', 'currency'],
  price: ['item price', 'charged amount', 'amount (buyer currency)'],
  tax: ['taxes collected', 'tax', 'taxes'],
} as const;

type Column = keyof typeof COLUMNS;

/**
 * Doanh thu mua trong app từ báo cáo bán hàng ước tính Google Play (Cloud Storage, bucket PLAY_REPORTS_BUCKET).
 * Mỗi ngày tải lại MONTHS tháng gần nhất, cộng theo ngày x sản phẩm x nước rồi lưu; không lưu mã đơn / người mua.
 * Service account (GA4_KEY_FILE) cần quyền "Xem dữ liệu tài chính" trong Play Console.
 */
@Injectable()
export class IapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IapService.name);
  private running = false;
  lastSyncedAt: Date | null = null;
  lastError: string | null = null;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private fx: FxService,
  ) {}

  get bucket(): string | undefined {
    return this.config.get<string>('PLAY_REPORTS_BUCKET')?.replace(/^gs:\/\//, '').split('/')[0] || undefined;
  }

  get enabled() {
    return !!this.bucket && !!this.config.get('GA4_KEY_FILE');
  }

  isRunning() {
    return this.running;
  }

  async onApplicationBootstrap() {
    if (this.enabled && !(await this.prisma.iapSaleStat.count())) this.start();
  }

  /** Báo cáo bán hàng ước tính cập nhật khoảng 1 lần/ngày; lấy 2 lần/ngày cho chắc. */
  @Cron('0 15 7,19 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async scheduled() {
    await this.sync().catch(() => undefined);
  }

  start() {
    if (!this.enabled || this.running) return false;
    this.sync().catch(() => undefined);
    return true;
  }

  async sync() {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const auth = new GoogleAuth({
        keyFile: this.config.getOrThrow('GA4_KEY_FILE'),
        scopes: ['https://www.googleapis.com/auth/devstorage.read_only'],
      });
      const client = await auth.getClient();
      const base = `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o`;
      const now = new Date();
      let rows = 0;
      for (let i = MONTHS - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const month = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const name = `sales/salesreport_${month}.zip`;
        let buf: Buffer;
        try {
          const res = await client.request<ArrayBuffer>({
            url: `${base}/${encodeURIComponent(name)}`,
            params: { alt: 'media' },
            responseType: 'arraybuffer',
          });
          buf = Buffer.from(res.data);
        } catch (e: any) {
          if (e?.response?.status === 404) continue; // tháng chưa có báo cáo
          throw e;
        }
        const csv = unzip(buf).find((f) => f.name.toLowerCase().endsWith('.csv'));
        if (!csv) throw new Error(`${name} không có file CSV`);
        const data = await this.aggregate(parseCsv(csv.data.toString('utf8')), name);
        const first = toDbDate(`${month.slice(0, 4)}-${month.slice(4)}-01`);
        const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
        await this.prisma.$transaction([
          this.prisma.iapSaleStat.deleteMany({ where: { date: { gte: first, lt: next } } }),
          ...batches(data).map((b) => this.prisma.iapSaleStat.createMany({ data: b })),
        ]);
        rows += data.length;
      }
      this.lastSyncedAt = new Date();
      this.lastError = null;
      this.logger.log(`Google Play sales: ${rows} dòng (ngày x sản phẩm x nước)`);
    } catch (e: any) {
      this.lastError = (e?.message ?? String(e)).slice(0, 1000);
      this.logger.error(`Google Play sales failed: ${this.lastError}`);
      throw e;
    } finally {
      this.running = false;
    }
  }

  /** Cộng các đơn theo ngày x package x sku x nước x tiền tệ; trừ đơn hoàn tiền. */
  private async aggregate(table: string[][], file: string): Promise<Prisma.IapSaleStatCreateManyInput[]> {
    const [header, ...lines] = table;
    if (!header) return [];
    const norm = header.map((h) => h.trim().toLowerCase());
    const idx = {} as Record<Column, number>;
    for (const [col, names] of Object.entries(COLUMNS) as [Column, readonly string[]][]) {
      idx[col] = names.map((n) => norm.indexOf(n)).find((i) => i >= 0) ?? -1;
    }
    const missing = (['date', 'sku', 'country', 'currency', 'price'] as Column[]).filter((c) => idx[c] < 0);
    if (missing.length) {
      // Chỉ ghi tên cột (không có dữ liệu đơn) để sửa COLUMNS.
      throw new Error(`${file}: thiếu cột ${missing.join(', ')}. Các cột có: ${header.join(' | ')}`);
    }
    const get = (r: string[], c: Column) => (idx[c] >= 0 ? (r[idx[c]] ?? '').trim() : '');
    const money = (v: string) => Math.round(Number(v.replace(/,/g, '')) * 1e6) || 0;

    const groups = new Map<string, {
      date: string; packageName: string; sku: string; productType: string; country: string; currency: string;
      orders: number; refunds: number; price: number; tax: number;
    }>();
    for (const r of lines) {
      const date = toIso(get(r, 'date'));
      if (!date) continue;
      const status = get(r, 'status').toLowerCase();
      const refund = status.includes('refund');
      // Đơn huỷ trước khi tính tiền (Cancelled / Declined) không có tiền.
      if (!refund && status && !/charged|complete|chargeable/.test(status)) continue;
      const g = {
        date,
        packageName: get(r, 'packageName'),
        sku: get(r, 'sku'),
        productType: get(r, 'productType') || 'unknown',
        country: get(r, 'country').toUpperCase() || 'ZZ',
        currency: get(r, 'currency').toUpperCase() || 'USD',
      };
      const k = Object.values(g).join('|');
      const cur = groups.get(k) ?? { ...g, orders: 0, refunds: 0, price: 0, tax: 0 };
      const sign = refund ? -1 : 1;
      if (refund) cur.refunds++;
      else cur.orders++;
      cur.price += sign * Math.abs(money(get(r, 'price')));
      cur.tax += sign * Math.abs(money(get(r, 'tax')));
      groups.set(k, cur);
    }

    // Đổi sang USD theo tỷ giá từng ngày (trang Tỷ giá).
    const list = [...groups.values()];
    const out: Prisma.IapSaleStatCreateManyInput[] = [];
    for (const currency of new Set(list.map((g) => g.currency))) {
      const items = list.filter((g) => g.currency === currency);
      const dates = items.map((g) => g.date).sort();
      const toUsd = await this.fx.converter(currency, dates[0], dates.at(-1)!);
      for (const g of items) {
        out.push({
          date: toDbDate(g.date),
          packageName: g.packageName,
          sku: g.sku,
          productType: g.productType,
          country: g.country,
          currency,
          orders: g.orders,
          refunds: g.refunds,
          priceLocalMicros: BigInt(g.price),
          taxLocalMicros: BigInt(g.tax),
          priceUsdMicros: toUsd(g.date, BigInt(g.price)),
          taxUsdMicros: toUsd(g.date, BigInt(g.tax)),
        });
      }
    }
    return out;
  }

  /**
   * Phí Google Play trên giá chưa thuế: gói đăng ký 15%; sản phẩm mua 1 lần 15% nếu tài khoản đã đăng ký chương
   * trình 15% (1 triệu USD đầu mỗi năm), ngược lại 30%. Đổi bằng PLAY_FEE_SUBSCRIPTION / PLAY_FEE_ONE_TIME.
   */
  fee(productType: string) {
    const sub = productType.toLowerCase().includes('subscription');
    return Number(this.config.get(sub ? 'PLAY_FEE_SUBSCRIPTION' : 'PLAY_FEE_ONE_TIME') ?? 0.15);
  }

  /**
   * Doanh thu IAP theo ngày (USD, đã trừ hoàn tiền) cho các package; null = mọi package. revenue = giá chưa thuế,
   * net = ước tính thực nhận (revenue trừ phí Google).
   */
  async daily(from: string, to: string, packages: string[] | null, countries?: string[]) {
    const rows = await this.prisma.iapSaleStat.groupBy({
      by: ['date', 'productType'],
      where: {
        date: { gte: toDbDate(from), lte: toDbDate(to) },
        ...(packages ? { packageName: { in: packages } } : {}),
        ...(countries?.length ? { country: { in: countries } } : {}),
      },
      _sum: { priceUsdMicros: true, orders: true, refunds: true },
    });
    const out = new Map<string, { revenue: number; net: number; orders: number; refunds: number }>();
    for (const r of rows) {
      const date = r.date.toISOString().slice(0, 10);
      const revenue = Number(r._sum.priceUsdMicros ?? 0) / 1e6;
      const d = out.get(date) ?? { revenue: 0, net: 0, orders: 0, refunds: 0 };
      d.revenue += revenue;
      d.net += revenue * (1 - this.fee(r.productType));
      d.orders += r._sum.orders ?? 0;
      d.refunds += r._sum.refunds ?? 0;
      out.set(date, d);
    }
    return out;
  }

  /**
   * Báo cáo IAP cho trang IAP: theo ngày, theo sản phẩm, theo nước (USD). gross = sau thuế, đã trừ hoàn tiền;
   * net = ước tính thực nhận (trừ phí Google); tax = thuế Google thu hộ.
   */
  async report(from: string, to: string, packages: string[] | null, countries?: string[]) {
    const rows = await this.prisma.iapSaleStat.findMany({
      where: {
        date: { gte: toDbDate(from), lte: toDbDate(to) },
        ...(packages ? { packageName: { in: packages } } : {}),
        ...(countries?.length ? { country: { in: countries } } : {}),
      },
    });
    type Agg = { gross: number; net: number; tax: number; orders: number; refunds: number };
    const add = (m: Map<string, Agg & Record<string, unknown>>, key: string, extra: Record<string, unknown>, r: (typeof rows)[number]) => {
      const gross = Number(r.priceUsdMicros) / 1e6;
      const a = m.get(key) ?? { ...extra, gross: 0, net: 0, tax: 0, orders: 0, refunds: 0 };
      a.gross += gross;
      a.net += gross * (1 - this.fee(r.productType));
      a.tax += Number(r.taxUsdMicros) / 1e6;
      a.orders += r.orders;
      a.refunds += r.refunds;
      m.set(key, a);
    };
    const byDay = new Map<string, Agg & Record<string, unknown>>();
    const detail = new Map<string, Agg & Record<string, unknown>>();
    const bySku = new Map<string, Agg & Record<string, unknown>>();
    const byCountry = new Map<string, Agg & Record<string, unknown>>();
    for (const r of rows) {
      const date = r.date.toISOString().slice(0, 10);
      add(byDay, date, { date }, r);
      add(bySku, r.sku, { sku: r.sku, productType: r.productType, fee: this.fee(r.productType) }, r);
      add(byCountry, r.country, { country: r.country }, r);
      add(detail, `${date}|${r.country}|${r.sku}`, {
        date, country: r.country, sku: r.sku, productType: r.productType, packageName: r.packageName,
        currency: r.currency, priceLocal: 0,
      }, r);
      (detail.get(`${date}|${r.country}|${r.sku}`)!.priceLocal as number) += Number(r.priceLocalMicros) / 1e6;
    }
    const byGross = (a: Agg, b: Agg) => b.gross - a.gross;
    return {
      byDay: [...byDay.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))),
      bySku: [...bySku.values()].sort(byGross),
      byCountry: [...byCountry.values()].sort(byGross),
      /** Từng ngày x nước x gói, mới nhất trước (bảng "Gói IAP"). */
      detail: [...detail.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)) || byGross(a, b)),
    };
  }

  /** Doanh thu IAP theo sản phẩm trong khoảng ngày (USD). */
  async bySku(from: string, to: string, packages: string[] | null) {
    const rows = await this.prisma.iapSaleStat.groupBy({
      by: ['sku', 'productType'],
      where: { date: { gte: toDbDate(from), lte: toDbDate(to) }, ...(packages ? { packageName: { in: packages } } : {}) },
      _sum: { priceUsdMicros: true, orders: true, refunds: true },
      orderBy: { _sum: { priceUsdMicros: 'desc' } },
    });
    return rows.map((r) => ({
      sku: r.sku,
      productType: r.productType,
      revenue: Number(r._sum.priceUsdMicros ?? 0) / 1e6,
      net: (Number(r._sum.priceUsdMicros ?? 0) / 1e6) * (1 - this.fee(r.productType)),
      orders: r._sum.orders ?? 0,
      refunds: r._sum.refunds ?? 0,
    }));
  }
}

/** "2026-10-21", "Oct 21, 2026", "21 Oct 2026" -> "2026-10-21". */
function toIso(v: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const t = Date.parse(`${v} UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
