import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { Roles } from '../auth/decorators';
import { encrypt } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FacebookApiService } from './facebook-api.service';
import { FacebookSyncService } from './facebook-sync.service';

class TokenDto {
  @IsString()
  @MinLength(20)
  token: string;
}

class ConnectDto extends TokenDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  accountIds: string[];
}

class CampaignAppDto {
  @IsOptional()
  @IsString()
  appId?: string | null;
}

@Controller('facebook')
export class FacebookController {
  constructor(
    private prisma: PrismaService,
    private api: FacebookApiService,
    private sync: FacebookSyncService,
  ) {}

  /** Kiểm tra token và liệt kê các tài khoản quảng cáo token xem được. Token không được lưu ở bước này. */
  @Roles(Role.ADMIN)
  @Post('token/check')
  async check(@Body() dto: TokenDto) {
    try {
      return await this.api.adAccounts(dto.token.trim());
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
  }

  @Roles(Role.ADMIN)
  @Post('accounts')
  async connect(@Body() dto: ConnectDto) {
    const token = dto.token.trim();
    let available;
    try {
      available = await this.api.adAccounts(token);
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
    const selected = available.filter((a) => dto.accountIds.includes(a.id));
    if (!selected.length) throw new BadRequestException('Token không có quyền xem tài khoản quảng cáo đã chọn');
    const tokenEnc = encrypt(token);
    for (const a of selected) {
      const data = { name: a.name, currencyCode: a.currency, timeZone: a.timezone_name, tokenEnc, lastError: null };
      await this.prisma.fbAdAccount.upsert({ where: { id: a.id }, create: { id: a.id, ...data }, update: data });
      this.sync.startInitial(a.id);
    }
    return { connected: selected.map((a) => a.id) };
  }

  @Get('accounts')
  async accounts() {
    const accounts = await this.prisma.fbAdAccount.findMany({
      select: {
        id: true,
        name: true,
        currencyCode: true,
        timeZone: true,
        lastSyncedAt: true,
        lastError: true,
        createdAt: true,
        _count: { select: { campaigns: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return accounts.map((a) => ({ ...a, running: this.sync.isRunning(a.id) }));
  }

  @Roles(Role.ADMIN)
  @Delete('accounts/:id')
  async remove(@Param('id') id: string) {
    await this.prisma.$transaction([
      this.prisma.adSpendStat.deleteMany({ where: { accountId: id } }),
      this.prisma.fbAdAccount.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('sync')
  async trigger() {
    return { started: await this.sync.startManual() };
  }

  /** Danh sách chiến dịch kèm app được ghép (tự động theo package name, hoặc gán tay). */
  @Roles(Role.ADMIN)
  @Get('campaigns')
  async campaigns() {
    const [campaigns, apps, spend] = await Promise.all([
      this.prisma.fbCampaign.findMany({
        select: { id: true, name: true, storeId: true, appId: true, account: { select: { id: true, name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.app.findMany({ where: { storeId: { not: null } }, select: { id: true, storeId: true } }),
      this.prisma.adSpendStat.groupBy({ by: ['campaignId'], _sum: { spendMicros: true } }),
    ]);
    const appByStore = new Map<string, string>();
    // Cùng quy tắc với ReportsService: nhiều app trùng package thì lấy app có id nhỏ nhất.
    for (const a of [...apps].sort((x, y) => x.id.localeCompare(y.id))) {
      if (!appByStore.has(a.storeId!)) appByStore.set(a.storeId!, a.id);
    }
    const spendBy = new Map(spend.map((s) => [s.campaignId, Number(s._sum.spendMicros ?? 0) / 1e6]));
    return campaigns.map((c) => ({
      ...c,
      autoAppId: c.storeId ? appByStore.get(c.storeId) ?? null : null,
      totalSpend: spendBy.get(c.id) ?? 0,
    }));
  }

  @Roles(Role.ADMIN)
  @Patch('campaigns/:id')
  async setCampaignApp(@Param('id') id: string, @Body() dto: CampaignAppDto) {
    await this.prisma.fbCampaign.update({ where: { id }, data: { appId: dto.appId || null } });
    return { ok: true };
  }
}
