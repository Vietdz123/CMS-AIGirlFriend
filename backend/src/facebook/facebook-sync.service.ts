import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { batches, minDate } from '../common/batches';
import { saveBudgetDays } from '../common/budget-history';
import { decrypt } from '../common/crypto';
import { FxService } from '../common/fx.service';
import { addDays, toDbDate, todayIn } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { FacebookApiService } from './facebook-api.service';

/** Facebook vẫn cập nhật chi phí/attribution vài ngày sau, nên mỗi lần sync lấy lại vài ngày gần nhất. */
const RECENT_DAYS = 3;
const CHUNK_DAYS = 30;
/** Số ngày dựng lại budget/ngày từ nhật ký hoạt động mỗi lần đồng bộ. */
const BUDGET_DAYS = 30;

@Injectable()
export class FacebookSyncService {
  private readonly logger = new Logger(FacebookSyncService.name);
  private readonly running = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private api: FacebookApiService,
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
   * Tài khoản chưa có dữ liệu (lần đầu bị lỗi, hoặc dữ liệu bị xoá để quy đổi lại) thì backfill BACKFILL_DAYS ngày.
   */
  async startManual() {
    const accounts = await this.prisma.fbAdAccount.findMany({ select: { id: true } });
    const withData = new Set(
      (await this.prisma.adSpendStat.groupBy({ by: ['accountId'], where: { source: 'facebook' } })).map((r) => r.accountId),
    );
    const backfillDays = Number(this.config.get('BACKFILL_DAYS', 90));
    const started = accounts.map((a) => a.id).filter((id) => !this.running.has(id));
    started.forEach((id) => this.start(id, withData.has(id) ? RECENT_DAYS : backfillDays).catch(() => undefined));
    if (!started.length && accounts.length) throw new ConflictException('Đang cập nhật, vui lòng chờ');
    return started;
  }

  @Cron('0 10,40 * * * *')
  async scheduledRecent() {
    await this.runForAll(RECENT_DAYS);
  }

  @Cron('0 30 3 * * *')
  async scheduledDaily() {
    await this.runForAll(14);
  }

  private async runForAll(days: number) {
    const accounts = await this.prisma.fbAdAccount.findMany({ select: { id: true } });
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
    const account = await this.prisma.fbAdAccount.findUniqueOrThrow({ where: { id: accountId } });
    const to = todayIn(account.timeZone);
    const from = addDays(to, -(days - 1));
    try {
      const token = decrypt(account.tokenEnc);
      const campaigns = await this.api.campaigns(token, accountId);
      for (const c of campaigns) {
        // Không ghi đè appId: đó là app được gán tay trong CMS.
        const data = { accountId, name: c.name, storeId: c.storeId };
        await this.prisma.fbCampaign.upsert({ where: { id: c.id }, create: { id: c.id, ...data }, update: data });
      }
      const known = new Set(campaigns.map((c) => c.id));

      let rowCount = 0;
      for (let chunkFrom = from; chunkFrom <= to; chunkFrom = addDays(chunkFrom, CHUNK_DAYS)) {
        const chunkTo = minDate(addDays(chunkFrom, CHUNK_DAYS - 1), to);
        const rows = await this.api.insights(token, accountId, chunkFrom, chunkTo);
        const toUsd = await this.fx.converter(account.currencyCode, chunkFrom, chunkTo);

        // Chiến dịch đã xoá/lưu trữ không có trong danh sách campaigns nhưng vẫn có chi phí cũ.
        for (const r of rows) {
          if (known.has(r.campaignId)) continue;
          known.add(r.campaignId);
          await this.prisma.fbCampaign.upsert({
            where: { id: r.campaignId },
            create: { id: r.campaignId, accountId, name: r.campaignName },
            update: { name: r.campaignName },
          });
        }

        const data: Prisma.AdSpendStatCreateManyInput[] = rows.map((r) => ({
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
        }));
        await this.prisma.$transaction([
          this.prisma.adSpendStat.deleteMany({
            where: { source: 'facebook', accountId, date: { gte: toDbDate(chunkFrom), lte: toDbDate(chunkTo) } },
          }),
          ...batches(data).map((d) => this.prisma.adSpendStat.createMany({ data: d })),
        ]);
        rowCount += data.length;
      }

      // Budget/ngày là phần phụ, lỗi không làm hỏng chi phí vừa lưu.
      const budgetError = await this.syncBudgets(token, account, to).then(
        () => null,
        (e: any) => `Budget: ${e?.message ?? String(e)}`,
      );
      if (budgetError) this.logger.warn(`Facebook sync ${accountId}: ${budgetError}`);

      await this.prisma.fbAdAccount.update({
        where: { id: accountId },
        data: { lastSyncedAt: new Date(), lastError: budgetError?.slice(0, 1000) ?? null },
      });
      this.logger.log(`Facebook sync ${accountId} ${from}..${to}: ${rowCount} rows`);
    } catch (e: any) {
      const message = e?.message ?? String(e);
      this.logger.error(`Facebook sync ${accountId} failed: ${message}`);
      await this.prisma.fbAdAccount.update({ where: { id: accountId }, data: { lastError: message.slice(0, 1000) } });
      throw e;
    }
  }

  /** Budget/ngày của từng chiến dịch cho BUDGET_DAYS ngày gần nhất: budget hiện tại + nhật ký đổi budget, mức cuối ngày. */
  private async syncBudgets(token: string, account: { id: string; currencyCode: string; timeZone: string }, to: string) {
    const from = addDays(to, -(BUDGET_DAYS - 1));
    const [current, changes] = await Promise.all([
      this.api.campaignBudgets(token, account.id, account.currencyCode),
      this.api.budgetChanges(token, account.id, from, account.timeZone),
    ]);
    await saveBudgetDays(this.prisma, {
      source: 'facebook',
      accountId: account.id,
      currency: account.currencyCode,
      from,
      to,
      current,
      changes,
      toUsd: await this.fx.converter(account.currencyCode, from, to),
    });
  }
}
