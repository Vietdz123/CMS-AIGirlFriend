import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, toDbDate } from './dates';

/** Nguồn tỷ giá miễn phí, có dữ liệu theo từng ngày trong quá khứ, không cần API key. */
const SOURCES = [
  (date: string) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.min.json`,
  (date: string) => `https://${date}.currency-api.pages.dev/v1/currencies/usd.min.json`,
];

/**
 * Quy đổi chi phí quảng cáo sang USD theo tỷ giá từng ngày. Ngày chưa có tỷ giá (hôm nay, nguồn chưa cập nhật)
 * dùng tỷ giá gần nhất trước đó.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(private prisma: PrismaService) {}

  /** Trả về hàm đổi micros tiền gốc -> micros USD cho mọi ngày trong [from, to]. */
  async converter(currency: string, from: string, to: string): Promise<(date: string, micros: bigint) => bigint> {
    const code = currency.toUpperCase();
    if (code === 'USD') return (_, micros) => micros;

    const rates = await this.rates(code, from, to);
    return (date, micros) => {
      const rate = rates.get(date);
      if (!rate) throw new Error(`Không có tỷ giá USD/${code} cho ngày ${date}`);
      return BigInt(Math.round(Number(micros) / rate));
    };
  }

  /** date -> số đơn vị tiền gốc cho 1 USD, đủ mọi ngày trong [from, to]. */
  private async rates(code: string, from: string, to: string): Promise<Map<string, number>> {
    // Lấy thêm 7 ngày trước để có tỷ giá "gần nhất" khi ngày đầu khoảng thiếu dữ liệu.
    const start = addDays(from, -7);
    const cached = await this.prisma.fxRate.findMany({
      where: { currency: code, date: { gte: toDbDate(start), lte: toDbDate(to) } },
    });
    const known = new Map(cached.map((r) => [r.date.toISOString().slice(0, 10), r.rate]));

    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (known.has(d)) continue;
      const rate = await this.fetchRate(code, d);
      if (rate === null) continue;
      known.set(d, rate);
      await this.prisma.fxRate.upsert({
        where: { date_currency: { date: toDbDate(d), currency: code } },
        create: { date: toDbDate(d), currency: code, rate },
        update: { rate },
      });
    }

    const out = new Map<string, number>();
    let last = [...known.entries()].filter(([d]) => d < from).sort().at(-1)?.[1];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      last = known.get(d) ?? last;
      if (last) out.set(d, last);
    }
    // Ngày đầu khoảng không có tỷ giá trước đó: dùng tỷ giá sớm nhất có được.
    const first = [...out.values()][0] ?? [...known.values()][0];
    for (let d = from; d <= to && first; d = addDays(d, 1)) if (!out.has(d)) out.set(d, first);
    return out;
  }

  private async fetchRate(code: string, date: string): Promise<number | null> {
    for (const url of SOURCES) {
      try {
        const res = await fetch(url(date), { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) continue;
        const body = (await res.json()) as { usd?: Record<string, number> };
        const rate = body.usd?.[code.toLowerCase()];
        if (rate && rate > 0) return rate;
      } catch {
        // thử nguồn tiếp theo
      }
    }
    this.logger.warn(`Không lấy được tỷ giá USD/${code} ngày ${date}`);
    return null;
  }
}
