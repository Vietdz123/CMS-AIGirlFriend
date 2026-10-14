import { Body, Controller, Get, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { AppAccessService } from '../auth/app-access.service';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { allowedAdAccountIds } from '../common/ad-campaigns';
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
