import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { GadsAccount, Prisma } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import { AdmobApiService } from '../admob/admob-api.service';
import { batches, minDate } from '../common/batches';
import { saveBudgetDays } from '../common/budget-history';
import { decrypt } from '../common/crypto';
import { recordSpendSnapshots } from '../common/spend-history';
import { FxService } from '../common/fx.service';
import { addDays, toDbDate, todayIn } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsApiService } from './google-ads-api.service';

export const GOOGLE_SOURCE = 'google';

/** Google Ads vẫn điều chỉnh chi phí/conversion vài ngày sau, nên mỗi lần sync lấy lại vài ngày gần nhất. */
const RECENT_DAYS = 3;
const CHUNK_DAYS = 30;
/** ROAS D30 cần conversion value phát sinh tới 30 ngày sau ngày tương tác; thêm vài ngày cho conversion báo trễ. */
const LAG_WINDOW_DAYS = 34;
const LAG_CHUNK_DAYS = 34;
/** Google chỉ giữ lịch sử thay đổi khoảng 30 ngày, nên chỉ dựng lại budget/ngày cho chừng ấy ngày. */
const BUDGET_DAYS = 30;
/** Bảng theo giờ hôm nay gọi thẳng Google Ads; giữ kết quả 5 phút (Google Ads cập nhật chi phí khoảng 15–60 phút/lần). */
const HOURLY_CACHE_MS = 5 * 60_000;
/** Click không hợp lệ: Google cập nhật chậm, giữ kết quả 1 giờ để không tốn quota API mỗi lần mở trang. */
const INVALID_CACHE_MS = 60 * 60_000;

export interface HourlyToday {
  date: string;
  currentHour: number;
  fetchedAt: string;
  campaigns: { id: string; name: string; hours: { hour: number; spend: number; value: number }[] }[];
}

@Injectable()
export class GoogleAdsSyncService {
  private readonly logger = new Logger(GoogleAdsSyncService.name);
  private readonly running = new Set<string>();
  private hourlyCache: { at: number; data: HourlyToday } | null = null;
  private balanceCheckedAt = 0;
  private readonly invalidCache = new Map<string, { at: number; data: Record<string, { clicks: number; invalidClicks: number }> }>();

  constructor(
    private prisma: PrismaService,
    private api: GoogleAdsApiService,
    private oauth: AdmobApiService,
    private config: ConfigService,
    private fx: FxService,
  ) {}

  isRunning(accountId: string) {
    return this.running.has(accountId);
  }

  /** Lần đầu kết nối: backfill BACKFILL_DAYS ngày. */
  startInitial(accountId: string) {
    const days = Number(this.config.get('BACKFILL_DAYS', 90));
    this.start(accountId, days).catch(() => undefined);
  }

  /**
   * Nút "Update": sync lại các ngày gần nhất cho mọi tài khoản, chạy nền, trả về ngay.
   * Tài khoản chưa có dữ liệu (ví dụ backfill lần đầu bị lỗi) thì backfill lại BACKFILL_DAYS ngày.
   * full = true: tải lại BACKFILL_DAYS ngày cho mọi tài khoản (ghi đè dữ liệu cũ của khoảng đó, không xoá trước).
   */
  async startManual(full = false) {
    const accounts = await this.prisma.gadsAccount.findMany({ select: { id: true } });
    const withData = new Set(
      (await this.prisma.adSpendStat.groupBy({ by: ['accountId'], where: { source: GOOGLE_SOURCE } })).map((r) => r.accountId),
    );
    const backfillDays = Number(this.config.get('BACKFILL_DAYS', 90));
    const started = accounts.map((a) => a.id).filter((id) => !this.running.has(id));
    started.forEach((id) => this.start(id, !full && withData.has(id) ? RECENT_DAYS : backfillDays).catch(() => undefined));
    if (!started.length && accounts.length) throw new ConflictException('Đang cập nhật, vui lòng chờ');
    return started;
  }

  /**
   * Chi phí và conversion value theo giờ hôm nay của từng chiến dịch (USD), gọi thẳng Google Ads (không lưu DB).
   * Kết quả giữ HOURLY_CACHE_MS để nhiều người mở trang không tốn thêm quota API.
   */
  async hourlyToday(): Promise<HourlyToday> {
    if (this.hourlyCache && Date.now() - this.hourlyCache.at < HOURLY_CACHE_MS) return this.hourlyCache.data;
    const accounts = await this.prisma.gadsAccount.findMany();
    const campaigns: HourlyToday['campaigns'] = [];
    let timeZone = 'UTC';
    for (const account of accounts) {
      timeZone = account.timeZone;
      const today = todayIn(account.timeZone);
      const client = this.oauth.clientFor(decrypt(account.refreshTokenEnc));
      const toUsd = await this.fx.converter(account.currencyCode, today, today);
      const usd = (micros: bigint) => Number(toUsd(today, micros)) / 1e6;
      const byCampaign = new Map<string, (typeof campaigns)[number]>();
      for (const r of await this.api.hourlyToday(client, account.id, account.loginCustomerId)) {
        const c = byCampaign.get(r.campaignId) ?? { id: r.campaignId, name: r.campaignName, hours: [] };
        c.hours.push({ hour: r.hour, spend: usd(r.costMicros), value: usd(r.valueMicros) });
        byCampaign.set(r.campaignId, c);
      }
      campaigns.push(...byCampaign.values());
    }
    const now = new Date();
    const data: HourlyToday = {
      date: todayIn(timeZone),
      // Giờ hiện tại theo múi giờ tài khoản: giờ này đang chạy, vài giờ gần nhất conversion value còn về trễ.
      currentHour: Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now)),
      fetchedAt: now.toISOString(),
      campaigns: campaigns.map((c) => ({ ...c, hours: c.hours.sort((a, b) => a.hour - b.hour) })),
    };
    this.hourlyCache = { at: Date.now(), data };
    return data;
  }

  /**
   * Click và click không hợp lệ theo ngày (cộng mọi tài khoản trong accountIds, null = mọi tài khoản), gọi thẳng
   * Google Ads, giữ kết quả INVALID_CACHE_MS.
   */
  async invalidClicks(from: string, to: string, accountIds: string[] | null) {
    const cacheKey = `${from}|${to}|${accountIds?.join(',') ?? '*'}`;
    const hit = this.invalidCache.get(cacheKey);
    if (hit && Date.now() - hit.at < INVALID_CACHE_MS) return hit.data;
    const accounts = await this.prisma.gadsAccount.findMany({ where: accountIds ? { id: { in: accountIds } } : {} });
    const byDate: Record<string, { clicks: number; invalidClicks: number }> = {};
    for (const a of accounts) {
      const client = this.oauth.clientFor(decrypt(a.refreshTokenEnc));
      for (const r of await this.api.invalidClicks(client, a.id, a.loginCustomerId, from, to)) {
        const d = (byDate[r.date] ??= { clicks: 0, invalidClicks: 0 });
        d.clicks += r.clicks;
        d.invalidClicks += r.invalidClicks;
      }
    }
    this.invalidCache.set(cacheKey, { at: Date.now(), data: byDate });
    return byDate;
  }

  @Cron('0 20,50 * * * *')
  async scheduledRecent() {
    await this.runForAll(RECENT_DAYS);
  }

  @Cron('0 45 3 * * *')
  async scheduledDaily() {
    await this.runForAll(14);
  }

  /**
   * Lịch sử chi phí (trang Biến động chi phí): mỗi ngày 1 lần lúc 12:35 giờ VN, ngay sau lần đồng bộ 12:20, ghi số
   * hiện tại của mọi ngày đã đủ 1,5 ngày trong cửa sổ đồng bộ (ngày nào không đổi thì không ghi).
   */
  @Cron('0 35 12 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async recordSpendHistory() {
    for (const a of await this.prisma.gadsAccount.findMany({ select: { id: true, timeZone: true } })) {
      const yesterday = addDays(todayIn(a.timeZone), -1);
      await recordSpendSnapshots(this.prisma, GOOGLE_SOURCE, a.id, addDays(yesterday, -(LAG_WINDOW_DAYS - 1)), yesterday)
        .catch((e) => this.logger.warn(`Spend history ${a.id}: ${e?.message ?? e}`));
    }
    await this.recordBalances();
  }

  /**
   * Ghi số dư (hạn mức, đã tiêu, tổng điều chỉnh) của mọi tài khoản nếu khác lần ghi trước. Chạy cùng lịch sử chi phí
   * mỗi ngày và khi khởi động nếu chưa có lần ghi nào.
   */
  async recordBalances() {
    for (const a of await this.prisma.gadsAccount.findMany()) {
      try {
        const client = this.oauth.clientFor(decrypt(a.refreshTokenEnc));
        const b = await this.api.accountBalance(client, a.id, a.loginCustomerId);
        if (!b) continue;
        const last = await this.prisma.gadsBalanceSnapshot.findFirst({ where: { accountId: a.id }, orderBy: { capturedAt: 'desc' } });
        if (last && last.limitMicros === b.limitMicros && last.servedMicros === b.servedMicros && last.adjustmentMicros === b.adjustmentMicros) continue;
        await this.prisma.gadsBalanceSnapshot.create({ data: { accountId: a.id, currency: a.currencyCode, ...b } });
      } catch (e: any) {
        this.logger.warn(`Balance ${a.id}: ${e?.message ?? e}`);
      }
    }
  }

  /** Số dư hiện tại (gọi thẳng Google Ads, ghi lại nếu đổi) và lịch sử các lần ghi của các tài khoản trong accountIds. */
  async balances(accountIds: string[] | null) {
    // Mở trang thì lấy số mới, nhưng tối đa 10 phút/lần để không tốn quota API.
    if (Date.now() - this.balanceCheckedAt > 10 * 60_000) {
      this.balanceCheckedAt = Date.now();
      await this.recordBalances();
    }
    const accounts = await this.prisma.gadsAccount.findMany({
      where: accountIds ? { id: { in: accountIds } } : {},
      select: { id: true, name: true, currencyCode: true },
    });
    const history = await this.prisma.gadsBalanceSnapshot.findMany({
      where: { accountId: { in: accounts.map((a) => a.id) } },
      orderBy: { capturedAt: 'asc' },
    });
    const n = (v: bigint) => Number(v) / 1e6;
    return accounts.map((a) => {
      const list = history.filter((h) => h.accountId === a.id).map((h) => ({
        at: h.capturedAt.toISOString(),
        limit: n(h.limitMicros),
        served: n(h.servedMicros),
        adjustment: n(h.adjustmentMicros),
      }));
      return { id: a.id, name: a.name, currency: a.currencyCode, current: list.at(-1) ?? null, history: list };
    });
  }

  private async runForAll(days: number) {
    const accounts = await this.prisma.gadsAccount.findMany({ select: { id: true } });
    for (const { id } of accounts) await this.start(id, days).catch(() => undefined);
  }

  private async start(accountId: string, days: number) {
    if (this.running.has(accountId)) return;
    this.running.add(accountId);
    try {
      await this.run(accountId, days);
    } finally {
      this.running.delete(accountId);
    }
  }

  private async run(accountId: string, days: number) {
    const account = await this.prisma.gadsAccount.findUniqueOrThrow({ where: { id: accountId } });
    const to = todayIn(account.timeZone);
    // Conversion value của 1 ngày còn được Google điều chỉnh (tăng hoặc giảm) tới khoảng 30 ngày sau, nên chi phí và
    // conversion value luôn lấy lại ít nhất LAG_WINDOW_DAYS ngày để khớp với bảng ROAS theo độ trễ.
    const from = addDays(to, -(Math.max(days, LAG_WINDOW_DAYS) - 1));
    try {
      const client = this.oauth.clientFor(decrypt(account.refreshTokenEnc));
      const campaigns = await this.api.campaigns(client, accountId, account.loginCustomerId);
      for (const c of campaigns) {
        // Không ghi đè appId: đó là app được gán tay trong CMS.
        const data = { accountId, name: c.name, storeId: c.storeId };
        await this.prisma.gadsCampaign.upsert({ where: { id: c.id }, create: { id: c.id, ...data }, update: data });
      }
      const known = new Set(campaigns.map((c) => c.id));

      let rowCount = 0;
      for (let chunkFrom = from; chunkFrom <= to; chunkFrom = addDays(chunkFrom, CHUNK_DAYS)) {
        const chunkTo = minDate(addDays(chunkFrom, CHUNK_DAYS - 1), to);
        const rows = await this.api.spend(client, accountId, account.loginCustomerId, chunkFrom, chunkTo);
        const toUsd = await this.fx.converter(account.currencyCode, chunkFrom, chunkTo);

        // Chiến dịch đã xoá không có trong danh sách campaigns nhưng vẫn có chi phí cũ.
        for (const r of rows) {
          if (known.has(r.campaignId)) continue;
          known.add(r.campaignId);
          await this.prisma.gadsCampaign.upsert({
            where: { id: r.campaignId },
            create: { id: r.campaignId, accountId, name: r.campaignName },
            update: { name: r.campaignName },
          });
        }

        const data: Prisma.AdSpendStatCreateManyInput[] = rows.map((r) => ({
          source: GOOGLE_SOURCE,
          accountId,
          date: toDbDate(r.date),
          campaignId: r.campaignId,
          country: r.country,
          spendMicros: toUsd(r.date, r.spendMicros),
          localSpendMicros: r.spendMicros,
          currency: account.currencyCode,
          impressions: r.impressions,
          clicks: r.clicks,
          installs: r.installs,
          convValueMicros: toUsd(r.date, r.convValueMicros),
          localConvValueMicros: r.convValueMicros,
        }));
        await this.prisma.$transaction([
          this.prisma.adSpendStat.deleteMany({
            where: { source: GOOGLE_SOURCE, accountId, date: { gte: toDbDate(chunkFrom), lte: toDbDate(chunkTo) } },
          }),
          ...batches(data).map((d) => this.prisma.adSpendStat.createMany({ data: d })),
        ]);
        rowCount += data.length;
      }

      // ROAS D0…D30 là phần phụ: lỗi ở đây không được làm hỏng chi phí vừa lưu, chỉ ghi lại để hiện trên trang.
      const lagError = await this.syncConversionLag(client, account, from, to).then(
        () => null,
        (e: any) => `ROAS D0–D30: ${e?.message ?? String(e)}`,
      );
      if (lagError) this.logger.warn(`Google Ads sync ${accountId}: ${lagError}`);

      // Budget/ngày cũng là phần phụ, lỗi không làm hỏng chi phí.
      const budgetError = await this.syncBudgets(client, account, to).then(
        () => null,
        (e: any) => `Budget: ${e?.message ?? String(e)}`,
      );
      if (budgetError) this.logger.warn(`Google Ads sync ${accountId}: ${budgetError}`);
      const sideError = [lagError, budgetError].filter(Boolean).join(' · ') || null;

      await this.prisma.gadsAccount.update({
        where: { id: accountId },
        data: { lastSyncedAt: new Date(), lastError: sideError?.slice(0, 1000) ?? null },
      });
      this.logger.log(`Google Ads sync ${accountId} ${from}..${to}: ${rowCount} rows`);
    } catch (e: any) {
      const message = e?.message ?? String(e);
      this.logger.error(`Google Ads sync ${accountId} failed: ${message}`);
      await this.prisma.gadsAccount.update({ where: { id: accountId }, data: { lastError: message.slice(0, 1000) } });
      throw e;
    }
  }

  /**
   * Budget/ngày của từng chiến dịch cho BUDGET_DAYS ngày gần nhất: budget hiện tại + lịch sử thay đổi của Google
   * (chỉ giữ khoảng 30 ngày), mức cuối ngày. Ngày cũ hơn giữ nguyên dòng đã ghi từ các lần đồng bộ trước.
   */
  private async syncBudgets(client: OAuth2Client, account: GadsAccount, to: string) {
    const from = addDays(to, -(BUDGET_DAYS - 1));
    const [budgets, changes] = await Promise.all([
      this.api.campaignBudgets(client, account.id, account.loginCustomerId),
      this.api.budgetChanges(client, account.id, account.loginCustomerId, from, to),
    ]);
    // Lịch sử thay đổi theo budget resource; 1 budget có thể dùng chung cho nhiều chiến dịch.
    const campaignsByBudget = new Map<string, string[]>();
    for (const b of budgets) campaignsByBudget.set(b.budgetResource, [...(campaignsByBudget.get(b.budgetResource) ?? []), b.campaignId]);
    await saveBudgetDays(this.prisma, {
      source: GOOGLE_SOURCE,
      accountId: account.id,
      currency: account.currencyCode,
      from,
      to,
      current: new Map(budgets.map((b) => [b.campaignId, b.micros])),
      changes: changes.flatMap((c) => (campaignsByBudget.get(c.budgetResource) ?? []).map((campaignId) => ({ ...c, campaignId }))),
      toUsd: await this.fx.converter(account.currencyCode, from, to),
    });
  }

  /**
   * Conversion value theo độ trễ (cho ROAS D0…D30). Giá trị của 1 ngày tương tác còn tăng thêm tới 30 ngày sau,
   * nên luôn lấy lại ít nhất LAG_WINDOW_DAYS ngày gần nhất, kể cả khi sync thường chỉ lấy 3 ngày.
   */
  private async syncConversionLag(client: OAuth2Client, account: GadsAccount, from: string, to: string) {
    const lagFrom = minDate(from, addDays(to, -(LAG_WINDOW_DAYS - 1)));
    for (let chunkFrom = lagFrom; chunkFrom <= to; chunkFrom = addDays(chunkFrom, LAG_CHUNK_DAYS)) {
      const chunkTo = minDate(addDays(chunkFrom, LAG_CHUNK_DAYS - 1), to);
      const rows = await this.api.conversionLag(client, account.id, account.loginCustomerId, chunkFrom, chunkTo);
      const toUsd = await this.fx.converter(account.currencyCode, chunkFrom, chunkTo);
      const data: Prisma.GadsConvLagStatCreateManyInput[] = rows.map((r) => ({
        accountId: account.id,
        date: toDbDate(r.date),
        campaignId: r.campaignId,
        lagBucket: r.lagBucket,
        valueMicros: toUsd(r.date, r.valueMicros),
        localValueMicros: r.valueMicros,
      }));
      await this.prisma.$transaction([
        this.prisma.gadsConvLagStat.deleteMany({
          where: { accountId: account.id, date: { gte: toDbDate(chunkFrom), lte: toDbDate(chunkTo) } },
        }),
        ...batches(data).map((d) => this.prisma.gadsConvLagStat.createMany({ data: d })),
      ]);
    }
  }
}
