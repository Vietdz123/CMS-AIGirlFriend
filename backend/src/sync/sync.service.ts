import { ConflictException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { AdmobAccount, Prisma, SyncStatus, SyncTrigger } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import { decrypt } from '../common/crypto';
import { batches, minDate } from '../common/batches';
import { addDays, toDbDate, todayIn } from '../common/dates';
import { AdmobApiService, dim, metricInt, ReportRow } from '../admob/admob-api.service';
import { InventoryService } from '../admob/inventory.service';
import { PrismaService } from '../prisma/prisma.service';

/** AdMob tiếp tục điều chỉnh số liệu vài ngày sau, nên mỗi lần sync lấy lại vài ngày gần nhất. */
const RECENT_DAYS = 3;
/** Chia khoảng thời gian dài thành nhiều request nhỏ để report không quá lớn. */
const CHUNK_DAYS = 14;

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);
  private readonly running = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private api: AdmobApiService,
    private inventory: InventoryService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    // Các run đang RUNNING khi server tắt sẽ không bao giờ kết thúc.
    await this.prisma.syncRun.updateMany({
      where: { status: SyncStatus.RUNNING },
      data: { status: SyncStatus.FAILED, error: 'Server restarted', finishedAt: new Date() },
    });
  }

  isRunning(accountId: string) {
    return this.running.has(accountId);
  }

  /** Lần đầu kết nối: backfill BACKFILL_DAYS ngày. */
  startInitial(accountId: string) {
    const days = Number(this.config.get('BACKFILL_DAYS', 90));
    this.start(accountId, SyncTrigger.INITIAL, days).catch(() => undefined);
  }

  /** Nút "Update": sync lại các ngày gần nhất cho các account, chạy nền, trả về ngay. */
  async startManual(accountIds: string[]) {
    const accounts = await this.prisma.admobAccount.findMany({ where: { id: { in: accountIds } } });
    const started: string[] = [];
    for (const acc of accounts) {
      if (this.running.has(acc.id)) continue;
      this.start(acc.id, SyncTrigger.MANUAL, RECENT_DAYS).catch(() => undefined);
      started.push(acc.id);
    }
    if (!started.length && accounts.length) throw new ConflictException('Đang cập nhật, vui lòng chờ');
    return started;
  }

  @Cron('0 */30 * * * *')
  async scheduledRecent() {
    await this.runForAll(RECENT_DAYS);
  }

  /** Mỗi ngày sync lại 14 ngày để bắt các điều chỉnh muộn của AdMob. */
  @Cron('0 15 3 * * *')
  async scheduledDaily() {
    await this.runForAll(14);
  }

  private async runForAll(days: number) {
    const accounts = await this.prisma.admobAccount.findMany({ select: { id: true } });
    for (const { id } of accounts) {
      if (this.running.has(id)) continue;
      await this.start(id, SyncTrigger.SCHEDULED, days).catch(() => undefined);
    }
  }

  private async start(accountId: string, trigger: SyncTrigger, days: number) {
    if (this.running.has(accountId)) return;
    this.running.add(accountId);
    try {
      await this.run(accountId, trigger, days);
    } finally {
      this.running.delete(accountId);
    }
  }

  private async run(accountId: string, trigger: SyncTrigger, days: number) {
    const account = await this.prisma.admobAccount.findUniqueOrThrow({ where: { id: accountId } });
    const to = todayIn(account.timeZone);
    const from = addDays(to, -(days - 1));
    const run = await this.prisma.syncRun.create({
      data: { accountId, trigger, fromDate: from, toDate: to },
    });
    try {
      const client = this.api.clientFor(decrypt(account.refreshTokenEnc));
      await this.inventory.sync(account.id, account.publisherId, client);
      let rowCount = 0;
      for (let chunkFrom = from; chunkFrom <= to; chunkFrom = addDays(chunkFrom, CHUNK_DAYS)) {
        const chunkTo = minDate(addDays(chunkFrom, CHUNK_DAYS - 1), to);
        rowCount += await this.syncRange(account, client, chunkFrom, chunkTo);
      }
      await this.prisma.$transaction([
        this.prisma.syncRun.update({
          where: { id: run.id },
          data: { status: SyncStatus.SUCCESS, rowCount, finishedAt: new Date() },
        }),
        this.prisma.admobAccount.update({ where: { id: accountId }, data: { lastSyncedAt: new Date() } }),
      ]);
      this.logger.log(`Sync ${account.publisherId} ${from}..${to} (${trigger}): ${rowCount} rows`);
    } catch (e: any) {
      const message = e?.response?.data?.error?.message ?? e?.message ?? String(e);
      this.logger.error(`Sync ${account.publisherId} failed: ${message}`);
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: { status: SyncStatus.FAILED, error: message.slice(0, 1000), finishedAt: new Date() },
      });
      throw e;
    }
  }

  /** Lấy report cho [from, to] rồi thay thế toàn bộ dữ liệu của khoảng đó trong DB. */
  private async syncRange(account: AdmobAccount, client: OAuth2Client, from: string, to: string) {
    const currency = this.config.get('REPORT_CURRENCY', 'USD');
    const [unitRows, sourceRows] = await Promise.all([
      this.api.mediationReport(client, account.publisherId, from, to,
        ['DATE', 'APP', 'AD_UNIT', 'FORMAT', 'COUNTRY'], currency),
      this.api.mediationReport(client, account.publisherId, from, to,
        ['DATE', 'APP', 'AD_UNIT', 'FORMAT', 'AD_SOURCE'], currency),
    ]);

    const units: Prisma.UnitStatCreateManyInput[] = unitRows.map((r) => ({
      ...base(account.id, r),
      country: dim(r, 'COUNTRY').value ?? 'ZZ',
    }));
    const sources: Prisma.SourceStatCreateManyInput[] = sourceRows.map((r) => ({
      ...base(account.id, r),
      adSourceId: dim(r, 'AD_SOURCE').value ?? 'unknown',
      adSourceName: dim(r, 'AD_SOURCE').displayLabel ?? dim(r, 'AD_SOURCE').value ?? 'Unknown',
    }));

    const range = { accountId: account.id, date: { gte: toDbDate(from), lte: toDbDate(to) } };
    await this.prisma.$transaction(
      [
        this.prisma.unitStat.deleteMany({ where: range }),
        this.prisma.sourceStat.deleteMany({ where: range }),
        ...batches(units).map((data) => this.prisma.unitStat.createMany({ data })),
        ...batches(sources).map((data) => this.prisma.sourceStat.createMany({ data })),
      ],
    );
    return units.length + sources.length;
  }
}

function base(accountId: string, r: ReportRow) {
  const d = dim(r, 'DATE').value!; // YYYYMMDD
  return {
    accountId,
    date: toDbDate(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`),
    appId: dim(r, 'APP').value ?? 'unknown',
    adUnitId: dim(r, 'AD_UNIT').value ?? 'unknown',
    format: dim(r, 'FORMAT').value ?? 'UNKNOWN',
    earningsMicros: metricInt(r, 'ESTIMATED_EARNINGS'),
    impressions: metricInt(r, 'IMPRESSIONS'),
    clicks: metricInt(r, 'CLICKS'),
    adRequests: metricInt(r, 'AD_REQUESTS'),
    matchedRequests: metricInt(r, 'MATCHED_REQUESTS'),
  };
}
