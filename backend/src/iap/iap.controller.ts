import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AppAccessService } from '../auth/app-access.service';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { isIsoDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { IapService } from './iap.service';

/** Doanh thu mua trong app (Google Play). Người không phải admin chỉ thấy package của app được gán. */
@Controller('iap')
export class IapController {
  constructor(
    private iap: IapService,
    private prisma: PrismaService,
    private access: AppAccessService,
  ) {}

  @Get('status')
  status() {
    return { enabled: this.iap.enabled, running: this.iap.isRunning(), lastSyncedAt: this.iap.lastSyncedAt, lastError: this.iap.lastError };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('sync')
  sync() {
    return { started: this.iap.start() };
  }

  /** Báo cáo IAP theo ngày / sản phẩm / nước. Query: from, to, appIds, countries. */
  @Get('report')
  async report(@CurrentUser() user: AuthUser, @Query() q: Record<string, string | undefined>) {
    if (!isIsoDate(q.from) || !isIsoDate(q.to) || q.from > q.to) throw new BadRequestException('from/to phải có dạng YYYY-MM-DD');
    const appIds = await this.access.resolveAppIds(user, q.appIds?.split(',').filter(Boolean));
    return this.iap.report(q.from, q.to, await packagesOf(this.prisma, appIds), q.countries?.split(',').filter(Boolean));
  }

  /** Doanh thu theo sản phẩm. Query: from, to, appIds. */
  @Get('by-sku')
  async bySku(@CurrentUser() user: AuthUser, @Query() q: Record<string, string | undefined>) {
    if (!isIsoDate(q.from) || !isIsoDate(q.to) || q.from > q.to) throw new BadRequestException('from/to phải có dạng YYYY-MM-DD');
    const appIds = await this.access.resolveAppIds(user, q.appIds?.split(',').filter(Boolean));
    return this.iap.bySku(q.from, q.to, await packagesOf(this.prisma, appIds));
  }
}

/** Package Google Play của các app (null = mọi app = mọi package). */
export async function packagesOf(prisma: PrismaService, appIds: string[] | null): Promise<string[] | null> {
  if (appIds === null) return null;
  const apps = await prisma.app.findMany({ where: { id: { in: appIds } }, select: { storeId: true } });
  return apps.map((a) => a.storeId).filter((s): s is string => !!s);
}
