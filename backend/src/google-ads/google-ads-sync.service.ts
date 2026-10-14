import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { AdmobApiService } from '../admob/admob-api.service';
import { batches, minDate } from '../common/batches';
import { decrypt } from '../common/crypto';
import { FxService } from '../common/fx.service';
import { addDays, toDbDate, todayIn } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleAdsApiService } from './google-ads-api.service';

export const GOOGLE_SOURCE = 'google';

/** Google Ads vẫn điều chỉnh chi phí/conversion vài ngày sau, nên mỗi lần sync lấy lại vài ngày gần nhất. */
const RECENT_DAYS = 3;
const CHUNK_DAYS = 30;

@Injectable()
export class GoogleAdsSyncService {
  private readonly logger = new Logger(GoogleAdsSyncService.name);
  private readonly running = new Set<string>();

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

  @Cron('0 20,50 * * * *')
  async scheduledRecent() {
    await this.runForAll(RECENT_DAYS);
  }

  @Cron('0 45 3 * * *')
  async scheduledDaily() {
    await this.runForAll(14);
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
    const from = addDays(to, -(days - 1));
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

      await this.prisma.gadsAccount.update({
        where: { id: accountId },
        data: { lastSyncedAt: new Date(), lastError: null },
      });
      this.logger.log(`Google Ads sync ${accountId} ${from}..${to}: ${rowCount} rows`);
    } catch (e: any) {
      const message = e?.message ?? String(e);
      this.logger.error(`Google Ads sync ${accountId} failed: ${message}`);
      await this.prisma.gadsAccount.update({ where: { id: accountId }, data: { lastError: message.slice(0, 1000) } });
      throw e;
    }
  }
}
