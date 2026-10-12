import { Body, Controller, Get, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { AppAccessService } from '../auth/app-access.service';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
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
    return { started: await this.sync.startManual(ids) };
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
    return accounts.map(({ syncRuns, ...a }) => ({
      ...a,
      running: this.sync.isRunning(a.id),
      lastRun: syncRuns[0] ?? null,
    }));
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
