import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { AppAccessService } from '../auth/app-access.service';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { allowedAdAccountIds } from '../common/ad-campaigns';
import { isIsoDate } from '../common/dates';
import { spendHistory } from '../common/spend-history';
import { FacebookSyncService } from '../facebook/facebook-sync.service';
import { GoogleAdsSyncService } from '../google-ads/google-ads-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from './sync.service';

class TriggerSyncDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accountIds?: string[];
}

@Controller('sync')
export class SyncController {
  constructor(
    private sync: SyncService,
    private prisma: PrismaService,
    private access: AppAccessService,
    private fbSync: FacebookSyncService,
    private gadsSync: GoogleAdsSyncService,
  ) {}

  /** Nút "Update" trên dashboard. Không truyền accountIds = cập nhật mọi tài khoản user được xem. */
  @Roles(Role.ADMIN, Role.MANAGER)
  @Post()
  async trigger(@CurrentUser() user: AuthUser, @Body() dto: TriggerSyncDto) {
    const allowed = await this.access.allowedAccountIds(user);
    let ids = dto.accountIds?.length
      ? dto.accountIds
      : (await this.prisma.admobAccount.findMany({ select: { id: true } })).map((a) => a.id);
    if (allowed !== null) ids = ids.filter((id) => allowed.includes(id));
    // Chi phí Facebook và Google Ads cập nhật cùng lúc; tài khoản nào đang sync dở thì bỏ qua.
    const fb = await this.fbSync.startManual().catch(() => []);
    const gads = await this.gadsSync.startManual().catch(() => []);
    const started = await this.sync.startManual(ids).catch((e) => {
      if (fb.length || gads.length) return [];
      throw e;
    });
    return { started: [...started, ...fb, ...gads] };
  }

  @Get('status')
  async status(@CurrentUser() user: AuthUser) {
    const allowed = await this.access.allowedAccountIds(user);
    const accounts = await this.prisma.admobAccount.findMany({
      where: allowed === null ? {} : { id: { in: allowed } },
      select: {
        id: true,
        publisherId: true,
        lastSyncedAt: true,
        syncRuns: { orderBy: { startedAt: 'desc' }, take: 1 },
      },
    });
    const admob = accounts.map(({ syncRuns, ...a }) => ({
      ...a,
      running: this.sync.isRunning(a.id),
      lastRun: syncRuns[0] ?? null,
    }));
    // Tài khoản Facebook Ads hiện cùng trạng thái để nút Update chờ cả chi phí.
    // Chỉ hiện tài khoản quảng cáo có chiến dịch ghép với app user được xem.
    const allowedApps = await this.access.allowedAppIds(user);
    const [fbIds, gadsIds] = await Promise.all([
      allowedAdAccountIds(this.prisma, 'facebook', allowedApps),
      allowedAdAccountIds(this.prisma, 'google', allowedApps),
    ]);
    const select = { id: true, name: true, lastSyncedAt: true, lastError: true } as const;
    const [fb, gads] = await Promise.all([
      this.prisma.fbAdAccount.findMany({ where: fbIds === null ? {} : { id: { in: fbIds } }, select }),
      this.prisma.gadsAccount.findMany({ where: gadsIds === null ? {} : { id: { in: gadsIds } }, select }),
    ]);
    const spendStatus = (prefix: string, isRunning: (id: string) => boolean) =>
      (a: (typeof fb)[number]) => ({
        id: a.id,
        publisherId: `${prefix} ${a.name}`,
        lastSyncedAt: a.lastSyncedAt,
        running: isRunning(a.id),
        lastRun: a.lastError ? { status: 'FAILED', error: a.lastError } : null,
      });
    return [
      ...admob,
      ...fb.map(spendStatus('Facebook', (id) => this.fbSync.isRunning(id))),
      ...gads.map(spendStatus('Google Ads', (id) => this.gadsSync.isRunning(id))),
    ];
  }

  /**
   * Biến động chi phí Google Ads: số của từng ngày lần đầu ghi nhận sau khi ngày kết thúc và hiện tại. Query: from, to.
   * Người không phải admin chỉ thấy tài khoản quảng cáo có chiến dịch ghép với app được gán.
   */
  @Get('spend-history')
  async spendHistory(@CurrentUser() user: AuthUser, @Query() q: Record<string, string | undefined>) {
    if (!isIsoDate(q.from) || !isIsoDate(q.to) || q.from > q.to) {
      throw new BadRequestException('from/to phải có dạng YYYY-MM-DD và from <= to');
    }
    const accountIds = await allowedAdAccountIds(this.prisma, 'google', await this.access.allowedAppIds(user));
    const accounts = await this.prisma.gadsAccount.findMany({ select: { id: true, timeZone: true } });
    return spendHistory(this.prisma, {
      from: q.from,
      to: q.to,
      sources: ['google'],
      accountIds,
      timeZones: new Map(accounts.map((a) => [a.id, a.timeZone])),
    });
  }

  /** Số dư tài khoản Google Ads (hạn mức, đã tiêu, tổng điều chỉnh) hiện tại và lịch sử các lần thay đổi. */
  @Get('gads-balance')
  async gadsBalance(@CurrentUser() user: AuthUser) {
    return this.gadsSync.balances(await allowedAdAccountIds(this.prisma, 'google', await this.access.allowedAppIds(user)));
  }

  /** Click và click không hợp lệ (Google đã lọc, không tính tiền) theo ngày, lấy thẳng từ Google Ads. Query: from, to. */
  @Get('invalid-clicks')
  async invalidClicks(@CurrentUser() user: AuthUser, @Query() q: Record<string, string | undefined>) {
    if (!isIsoDate(q.from) || !isIsoDate(q.to) || q.from > q.to) {
      throw new BadRequestException('from/to phải có dạng YYYY-MM-DD và from <= to');
    }
    const accountIds = await allowedAdAccountIds(this.prisma, 'google', await this.access.allowedAppIds(user));
    const byDate = await this.gadsSync.invalidClicks(q.from, q.to, accountIds);
    return Object.entries(byDate)
      .map(([date, x]) => ({ date, ...x }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  @Roles(Role.ADMIN)
  @Get('history')
  history() {
    return this.prisma.syncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { account: { select: { publisherId: true, name: true } } },
    });
  }
}
